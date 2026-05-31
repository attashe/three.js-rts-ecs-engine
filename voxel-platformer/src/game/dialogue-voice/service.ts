import type { AudioEngine, SoundHandle } from '../../engine/audio'
import { dialogueVoiceCacheKey, normalizeDialogueVoice } from './presets'
import { synthDialogueVoiceLine } from './synth'
import type { DialogueVoicePlaybackOptions, DialogueVoiceRef, DialogueVoiceRenderResult, DialogueVoiceService as DialogueVoiceServiceContract, PcmSound } from './types'

interface DialogueVoiceServiceOptions {
    maxEntries?: number
    maxSamples?: number
    defaultVoice?: DialogueVoiceRef
}

interface CacheEntry {
    pcm: PcmSound
    samples: number
}

interface WorkerRequest {
    id: number
    text: string
    voice: DialogueVoiceRef
}

interface WorkerResponse {
    id: number
    ok: boolean
    result?: {
        samples: Float32Array
        sampleRate: number
        fantasyText: string
        duration: number
        cacheKey: string
    }
    error?: string
}

const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_MAX_SAMPLES = 32000 * 75
const ZERO_PCM: PcmSound = Object.freeze({ samples: new Float32Array(0), sampleRate: 32000 })

export class DialogueVoiceRuntime implements DialogueVoiceServiceContract {
    private readonly cache = new Map<string, CacheEntry>()
    private readonly maxEntries: number
    private readonly maxSamples: number
    private readonly defaultVoice: DialogueVoiceRef
    private totalSamples = 0
    private current: SoundHandle | null = null
    private playToken = 0
    private worker: Worker | null = null
    private nextWorkerId = 1
    private pendingWorker = new Map<number, { resolve: (result: DialogueVoiceRenderResult) => void; reject: (err: Error) => void }>()
    private workerFailed = false

    constructor(
        private readonly audio: AudioEngine,
        opts: DialogueVoiceServiceOptions = {},
    ) {
        this.maxEntries = Math.max(1, Math.floor(opts.maxEntries ?? DEFAULT_MAX_ENTRIES))
        this.maxSamples = Math.max(32000, Math.floor(opts.maxSamples ?? DEFAULT_MAX_SAMPLES))
        this.defaultVoice = opts.defaultVoice ?? { preset: 'dwarf', volume: 0.55, enabled: true }
    }

    speak(text: string, voiceRef?: DialogueVoiceRef, opts: DialogueVoicePlaybackOptions = {}): SoundHandle | null {
        const voice = normalizeDialogueVoice(voiceRef, this.defaultVoice)
        this.stopCurrent(opts.fadeOut ?? 0.035)
        if (!voice.enabled || !text.trim()) return null
        const token = ++this.playToken
        const key = dialogueVoiceCacheKey(text, voice)
        const cached = this.cache.get(key)
        if (cached) {
            this.current = this.playPcm(key, cached.pcm, voice.volume, opts)
            return this.current
        }
        void this.render(text, voice).then((result) => {
            if (token !== this.playToken || result.samples.length === 0) return
            this.putCache(result.cacheKey, result)
            this.current = this.playPcm(result.cacheKey, result, voice.volume, opts)
        }).catch((err) => {
            console.warn('Dialogue voice synthesis failed:', err)
        })
        return null
    }

    async preload(text: string, voiceRef?: DialogueVoiceRef): Promise<void> {
        const voice = normalizeDialogueVoice(voiceRef, this.defaultVoice)
        if (!voice.enabled || !text.trim()) return
        const key = dialogueVoiceCacheKey(text, voice)
        if (this.cache.has(key)) return
        const result = await this.render(text, voice)
        this.putCache(key, result)
    }

    stopCurrent(fadeOut = 0.03): void {
        this.playToken++
        this.current?.stop(fadeOut)
        this.current = null
    }

    clearCache(): void {
        this.cache.clear()
        this.totalSamples = 0
    }

    stats(): { entries: number; samples: number; worker: boolean } {
        return { entries: this.cache.size, samples: this.totalSamples, worker: this.worker !== null && !this.workerFailed }
    }

    dispose(): void {
        this.stopCurrent(0)
        this.clearCache()
        this.worker?.terminate()
        this.worker = null
        for (const pending of this.pendingWorker.values()) pending.reject(new Error('Dialogue voice worker disposed'))
        this.pendingWorker.clear()
    }

    private playPcm(id: string, pcm: PcmSound, volume: number, opts: DialogueVoicePlaybackOptions): SoundHandle {
        return this.audio.playGenerated(`dialogue.voice.${hashId(id)}`, pcm, {
            volume,
            fadeIn: opts.fadeIn ?? 0.012,
            fadeOut: opts.fadeOut ?? 0.035,
            maxInstances: 2,
            priority: 4,
            deferUntilUnlocked: true,
        })
    }

    private async render(text: string, voice: DialogueVoiceRef): Promise<DialogueVoiceRenderResult> {
        if (this.canUseWorker()) {
            try {
                return await this.renderInWorker(text, voice)
            } catch (err) {
                this.workerFailed = true
                console.warn('Dialogue voice worker disabled after failure:', err)
            }
        }
        return synthDialogueVoiceLine(text, voice)
    }

    private canUseWorker(): boolean {
        return !this.workerFailed && typeof Worker !== 'undefined' && typeof URL !== 'undefined'
    }

    private renderInWorker(text: string, voice: DialogueVoiceRef): Promise<DialogueVoiceRenderResult> {
        const worker = this.ensureWorker()
        const id = this.nextWorkerId++
        return new Promise((resolve, reject) => {
            this.pendingWorker.set(id, { resolve, reject })
            worker.postMessage({ id, text, voice } satisfies WorkerRequest)
        })
    }

    private ensureWorker(): Worker {
        if (this.worker) return this.worker
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dialogue-voice' })
        this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            const msg = event.data
            const pending = this.pendingWorker.get(msg.id)
            if (!pending) return
            this.pendingWorker.delete(msg.id)
            if (!msg.ok || !msg.result) {
                pending.reject(new Error(msg.error || 'Dialogue voice worker failed'))
                return
            }
            pending.resolve({
                samples: msg.result.samples,
                sampleRate: msg.result.sampleRate,
                fantasyText: msg.result.fantasyText,
                duration: msg.result.duration,
                cacheKey: msg.result.cacheKey,
            })
        }
        this.worker.onerror = (event) => {
            this.workerFailed = true
            const err = new Error(event.message || 'Dialogue voice worker error')
            for (const pending of this.pendingWorker.values()) pending.reject(err)
            this.pendingWorker.clear()
            this.worker?.terminate()
            this.worker = null
        }
        return this.worker
    }

    private putCache(key: string, pcm: PcmSound): void {
        if (pcm.samples.length === 0) {
            this.cache.set(key, { pcm: ZERO_PCM, samples: 0 })
            return
        }
        const existing = this.cache.get(key)
        if (existing) {
            this.totalSamples -= existing.samples
            this.cache.delete(key)
        }
        const samples = pcm.samples.length
        this.cache.set(key, { pcm: { samples: pcm.samples, sampleRate: pcm.sampleRate }, samples })
        this.totalSamples += samples
        this.evictCache()
    }

    private evictCache(): void {
        while (this.cache.size > this.maxEntries || this.totalSamples > this.maxSamples) {
            const first = this.cache.keys().next().value as string | undefined
            if (!first) return
            const removed = this.cache.get(first)
            this.cache.delete(first)
            this.totalSamples -= removed?.samples ?? 0
        }
    }
}

export function createDialogueVoiceService(audio: AudioEngine, opts?: DialogueVoiceServiceOptions): DialogueVoiceRuntime {
    return new DialogueVoiceRuntime(audio, opts)
}

function hashId(value: string): string {
    let hash = 2166136261
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(36)
}

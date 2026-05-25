import type {
    AudioAsset,
    AudioBackend,
    AudioBufferLike,
    AudioBusId,
    AudioEngineOptions,
    AudioManifest,
    AudioMusicPlayer,
    AudioVoice,
    MusicOptions,
    SoundHandle,
    SoundOptions,
} from './types'
import { WebAudioBackend } from './web-audio-backend'

type SoundCategory = 'sounds' | 'stingers'
type SoundBus = 'sfx' | 'stinger' | 'ui'

interface ActiveVoice {
    handle: ManagedSoundHandle
    voice: AudioVoice
    assetId: string
    category: SoundCategory
    priority: number
    startedAt: number
}

interface PendingSound {
    asset: AudioAsset
    category: SoundCategory
    bus: SoundBus
    options: SoundOptions
    handle: ManagedSoundHandle
}

interface ActiveMusic {
    id: string
    player: AudioMusicPlayer
}

const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'ui', 'stinger']

export class AudioEngine {
    private readonly backend: AudioBackend
    private readonly maxVoices: number
    private readonly stingerDuckVolume: number
    private readonly stingerDuckRamp: number
    private readonly abort = new AbortController()

    private sounds = new Map<string, AudioAsset>()
    private stingers = new Map<string, AudioAsset>()
    private music = new Map<string, AudioAsset>()
    private buffersByUrl = new Map<string, AudioBufferLike>()
    private loadsByUrl = new Map<string, Promise<AudioBufferLike>>()
    private activeVoices: ActiveVoice[] = []
    private pendingSounds: PendingSound[] = []
    private currentMusic: ActiveMusic | null = null
    private retiringMusic = new Set<AudioMusicPlayer>()
    private pendingMusic: { id: string; options: MusicOptions } | null = null
    private busVolumes = new Map<AudioBusId, number>(BUS_IDS.map((id) => [id, 1]))
    private stingerDucks = 0
    private disposed = false

    constructor(opts: AudioEngineOptions = {}) {
        this.backend = opts.backend ?? new WebAudioBackend()
        this.maxVoices = Math.max(1, opts.maxVoices ?? 32)
        this.stingerDuckVolume = opts.stingerDuckVolume ?? 0.58
        this.stingerDuckRamp = opts.stingerDuckRamp ?? 0.08
    }

    get unlocked(): boolean {
        return this.backend.unlocked
    }

    async unlock(): Promise<void> {
        if (this.disposed) return
        await this.backend.unlock()
        this.flushPendingSounds()
        const pending = this.pendingMusic
        if (pending) {
            this.pendingMusic = null
            await this.playMusic(pending.id, pending.options)
        }
    }

    async loadManifest(manifest: AudioManifest): Promise<void> {
        this.assertLive()
        validateManifest(manifest)
        this.sounds = mapAssets(manifest.sounds)
        this.stingers = mapAssets(manifest.stingers)
        this.music = mapAssets(manifest.music)
        const preload: Promise<AudioBufferLike>[] = []
        for (const asset of this.sounds.values()) preload.push(this.loadBuffer(asset))
        for (const asset of this.stingers.values()) preload.push(this.loadBuffer(asset))
        await Promise.all(preload)
    }

    play(id: string, opts: SoundOptions = {}): SoundHandle {
        const asset = this.asset(this.sounds, id, 'sound')
        return this.enqueueOrPlay(asset, 'sounds', opts, 'sfx')
    }

    playStinger(id: string, opts: SoundOptions = {}): SoundHandle {
        const asset = this.asset(this.stingers, id, 'stinger')
        return this.enqueueOrPlay(asset, 'stingers', opts, 'stinger')
    }

    async playMusic(id: string, opts: MusicOptions = {}): Promise<void> {
        if (this.disposed) return
        const asset = this.asset(this.music, id, 'music')
        if (!this.backend.unlocked) {
            this.pendingMusic = { id, options: opts }
            return
        }

        const crossfade = Math.max(0, opts.crossfade ?? 1.25)
        const fadeIn = Math.max(0, opts.fadeIn ?? crossfade)
        const fadeOut = Math.max(0, opts.fadeOut ?? crossfade)
        const targetVolume = clampVolume(opts.volume ?? asset.volume ?? 1)
        const next = this.backend.createMusic(asset.url, 'music')
        next.setLoop(opts.loop ?? asset.loop ?? true)
        next.setVolume(0)
        try {
            await next.play()
        } catch (err) {
            next.dispose()
            throw err
        }
        next.setVolume(targetVolume, fadeIn)

        const previous = this.currentMusic
        this.currentMusic = { id, player: next }
        if (previous) {
            previous.player.stop(fadeOut)
            this.retiringMusic.add(previous.player)
            this.cleanupRetiringMusic(previous.player, fadeOut)
        }
    }

    setBusVolume(bus: AudioBusId, volume: number, ramp = 0): void {
        const safe = clampVolume(volume)
        this.busVolumes.set(bus, safe)
        this.applyBusVolume(bus, ramp)
    }

    mute(muted: boolean): void {
        this.backend.setMuted(muted)
    }

    stopAll(): void {
        for (const active of [...this.activeVoices]) {
            active.voice.dispose()
            active.handle.finish()
        }
        this.activeVoices = []
        for (const pending of this.pendingSounds.splice(0)) pending.handle.finish()
        this.currentMusic?.player.stop(0)
        this.currentMusic = null
        for (const player of this.retiringMusic) player.dispose()
        this.retiringMusic.clear()
        this.stingerDucks = 0
        this.applyBusVolume('music')
    }

    dispose(): void {
        if (this.disposed) return
        this.stopAll()
        this.abort.abort()
        this.buffersByUrl.clear()
        this.loadsByUrl.clear()
        this.backend.dispose()
        this.disposed = true
    }

    private enqueueOrPlay(asset: AudioAsset, category: SoundCategory, opts: SoundOptions, bus: SoundBus): SoundHandle {
        const handle = new ManagedSoundHandle(asset.id)
        if (this.disposed) {
            handle.finish()
            return handle
        }
        if (!this.backend.unlocked) {
            if (opts.deferUntilUnlocked) this.pendingSounds.push({ asset, category, bus, options: opts, handle })
            else handle.finish()
            return handle
        }
        void this.startSound(asset, category, opts, bus, handle)
        return handle
    }

    private flushPendingSounds(): void {
        const pending = this.pendingSounds.splice(0)
        for (const item of pending) {
            if (!item.handle.stopped) void this.startSound(item.asset, item.category, item.options, item.bus, item.handle)
            else item.handle.finish()
        }
    }

    private async startSound(asset: AudioAsset, category: SoundCategory, opts: SoundOptions, bus: SoundBus, handle: ManagedSoundHandle): Promise<void> {
        try {
            const buffer = await this.loadBuffer(asset)
            if (this.disposed || handle.stopped) {
                handle.finish()
                return
            }
            const priority = opts.priority ?? asset.priority ?? 0
            if (!this.claimVoiceSlot(asset, opts, priority)) {
                handle.finish()
                return
            }
            const volume = clampVolume((opts.volume ?? 1) * (asset.volume ?? 1))
            const voice = this.backend.playBuffer(buffer, {
                bus,
                volume,
                rate: Math.max(0.05, opts.rate ?? 1),
                detune: opts.detune ?? 0,
                loop: opts.loop ?? asset.loop ?? false,
                pan: Math.max(-1, Math.min(1, opts.pan ?? 0)),
            })
            const active: ActiveVoice = { handle, voice, assetId: asset.id, category, priority, startedAt: voice.startedAt }
            this.activeVoices.push(active)
            handle.attach(voice)
            if (category === 'stingers') this.beginDucking()
            voice.onEnded(() => {
                this.activeVoices = this.activeVoices.filter((v) => v !== active)
                if (category === 'stingers') this.endDucking()
                handle.finish()
            })
            if (opts.fadeIn && opts.fadeIn > 0) {
                voice.setVolume(0)
                voice.setVolume(volume, opts.fadeIn)
            }
        } catch (err) {
            console.warn(`AudioEngine: failed to play ${asset.id}`, err)
            handle.finish()
        }
    }

    private claimVoiceSlot(asset: AudioAsset, opts: SoundOptions, priority: number): boolean {
        const maxInstances = opts.maxInstances ?? asset.maxInstances
        if (maxInstances !== undefined) {
            const same = this.activeVoices
                .filter((v) => v.assetId === asset.id)
                .sort(compareVoiceForSteal)
            while (same.length >= Math.max(1, maxInstances)) {
                const victim = same.shift()
                if (!victim) break
                victim.voice.stop(opts.fadeOut ?? 0)
            }
        }

        const sorted = [...this.activeVoices].sort(compareVoiceForSteal)
        while (sorted.length >= this.maxVoices) {
            const victim = sorted.shift()
            if (!victim) return false
            if (victim.priority > priority) return false
            victim.voice.stop(opts.fadeOut ?? 0)
        }
        return true
    }

    private loadBuffer(asset: AudioAsset): Promise<AudioBufferLike> {
        const cached = this.buffersByUrl.get(asset.url)
        if (cached) return Promise.resolve(cached)
        const existing = this.loadsByUrl.get(asset.url)
        if (existing) return existing
        const load = this.backend.loadBuffer(asset.url, this.abort.signal).then((buffer) => {
            this.buffersByUrl.set(asset.url, buffer)
            this.loadsByUrl.delete(asset.url)
            return buffer
        }, (err) => {
            this.loadsByUrl.delete(asset.url)
            throw err
        })
        this.loadsByUrl.set(asset.url, load)
        return load
    }

    private beginDucking(): void {
        this.stingerDucks++
        this.applyBusVolume('music', this.stingerDuckRamp)
    }

    private endDucking(): void {
        this.stingerDucks = Math.max(0, this.stingerDucks - 1)
        this.applyBusVolume('music', this.stingerDuckRamp)
    }

    private applyBusVolume(bus: AudioBusId, ramp = 0): void {
        const base = this.busVolumes.get(bus) ?? 1
        const duck = bus === 'music' && this.stingerDucks > 0 ? this.stingerDuckVolume : 1
        this.backend.setBusVolume(bus, base * duck, ramp)
    }

    private cleanupRetiringMusic(player: AudioMusicPlayer, fadeOut: number): void {
        if (fadeOut <= 0) {
            player.dispose()
            this.retiringMusic.delete(player)
            return
        }
        setTimeout(() => {
            player.dispose()
            this.retiringMusic.delete(player)
        }, fadeOut * 1000 + 32)
    }

    private asset(map: Map<string, AudioAsset>, id: string, label: string): AudioAsset {
        const asset = map.get(id)
        if (!asset) throw new Error(`Unknown ${label}: ${id}`)
        return asset
    }

    private assertLive(): void {
        if (this.disposed) throw new Error('AudioEngine: disposed')
    }
}

class ManagedSoundHandle implements SoundHandle {
    private voice: AudioVoice | null = null
    private resolveEnded!: () => void
    private isStopped = false
    private isFinished = false
    readonly ended: Promise<void>

    constructor(readonly id: string) {
        this.ended = new Promise<void>((resolve) => {
            this.resolveEnded = resolve
        })
    }

    get stopped(): boolean {
        return this.isStopped
    }

    attach(voice: AudioVoice): void {
        this.voice = voice
        if (this.isStopped) voice.stop(0)
    }

    stop(fadeOut = 0): void {
        if (this.isFinished || this.isStopped) return
        this.isStopped = true
        if (this.voice) this.voice.stop(fadeOut)
        else this.finish()
    }

    setVolume(volume: number, ramp = 0): void {
        if (this.isFinished) return
        this.voice?.setVolume(clampVolume(volume), ramp)
    }

    finish(): void {
        if (this.isFinished) return
        this.isFinished = true
        this.isStopped = true
        this.resolveEnded()
    }
}

function validateManifest(manifest: AudioManifest): void {
    const seen = new Set<string>()
    for (const group of [manifest.sounds ?? [], manifest.music ?? [], manifest.stingers ?? []]) {
        for (const asset of group) {
            if (!asset.id.trim()) throw new Error('Audio manifest asset is missing id')
            if (!asset.url.trim()) throw new Error(`Audio manifest asset ${asset.id} is missing url`)
            if (seen.has(asset.id)) throw new Error(`Duplicate audio asset id: ${asset.id}`)
            seen.add(asset.id)
        }
    }
}

function mapAssets(assets: readonly AudioAsset[] | undefined): Map<string, AudioAsset> {
    const out = new Map<string, AudioAsset>()
    for (const asset of assets ?? []) out.set(asset.id, { ...asset })
    return out
}

function compareVoiceForSteal(a: ActiveVoice, b: ActiveVoice): number {
    if (a.priority !== b.priority) return a.priority - b.priority
    return a.startedAt - b.startedAt
}

function clampVolume(v: number): number {
    if (!Number.isFinite(v)) return 1
    return Math.max(0, Math.min(1, v))
}

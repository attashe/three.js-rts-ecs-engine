import type {
    AudioBackend,
    AudioBufferLike,
    AudioBusId,
    AudioMusicPlayer,
    AudioVoice,
    BufferPlaybackParams,
} from './types'

type BusNode = GainNode

const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'ui', 'stinger']

export class WebAudioBackend implements AudioBackend {
    private context: AudioContext | null = null
    private master: GainNode | null = null
    private buses = new Map<AudioBusId, BusNode>()
    private volumes = new Map<AudioBusId, number>(BUS_IDS.map((id) => [id, 1]))
    private muted = false
    private disposed = false

    get currentTime(): number {
        return this.context?.currentTime ?? 0
    }

    get unlocked(): boolean {
        return this.context?.state === 'running'
    }

    async unlock(): Promise<void> {
        const ctx = this.ensureContext()
        if (ctx.state !== 'running') await ctx.resume()
    }

    async loadBuffer(url: string, signal?: AbortSignal): Promise<AudioBufferLike> {
        const ctx = this.ensureContext()
        const res = await fetch(url, { signal })
        if (!res.ok) throw new Error(`Audio load failed for ${url}: ${res.status} ${res.statusText}`)
        const bytes = await res.arrayBuffer()
        return await ctx.decodeAudioData(bytes.slice(0))
    }

    playBuffer(buffer: AudioBufferLike, params: BufferPlaybackParams): AudioVoice {
        const ctx = this.ensureContext()
        const source = ctx.createBufferSource()
        source.buffer = buffer as AudioBuffer
        source.loop = params.loop
        source.playbackRate.value = Math.max(0.05, params.rate)
        if (source.detune) source.detune.value = params.detune

        const gain = ctx.createGain()
        gain.gain.value = Math.max(0, params.volume)

        const bus = this.bus(params.bus)
        let panner: StereoPannerNode | null = null
        if (Number.isFinite(params.pan) && params.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
            panner = ctx.createStereoPanner()
            panner.pan.value = Math.max(-1, Math.min(1, params.pan))
            source.connect(gain)
            gain.connect(panner)
            panner.connect(bus)
        } else {
            source.connect(gain)
            gain.connect(bus)
        }

        const voice = new WebAudioVoice(ctx, source, gain, panner)
        source.start()
        return voice
    }

    createMusic(url: string, bus: Exclude<AudioBusId, 'master'>): AudioMusicPlayer {
        const ctx = this.ensureContext()
        const element = new Audio(url)
        element.preload = 'auto'
        element.volume = 1
        const source = ctx.createMediaElementSource(element)
        const gain = ctx.createGain()
        gain.gain.value = 0
        source.connect(gain)
        gain.connect(this.bus(bus))
        return new WebAudioMusicPlayer(ctx, element, gain, source)
    }

    setBusVolume(bus: AudioBusId, volume: number, ramp = 0): void {
        const v = Math.max(0, volume)
        this.volumes.set(bus, v)
        const node = bus === 'master' ? this.master : this.buses.get(bus)
        if (!node) return
        const target = bus === 'master' && this.muted ? 0 : v
        rampParam(node.gain, target, this.currentTime, ramp)
    }

    setMuted(muted: boolean): void {
        this.muted = muted
        const master = this.master
        if (!master) return
        const volume = muted ? 0 : (this.volumes.get('master') ?? 1)
        rampParam(master.gain, volume, this.currentTime, 0.03)
    }

    dispose(): void {
        if (this.disposed) return
        for (const bus of this.buses.values()) bus.disconnect()
        this.buses.clear()
        this.master?.disconnect()
        void this.context?.close()
        this.context = null
        this.master = null
        this.disposed = true
    }

    private ensureContext(): AudioContext {
        if (this.disposed) throw new Error('WebAudioBackend: disposed')
        if (this.context) return this.context
        const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext
        if (!AudioContextCtor) throw new Error('Web Audio is not available in this browser')
        this.context = new AudioContextCtor()
        this.master = this.context.createGain()
        this.master.gain.value = this.volumes.get('master') ?? 1
        this.master.connect(this.context.destination)
        for (const id of BUS_IDS) {
            if (id === 'master') continue
            const gain = this.context.createGain()
            gain.gain.value = this.volumes.get(id) ?? 1
            gain.connect(this.master)
            this.buses.set(id, gain)
        }
        return this.context
    }

    private bus(id: Exclude<AudioBusId, 'master'>): BusNode {
        this.ensureContext()
        const bus = this.buses.get(id)
        if (!bus) throw new Error(`Unknown audio bus: ${id}`)
        return bus
    }
}

class WebAudioVoice implements AudioVoice {
    readonly startedAt: number
    private callbacks: Array<() => void> = []
    private stopTimer: ReturnType<typeof setTimeout> | null = null
    private done = false
    private didStop = false

    constructor(
        private readonly context: AudioContext,
        private readonly source: AudioBufferSourceNode,
        private readonly gain: GainNode,
        private readonly panner: StereoPannerNode | null,
    ) {
        this.startedAt = context.currentTime
        this.source.onended = () => this.finish()
    }

    get stopped(): boolean {
        return this.didStop
    }

    stop(fadeOut = 0): void {
        if (this.done || this.didStop) return
        this.didStop = true
        const now = this.context.currentTime
        if (fadeOut > 0) {
            rampParam(this.gain.gain, 0, now, fadeOut)
            this.source.stop(now + fadeOut)
        } else {
            this.source.stop()
        }
    }

    setVolume(volume: number, ramp = 0): void {
        if (this.done) return
        rampParam(this.gain.gain, Math.max(0, volume), this.context.currentTime, ramp)
    }

    onEnded(cb: () => void): void {
        if (this.done) cb()
        else this.callbacks.push(cb)
    }

    dispose(): void {
        if (!this.done && !this.didStop) {
            try { this.source.stop() } catch { /* already stopped */ }
        }
        this.finish()
    }

    private finish(): void {
        if (this.done) return
        this.done = true
        if (this.stopTimer) clearTimeout(this.stopTimer)
        this.source.disconnect()
        this.gain.disconnect()
        this.panner?.disconnect()
        for (const cb of this.callbacks.splice(0)) cb()
    }
}

class WebAudioMusicPlayer implements AudioMusicPlayer {
    private stopTimer: ReturnType<typeof setTimeout> | null = null
    private didStop = false
    private disposed = false

    constructor(
        private readonly context: AudioContext,
        private readonly element: HTMLAudioElement,
        private readonly gain: GainNode,
        private readonly source: MediaElementAudioSourceNode,
    ) {}

    get url(): string {
        return this.element.src
    }

    get stopped(): boolean {
        return this.didStop
    }

    setLoop(loop: boolean): void {
        this.element.loop = loop
    }

    setVolume(volume: number, ramp = 0): void {
        if (this.disposed) return
        rampParam(this.gain.gain, Math.max(0, volume), this.context.currentTime, ramp)
    }

    async play(): Promise<void> {
        if (this.disposed) return
        await this.element.play()
    }

    stop(fadeOut = 0): void {
        if (this.disposed || this.didStop) return
        this.didStop = true
        if (fadeOut > 0) {
            rampParam(this.gain.gain, 0, this.context.currentTime, fadeOut)
            this.stopTimer = setTimeout(() => this.dispose(), fadeOut * 1000 + 32)
        } else {
            this.dispose()
        }
    }

    dispose(): void {
        if (this.disposed) return
        if (this.stopTimer) clearTimeout(this.stopTimer)
        this.element.pause()
        this.element.removeAttribute('src')
        this.element.load()
        this.source.disconnect()
        this.gain.disconnect()
        this.disposed = true
    }
}

function rampParam(param: AudioParam, value: number, now: number, ramp: number): void {
    param.cancelScheduledValues(now)
    param.setValueAtTime(param.value, now)
    if (ramp > 0) param.linearRampToValueAtTime(value, now + ramp)
    else param.setValueAtTime(value, now)
}

declare global {
    interface Window {
        webkitAudioContext?: typeof AudioContext
    }
}

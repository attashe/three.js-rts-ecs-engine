import type {
    AudioBackend,
    AudioAnalyser,
    AudioBufferLike,
    AudioBusId,
    AudioMusicPlayer,
    AudioVoice,
    BufferPlaybackParams,
    SpatialPlaybackParams,
    Vec3Like,
} from './types'

type BusNode = GainNode

const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'ui', 'stinger']

export class WebAudioBackend implements AudioBackend {
    private context: AudioContext | null = null
    private master: GainNode | null = null
    private buses = new Map<AudioBusId, BusNode>()
    private analysers = new Map<AudioBusId, AnalyserNode>()
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

    playSpatialBuffer(buffer: AudioBufferLike, params: SpatialPlaybackParams): AudioVoice {
        const ctx = this.ensureContext()
        const source = ctx.createBufferSource()
        source.buffer = buffer as AudioBuffer
        source.loop = params.loop
        source.playbackRate.value = Math.max(0.05, params.rate)
        if (source.detune) source.detune.value = params.detune

        const gain = ctx.createGain()
        gain.gain.value = Math.max(0, params.volume)

        const panner = ctx.createPanner()
        panner.panningModel = params.panningModel
        panner.distanceModel = params.rolloffModel
        // PannerNode requires refDistance > 0 and maxDistance > refDistance.
        const refDist = Math.max(0.0001, params.refDistance)
        panner.refDistance = refDist
        panner.maxDistance = Math.max(refDist + 0.001, params.maxDistance)
        panner.rolloffFactor = Math.max(0, params.rolloffFactor)
        panner.coneInnerAngle = params.coneInnerAngle
        panner.coneOuterAngle = params.coneOuterAngle
        panner.coneOuterGain = params.coneOuterGain
        applyPannerPosition(panner, params.position, ctx.currentTime)

        source.connect(gain)
        gain.connect(panner)
        panner.connect(this.bus(params.bus))

        const voice = new WebAudioSpatialVoice(ctx, source, gain, panner)
        source.start()
        return voice
    }

    setListenerPose(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
        if (!this.context) return
        applyListenerPose(this.context.listener, this.context.currentTime, position, forward, up)
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

    createAnalyser(bus: AudioBusId): AudioAnalyser {
        this.ensureContext()
        const analyser = this.analysers.get(bus)
        if (!analyser) throw new Error(`Unknown audio analyser bus: ${bus}`)
        return new WebAudioAnalyser(bus, analyser)
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
        for (const analyser of this.analysers.values()) analyser.disconnect()
        this.analysers.clear()
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
        const masterAnalyser = this.context.createAnalyser()
        configureAnalyser(masterAnalyser)
        this.master.connect(masterAnalyser)
        masterAnalyser.connect(this.context.destination)
        this.analysers.set('master', masterAnalyser)
        for (const id of BUS_IDS) {
            if (id === 'master') continue
            const gain = this.context.createGain()
            const analyser = this.context.createAnalyser()
            configureAnalyser(analyser)
            gain.gain.value = this.volumes.get(id) ?? 1
            gain.connect(analyser)
            analyser.connect(this.master)
            this.buses.set(id, gain)
            this.analysers.set(id, analyser)
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

class WebAudioAnalyser implements AudioAnalyser {
    constructor(readonly bus: AudioBusId, private readonly analyser: AnalyserNode) {}

    get fftSize(): number {
        return this.analyser.fftSize
    }

    get frequencyBinCount(): number {
        return this.analyser.frequencyBinCount
    }

    getByteTimeDomainData(out: Uint8Array): void {
        this.analyser.getByteTimeDomainData(out as Uint8Array<ArrayBuffer>)
    }

    getByteFrequencyData(out: Uint8Array): void {
        this.analyser.getByteFrequencyData(out as Uint8Array<ArrayBuffer>)
    }

    dispose(): void {
        // Shared backend analyser; backend owns graph disposal.
    }
}

class WebAudioVoice implements AudioVoice {
    readonly startedAt: number
    readonly spatial = false
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

/**
 * Spatial counterpart to `WebAudioVoice`. The audio graph is
 * `source → gain → panner → bus`; updates to position/velocity go
 * straight to the `PannerNode`'s `AudioParam`s with a tiny ramp so
 * fast-moving sources don't click.
 */
class WebAudioSpatialVoice implements AudioVoice {
    readonly startedAt: number
    readonly spatial = true
    private callbacks: Array<() => void> = []
    private done = false
    private didStop = false

    constructor(
        private readonly context: AudioContext,
        private readonly source: AudioBufferSourceNode,
        private readonly gain: GainNode,
        private readonly panner: PannerNode,
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

    setPosition(position: Vec3Like): void {
        if (this.done) return
        applyPannerPosition(this.panner, position, this.context.currentTime)
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
        this.source.disconnect()
        this.gain.disconnect()
        this.panner.disconnect()
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

// Pan/velocity helpers — modern `AudioParam` path first, with a legacy
// fallback for Safari builds that still expose `setPosition` /
// `setOrientation` / `setVelocity` instead of param objects. The 8ms
// micro-ramp on position is what kills the zipper noise you'd otherwise
// hear when an emitter snaps from frame to frame.

function applyPannerPosition(panner: PannerNode, pos: Vec3Like, now: number): void {
    const p = panner as unknown as { positionX?: AudioParam; positionY?: AudioParam; positionZ?: AudioParam; setPosition?: (x: number, y: number, z: number) => void }
    if (p.positionX) {
        p.positionX.cancelScheduledValues(now)
        p.positionY!.cancelScheduledValues(now)
        p.positionZ!.cancelScheduledValues(now)
        p.positionX.linearRampToValueAtTime(pos.x, now + 0.008)
        p.positionY!.linearRampToValueAtTime(pos.y, now + 0.008)
        p.positionZ!.linearRampToValueAtTime(pos.z, now + 0.008)
    } else {
        p.setPosition?.(pos.x, pos.y, pos.z)
    }
}

function applyListenerPose(
    listener: AudioListener,
    now: number,
    position: Vec3Like,
    forward: Vec3Like,
    up: Vec3Like,
): void {
    const l = listener as unknown as {
        positionX?: AudioParam; positionY?: AudioParam; positionZ?: AudioParam
        forwardX?: AudioParam; forwardY?: AudioParam; forwardZ?: AudioParam
        upX?: AudioParam; upY?: AudioParam; upZ?: AudioParam
        setPosition?: (x: number, y: number, z: number) => void
        setOrientation?: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void
    }
    if (l.positionX) {
        // Listener gets the same tiny ramp as panners — turning the
        // camera fast otherwise produces audible HRTF zipper noise.
        const t = now + 0.008
        l.positionX.cancelScheduledValues(now); l.positionX.linearRampToValueAtTime(position.x, t)
        l.positionY!.cancelScheduledValues(now); l.positionY!.linearRampToValueAtTime(position.y, t)
        l.positionZ!.cancelScheduledValues(now); l.positionZ!.linearRampToValueAtTime(position.z, t)
        l.forwardX!.cancelScheduledValues(now); l.forwardX!.linearRampToValueAtTime(forward.x, t)
        l.forwardY!.cancelScheduledValues(now); l.forwardY!.linearRampToValueAtTime(forward.y, t)
        l.forwardZ!.cancelScheduledValues(now); l.forwardZ!.linearRampToValueAtTime(forward.z, t)
        l.upX!.cancelScheduledValues(now); l.upX!.linearRampToValueAtTime(up.x, t)
        l.upY!.cancelScheduledValues(now); l.upY!.linearRampToValueAtTime(up.y, t)
        l.upZ!.cancelScheduledValues(now); l.upZ!.linearRampToValueAtTime(up.z, t)
    } else {
        l.setPosition?.(position.x, position.y, position.z)
        l.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z)
    }
}

function configureAnalyser(analyser: AnalyserNode): void {
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.72
}

declare global {
    interface Window {
        webkitAudioContext?: typeof AudioContext
    }
}

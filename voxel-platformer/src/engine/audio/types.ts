export type AudioBusId = 'master' | 'music' | 'sfx' | 'ui' | 'stinger'

/**
 * 3-axis world-space vector. Read-only so callers can pass through
 * cached objects (e.g. `THREE.Vector3`) without copying. Engines mutate
 * their own internal buffers; emitter APIs only read.
 */
export interface Vec3Like {
    readonly x: number
    readonly y: number
    readonly z: number
}

/** Distance attenuation curve. Mirrors Web Audio `PannerNode.distanceModel`. */
export type RolloffModel = 'inverse' | 'linear' | 'exponential'

/** Panner backend. `HRTF` gives binaural realism but is CPU-heavy past
 *  ~32 simultaneous spatial voices; `equalpower` is the cheap fallback. */
export type PanningModel = 'HRTF' | 'equalpower'

/**
 * Falloff / cone / panner settings — all the *tunables* of a spatial
 * sound except its actual position. Split out so we can use it as the
 * shape of engine-wide defaults (`AudioEngineOptions.spatialDefaults`)
 * without forcing every default block to invent a position.
 */
export interface Spatial3DSettings {
    /** Below this distance the gain is at max. Default 1. */
    refDistance?: number
    /** Beyond this distance the gain reaches its floor. Default 50. */
    maxDistance?: number
    /** Curve steepness between ref + max. Default 1. */
    rolloffFactor?: number
    /** Falloff curve. Default `inverse` — most "game-natural". */
    rolloffModel?: RolloffModel
    /** Directional cone — defaults to 360° (omnidirectional). */
    coneInnerAngle?: number
    coneOuterAngle?: number
    coneOuterGain?: number
    /** Panner backend choice. Default `HRTF`. */
    panningModel?: PanningModel
}

/**
 * Position-aware spatial params. Used by the backend's
 * `playSpatialBuffer` and resolved internally — game code rarely
 * touches this directly. Callers use `SpatialSoundOptions` instead,
 * which takes position from the method's positional argument.
 *
 * (Velocity / doppler is intentionally absent. Modern Web Audio
 * removed `PannerNode.velocity*`; if you need doppler in the future,
 * drive it via `playbackRate` automation instead.)
 */
export interface Spatial3DParams extends Spatial3DSettings {
    /** World position of the emitter at play time. */
    position: Vec3Like
}

export interface AudioAsset {
    id: string
    url: string
    volume?: number
    loop?: boolean
    maxInstances?: number
    priority?: number
}

export interface AudioManifest {
    sounds?: readonly AudioAsset[]
    music?: readonly AudioAsset[]
    stingers?: readonly AudioAsset[]
}

export interface AudioAssetCounts {
    sounds: number
    music: number
    stingers: number
}

export interface SoundOptions {
    volume?: number
    rate?: number
    detune?: number
    loop?: boolean
    pan?: number
    maxInstances?: number
    priority?: number
    fadeIn?: number
    fadeOut?: number
    deferUntilUnlocked?: boolean
}

/** Options accepted by `AudioEngine.playSpatial`. `position` lives on
 *  the method's positional argument; everything else (falloff, panner
 *  model) is optional here. */
export interface SpatialSoundOptions extends Omit<SoundOptions, 'pan'>, Spatial3DSettings {
    /** Optional override — if set, takes precedence over the position
     *  passed positionally to `playSpatial`. */
    position?: Vec3Like
}

export interface MusicOptions {
    volume?: number
    loop?: boolean
    crossfade?: number
    fadeIn?: number
    fadeOut?: number
}

export interface SoundHandle {
    readonly id: string
    readonly ended: Promise<void>
    readonly stopped: boolean
    /** True when this handle drives a `PannerNode`-backed voice — i.e.
     *  it was produced by `playSpatial`. Stereo handles return false. */
    readonly spatial: boolean
    stop(fadeOut?: number): void
    setVolume(volume: number, ramp?: number): void
    /** Move the emitter. No-op for non-spatial handles. */
    setPosition(position: Vec3Like): void
}

export interface AudioBufferLike {
    readonly duration: number
}

export interface PcmSound {
    readonly samples: Float32Array
    readonly sampleRate: number
}

export interface AudioVoice {
    readonly startedAt: number
    readonly stopped: boolean
    /** Whether this voice is panned in 3D (via `PannerNode`). */
    readonly spatial: boolean
    stop(fadeOut?: number): void
    setVolume(volume: number, ramp?: number): void
    onEnded(cb: () => void): void
    dispose(): void
    /** Update the emitter's world position. Spatial voices only. */
    setPosition?(position: Vec3Like): void
}

/**
 * Listener pose contract. One per `AudioEngine`. Coordinates are
 * world-space; vectors use the same handedness as three.js (Y up,
 * −Z forward by default). Callers usually wire this to the camera.
 */
export interface AudioListenerView {
    setPose(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void
}

export interface AudioMusicPlayer {
    readonly url: string
    readonly stopped: boolean
    setLoop(loop: boolean): void
    setVolume(volume: number, ramp?: number): void
    play(): Promise<void>
    stop(fadeOut?: number): void
    dispose(): void
}

export interface AudioSnapshot {
    unlocked: boolean
    activeVoices: number
    pendingSounds: number
    currentMusicId: string | null
    retiringMusicCount: number
    assetCounts: AudioAssetCounts
}

export interface AudioAnalyser {
    readonly bus: AudioBusId
    readonly fftSize: number
    readonly frequencyBinCount: number
    getByteTimeDomainData(out: Uint8Array): void
    getByteFrequencyData(out: Uint8Array): void
    dispose(): void
}

export interface BufferPlaybackParams {
    bus: Exclude<AudioBusId, 'master'>
    volume: number
    rate: number
    detune: number
    loop: boolean
    pan: number
}

/** Spatial counterpart to `BufferPlaybackParams` — the backend's
 *  `playSpatialBuffer` consumes this. */
export interface SpatialPlaybackParams {
    bus: Exclude<AudioBusId, 'master'>
    volume: number
    rate: number
    detune: number
    loop: boolean
    position: Vec3Like
    refDistance: number
    maxDistance: number
    rolloffFactor: number
    rolloffModel: RolloffModel
    coneInnerAngle: number
    coneOuterAngle: number
    coneOuterGain: number
    panningModel: PanningModel
}

export interface AudioBackend {
    readonly currentTime: number
    readonly unlocked: boolean
    unlock(): Promise<void>
    loadBuffer(url: string, signal?: AbortSignal): Promise<AudioBufferLike>
    createBufferFromPcm(samples: Float32Array, sampleRate: number): AudioBufferLike
    playBuffer(buffer: AudioBufferLike, params: BufferPlaybackParams): AudioVoice
    /** Spatial playback. Set up a `PannerNode` chain so the voice is
     *  positioned in world space relative to the engine's listener. */
    playSpatialBuffer(buffer: AudioBufferLike, params: SpatialPlaybackParams): AudioVoice
    createMusic(url: string, bus: Exclude<AudioBusId, 'master'>): AudioMusicPlayer
    createAnalyser(bus: AudioBusId): AudioAnalyser
    setBusVolume(bus: AudioBusId, volume: number, ramp?: number): void
    setMuted(muted: boolean): void
    /** Push the listener pose to the backend. Called from the
     *  `audio-listener-system` once per frame, but exposed directly so
     *  custom integrations can drive it from any clock. */
    setListenerPose(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void
    dispose(): void
}

export interface AudioEngineOptions {
    backend?: AudioBackend
    maxVoices?: number
    stingerDuckVolume?: number
    stingerDuckRamp?: number
    /** Defaults applied to every `playSpatial` call. Useful for game-
     *  wide tuning (e.g. unify `refDistance` so SFX feel consistent). */
    spatialDefaults?: Spatial3DSettings
}

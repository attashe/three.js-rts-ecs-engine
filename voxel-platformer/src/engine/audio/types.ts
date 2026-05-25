export type AudioBusId = 'master' | 'music' | 'sfx' | 'ui' | 'stinger'

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
    stop(fadeOut?: number): void
    setVolume(volume: number, ramp?: number): void
}

export interface AudioBufferLike {
    readonly duration: number
}

export interface AudioVoice {
    readonly startedAt: number
    readonly stopped: boolean
    stop(fadeOut?: number): void
    setVolume(volume: number, ramp?: number): void
    onEnded(cb: () => void): void
    dispose(): void
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

export interface BufferPlaybackParams {
    bus: Exclude<AudioBusId, 'master'>
    volume: number
    rate: number
    detune: number
    loop: boolean
    pan: number
}

export interface AudioBackend {
    readonly currentTime: number
    readonly unlocked: boolean
    unlock(): Promise<void>
    loadBuffer(url: string, signal?: AbortSignal): Promise<AudioBufferLike>
    playBuffer(buffer: AudioBufferLike, params: BufferPlaybackParams): AudioVoice
    createMusic(url: string, bus: Exclude<AudioBusId, 'master'>): AudioMusicPlayer
    setBusVolume(bus: AudioBusId, volume: number, ramp?: number): void
    setMuted(muted: boolean): void
    dispose(): void
}

export interface AudioEngineOptions {
    backend?: AudioBackend
    maxVoices?: number
    stingerDuckVolume?: number
    stingerDuckRamp?: number
}

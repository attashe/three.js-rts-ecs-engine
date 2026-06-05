export const DIALOGUE_VOICE_PRESETS = [
    'tiny',
    'dwarf',
    'troll',
    'goblin',
    'orc',
    'elf',
    'lizard',
    'undead',
    'demon',
    'gnome',
    'player',
] as const

export type DialogueVoicePreset = (typeof DIALOGUE_VOICE_PRESETS)[number]

export interface DialogueVoiceRef {
    preset?: DialogueVoicePreset
    seed?: string
    volume?: number
    rate?: number
    pitchOffset?: number
    enabled?: boolean
}

export interface DialogueVoiceControls {
    bankSize: number
    syllables: number
    variation: number
    pitch: number
    speed: number
    mouth: number
    formant: number
    harmonics: number
    subharmonics: number
    chest: number
    double: number
    motion: number
    prosody: number
    stress: number
    jitter: number
    breath: number
    creak: number
    nasal: number
    consonants: number
    plosives: number
    fricatives: number
    sonorants: number
    transitions: number
    warmth: number
    room: number
}

export interface DialogueVoicePresetConfig extends DialogueVoiceControls {
    id: DialogueVoicePreset
    name: string
    description: string
    seed: string
    syllablePool: readonly string[]
    particlePool: readonly string[]
    onsetPool: readonly string[]
    vowelPool: readonly string[]
    codaPool: readonly string[]
}

export interface NormalizedDialogueVoice {
    preset: DialogueVoicePreset
    seed: string
    enabled: boolean
    volume: number
    rate: number
    pitchOffset: number
    controls: DialogueVoiceControls
}

export interface DialogueVoiceConfig extends NormalizedDialogueVoice {
    presetConfig: DialogueVoicePresetConfig
    stableVocabulary: boolean
    keepCase: boolean
    addParticles: boolean
    legato: boolean
}

export interface DialogueVoiceToken {
    id: number
    label: string
    raw: string
    onset: string
    coda: string
    nucleus: string
    v1: string
    v2: string
    pitch: number
    dur: number
    bright: number
    harm: number
    sub: number
    chest: number
    double: number
    motion: number
    jitter: number
    breath: number
    creak: number
    nasal: number
    consAmt: number
    plosive: number
    fricative: number
    sonorant: number
    transition: number
    warm: number
    stress: number
    phase: number
    detune: number
    skew: number
}

export interface DialogueVoiceStep {
    bank: number
    syl: string
    pun: string
    wordIndex: number
    syIndex: number
    wordLen: number
}

export interface GeneratedDialogueVoiceLine {
    sourceText: string
    fantasyText: string
    bank: DialogueVoiceToken[]
    sequence: DialogueVoiceStep[]
    wordMap: Map<string, string>
}

export interface PcmSound {
    samples: Float32Array
    sampleRate: number
}

export interface DialogueVoiceRenderResult extends PcmSound {
    fantasyText: string
    duration: number
    cacheKey: string
}

export interface DialogueVoicePlaybackOptions {
    fadeIn?: number
    fadeOut?: number
}

export interface DialogueVoiceService {
    speak(text: string, voice?: DialogueVoiceRef, opts?: DialogueVoicePlaybackOptions): unknown
    preload(text: string, voice?: DialogueVoiceRef): Promise<void>
    stopCurrent(fadeOut?: number): void
    clearCache(): void
}

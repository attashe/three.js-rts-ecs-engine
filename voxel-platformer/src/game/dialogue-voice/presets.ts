import { clamp } from './random'
import {
    DIALOGUE_VOICE_PRESETS,
    type DialogueVoiceControls,
    type DialogueVoicePreset,
    type DialogueVoicePresetConfig,
    type DialogueVoiceRef,
    type NormalizedDialogueVoice,
} from './types'

const BASE_CONTROLS: DialogueVoiceControls = {
    bankSize: 34,
    syllables: 55,
    variation: 60,
    pitch: 96,
    speed: 105,
    mouth: 64,
    formant: 52,
    harmonics: 62,
    subharmonics: 24,
    chest: 30,
    double: 24,
    motion: 52,
    prosody: 58,
    stress: 52,
    jitter: 22,
    breath: 14,
    creak: 12,
    nasal: 28,
    consonants: 34,
    plosives: 28,
    fricatives: 18,
    sonorants: 52,
    transitions: 72,
    warmth: 22,
    room: 12,
}

const MIN_VOICE_RATE = 0.45
const MAX_VOICE_RATE = 4

function preset(
    id: DialogueVoicePreset,
    name: string,
    description: string,
    seed: string,
    pools: Pick<DialogueVoicePresetConfig, 'syllablePool' | 'particlePool' | 'onsetPool' | 'vowelPool' | 'codaPool'>,
    controls: Partial<DialogueVoiceControls>,
): DialogueVoicePresetConfig {
    return { id, name, description, seed, ...pools, ...BASE_CONTROLS, ...controls }
}

export const DIALOGUE_VOICE_PRESET_CONFIGS: Record<DialogueVoicePreset, DialogueVoicePresetConfig> = {
    tiny: preset('tiny', 'Tiny creature', 'High, rounded, fast, and playful.', 'smooth-banana-04', {
        syllablePool: ['ba', 'bana', 'na', 'pa', 'papi', 'po', 'poka', 'la', 'lali', 'ti', 'tika', 'ki', 'kiki', 'bo', 'bobo', 'tu', 'tulu', 'mi', 'mika', 'da', 'doka', 'ya', 'waha', 'belo', 'bala', 'nana', 'pala', 'toko'],
        particlePool: ['bala', 'papoi', 'tikka', 'bano', 'waha', 'poka', 'lalala', 'bup'],
        onsetPool: ['b', 'p', 't', 'k', 'l', 'm', 'n', 'd', 'w', 'y'],
        vowelPool: ['a', 'i', 'o', 'u', 'aa', 'ee', 'oi'],
        codaPool: ['', 'n', 'm', 'k', 'p', 'l'],
    }, { bankSize: 36, pitch: 150, speed: 126, mouth: 76, formant: 76, harmonics: 60, subharmonics: 8, chest: 10, double: 38, prosody: 88, nasal: 48, consonants: 34, plosives: 24, fricatives: 8, sonorants: 68, transitions: 86, room: 8 }),

    dwarf: preset('dwarf', 'Dwarf', 'Deep chesty stone-clan voice.', 'iron-bridge-04', {
        syllablePool: ['dur', 'bar', 'khum', 'gron', 'arak', 'mord', 'thrum', 'kar', 'gar', 'dun', 'rak', 'bor', 'grim', 'kord', 'var', 'brak', 'drok', 'run', 'thar'],
        particlePool: ['dur', 'bar', 'khum', 'gron', 'arak', 'mord', 'thrum'],
        onsetPool: ['b', 'br', 'd', 'dr', 'g', 'gr', 'k', 'kr', 'kh', 'm', 'n', 'r', 'st', 'th', 'v', 'z'],
        vowelPool: ['a', 'o', 'u', 'aa', 'oa', 'ur', 'ar', 'or'],
        codaPool: ['', 'd', 'g', 'k', 'm', 'n', 'r', 'rd', 'rg', 'rk', 'rn', 'th', 'z'],
    }, { bankSize: 34, syllables: 44, variation: 44, pitch: 70, speed: 88, mouth: 58, formant: 32, harmonics: 82, subharmonics: 62, chest: 82, motion: 35, prosody: 42, stress: 68, creak: 42, nasal: 18, consonants: 44, plosives: 40, fricatives: 16, sonorants: 58, transitions: 72, warmth: 58, room: 24 }),

    troll: preset('troll', 'Troll', 'Huge slow throat and body voice.', 'swamp-king-04', {
        syllablePool: ['ug', 'mug', 'bogh', 'ghor', 'gruh', 'thok', 'onk', 'unga', 'grom', 'khu', 'oom', 'drog', 'wug', 'moog', 'ghak', 'urgh'],
        particlePool: ['ug', 'ghor', 'mug', 'thok', 'bogh', 'gruh', 'onk'],
        onsetPool: ['b', 'bl', 'd', 'g', 'gh', 'gr', 'h', 'k', 'kh', 'm', 'n', 'r', 'th', 'tr', 'w'],
        vowelPool: ['a', 'o', 'u', 'oo', 'au', 'ug', 'og', 'aa'],
        codaPool: ['', 'g', 'gh', 'k', 'kh', 'm', 'n', 'ng', 'rk', 'rr', 'th'],
    }, { bankSize: 26, syllables: 32, variation: 38, pitch: 48, speed: 58, mouth: 82, formant: 18, harmonics: 74, subharmonics: 88, chest: 94, motion: 24, prosody: 30, stress: 44, jitter: 34, breath: 18, creak: 58, nasal: 8, consonants: 34, plosives: 28, fricatives: 14, sonorants: 72, transitions: 66, warmth: 72, room: 34 }),

    goblin: preset('goblin', 'Goblin', 'Quick nasal sneaky voice.', 'scrap-nest-04', {
        syllablePool: ['zik', 'tik', 'nix', 'skree', 'vaz', 'klik', 'zup', 'kri', 'snik', 'tchik', 'rik', 'zaka', 'pich', 'skee', 'naka', 'ki', 'gri'],
        particlePool: ['zik', 'tik', 'nix', 'skree', 'vaz', 'klik', 'zup'],
        onsetPool: ['ch', 'g', 'gl', 'j', 'k', 'kl', 'n', 'p', 's', 'sk', 'sn', 't', 'tr', 'v', 'z', 'zr'],
        vowelPool: ['i', 'e', 'a', 'ee', 'ik', 'iz', 'ai'],
        codaPool: ['', 'k', 'p', 's', 't', 'x', 'z', 'zz', 'nk', 'sk', 'ch'],
    }, { bankSize: 42, syllables: 62, variation: 78, pitch: 128, speed: 148, mouth: 48, formant: 70, harmonics: 54, subharmonics: 8, chest: 8, double: 18, motion: 68, prosody: 82, stress: 76, jitter: 36, nasal: 82, consonants: 56, plosives: 36, fricatives: 36, sonorants: 58, transitions: 88, warmth: 18, room: 6 }),

    orc: preset('orc', 'Orc', 'Heavy barked warband speech.', 'ash-clan-04', {
        syllablePool: ['gar', 'druk', 'vor', 'ragh', 'skor', 'brak', 'krug', 'zod', 'trak', 'mog', 'grak', 'dur', 'vok', 'shak', 'gor'],
        particlePool: ['gar', 'druk', 'vor', 'ragh', 'skor', 'brak'],
        onsetPool: ['b', 'br', 'd', 'g', 'gr', 'k', 'kr', 'm', 'r', 'sk', 't', 'tr', 'v', 'z'],
        vowelPool: ['a', 'o', 'u', 'ur', 'ar', 'or'],
        codaPool: ['', 'g', 'k', 'r', 'rd', 'rg', 'rk', 'sh', 'th', 'z'],
    }, { bankSize: 32, syllables: 40, variation: 52, pitch: 64, speed: 100, mouth: 52, formant: 24, harmonics: 86, subharmonics: 68, chest: 74, double: 18, prosody: 58, stress: 84, jitter: 30, consonants: 58, plosives: 46, fricatives: 24, sonorants: 50, transitions: 78, warmth: 64, room: 18 }),

    elf: preset('elf', 'Elf', 'Clean musical vowel-led voice.', 'moon-court-04', {
        syllablePool: ['ela', 'sai', 'lior', 'vael', 'atha', 'mir', 'ae', 'lia', 'sora', 'thae', 'miri', 'va', 'iel', 'nora', 'eili', 'ael'],
        particlePool: ['ela', 'sai', 'lior', 'vael', 'atha', 'mir'],
        onsetPool: ['', 'l', 'll', 'm', 'n', 'r', 's', 'sh', 'th', 'v', 'w', 'y', 'f'],
        vowelPool: ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'ei', 'oa', 'uu'],
        codaPool: ['', 'l', 'm', 'n', 's', 'th', 'r'],
    }, { bankSize: 34, syllables: 66, variation: 48, pitch: 112, speed: 108, mouth: 74, formant: 86, harmonics: 38, subharmonics: 4, chest: 8, double: 28, motion: 72, prosody: 78, stress: 34, jitter: 10, breath: 26, creak: 0, nasal: 12, consonants: 22, plosives: 12, fricatives: 10, sonorants: 78, transitions: 92, warmth: 10, room: 28 }),

    lizard: preset('lizard', 'Lizardfolk', 'Sibilant reptile voice.', 'sun-scale-04', {
        syllablePool: ['ssa', 'ssek', 'kaa', 'kesh', 'tza', 'zur', 'shi', 'hass', 'rak', 'xil', 'saur', 'hek', 'ssu', 'kaal'],
        particlePool: ['hassa', 'ssu', 'kesh', 'zhaal'],
        onsetPool: ['s', 'ss', 'sh', 'x', 'z', 'k', 'kh', 't', 'tz', 'r', 'h'],
        vowelPool: ['a', 'i', 'u', 'aa', 'ei', 'ur'],
        codaPool: ['', 's', 'ss', 'sh', 'k', 'kh', 'r', 'x'],
    }, { bankSize: 36, syllables: 54, variation: 64, pitch: 86, speed: 112, mouth: 44, formant: 52, harmonics: 46, subharmonics: 22, chest: 28, double: 18, motion: 58, prosody: 54, stress: 42, breath: 34, creak: 16, nasal: 6, consonants: 56, plosives: 20, fricatives: 50, sonorants: 34, transitions: 86, warmth: 22, room: 12 }),

    undead: preset('undead', 'Undead whisper', 'Dry hollow breath and creak.', 'crypt-echo-04', {
        syllablePool: ['haa', 'esh', 'mur', 'oss', 'veth', 'khal', 'ur', 'sha', 'nom', 'dra', 'mor', 'hesh'],
        particlePool: ['haa', 'esh', 'mor', 'veth'],
        onsetPool: ['h', 'sh', 's', 'm', 'n', 'r', 'v', 'kh', 'd'],
        vowelPool: ['a', 'e', 'u', 'aa', 'oo', 'eh'],
        codaPool: ['', 'h', 's', 'sh', 'm', 'r', 'th'],
    }, { bankSize: 28, syllables: 42, variation: 40, pitch: 62, speed: 72, mouth: 62, formant: 20, harmonics: 28, subharmonics: 40, chest: 46, double: 10, motion: 24, prosody: 28, stress: 24, jitter: 50, breath: 58, creak: 78, nasal: 22, consonants: 36, plosives: 14, fricatives: 28, sonorants: 52, transitions: 70, warmth: 36, room: 52 }),

    demon: preset('demon', 'Demon', 'Layered abyssal voice.', 'abyss-oath-04', {
        syllablePool: ['az', 'zhar', 'mor', 'kael', 'vra', 'ghaz', 'ul', 'oth', 'drak', 'zun', 'raaz', 'khor', 'mael'],
        particlePool: ['zhar', 'ghaz', 'ul', 'raaz'],
        onsetPool: ['z', 'zh', 'gh', 'kh', 'dr', 'vr', 'm', 'r', 'k', 'g'],
        vowelPool: ['a', 'o', 'u', 'aa', 'au', 'or', 'ul'],
        codaPool: ['', 'z', 'r', 'gh', 'kh', 'm', 'n', 'th'],
    }, { bankSize: 32, syllables: 46, variation: 54, pitch: 52, speed: 86, mouth: 66, formant: 24, harmonics: 92, subharmonics: 92, chest: 88, double: 72, motion: 42, prosody: 46, stress: 68, jitter: 42, breath: 22, creak: 70, nasal: 12, consonants: 46, plosives: 30, fricatives: 28, sonorants: 58, transitions: 72, warmth: 82, room: 46 }),

    gnome: preset('gnome', 'Gnome mechanic', 'Small warm busy syllables.', 'clock-garden-04', {
        syllablePool: ['pip', 'bim', 'tolo', 'meka', 'nib', 'wim', 'bop', 'nolo', 'tik', 'pim', 'lo', 'dibi', 'momo', 'kalo'],
        particlePool: ['pip', 'bop', 'meka', 'nolo'],
        onsetPool: ['p', 'b', 'm', 'n', 't', 'd', 'k', 'l', 'w'],
        vowelPool: ['i', 'o', 'a', 'e', 'oo', 'ai'],
        codaPool: ['', 'p', 'm', 'n', 'k', 'l', 't'],
    }, { bankSize: 38, syllables: 62, variation: 68, pitch: 118, speed: 132, mouth: 60, formant: 62, harmonics: 58, subharmonics: 14, chest: 18, double: 28, motion: 62, prosody: 84, stress: 58, nasal: 50, consonants: 46, plosives: 34, fricatives: 18, sonorants: 72, transitions: 88, warmth: 24, room: 8 }),

    player: preset('player', 'Player', 'Grounded adventurer voice for player replies.', 'campfire-traveler-01', {
        syllablePool: ['ren', 'ka', 'val', 'tor', 'meri', 'lan', 'sha', 'dun', 'ar', 'vel', 'nora', 'tal', 'kir', 'oma', 'ser'],
        particlePool: ['ren', 'vala', 'taren', 'oma'],
        onsetPool: ['', 'b', 'd', 'f', 'k', 'l', 'm', 'n', 'r', 's', 't', 'v', 'w'],
        vowelPool: ['a', 'e', 'i', 'o', 'u', 'ai', 'or', 'en'],
        codaPool: ['', 'n', 'm', 'r', 's', 't', 'l'],
    }, { bankSize: 34, syllables: 52, variation: 42, pitch: 92, speed: 112, mouth: 62, formant: 48, harmonics: 56, subharmonics: 18, chest: 32, double: 14, motion: 38, prosody: 52, stress: 48, jitter: 12, breath: 10, creak: 8, nasal: 24, consonants: 36, plosives: 28, fricatives: 16, sonorants: 56, transitions: 74, warmth: 24, room: 10 }),
}

export const DEFAULT_DIALOGUE_VOICE: NormalizedDialogueVoice = {
    preset: 'dwarf',
    seed: DIALOGUE_VOICE_PRESET_CONFIGS.dwarf.seed,
    enabled: true,
    volume: 0.55,
    rate: 1,
    pitchOffset: 0,
    controls: controlsFromPreset(DIALOGUE_VOICE_PRESET_CONFIGS.dwarf),
}

export function isDialogueVoicePreset(value: unknown): value is DialogueVoicePreset {
    return typeof value === 'string' && (DIALOGUE_VOICE_PRESETS as readonly string[]).includes(value)
}

export function defaultDialogueVoiceForNpcModel(model: string): NormalizedDialogueVoice {
    const presetId: DialogueVoicePreset = model === 'large-troll'
        ? 'troll'
        : model === 'player'
            ? 'player'
            : model === 'rabbit' || model === 'spider'
                ? 'tiny'
                : 'dwarf'
    const presetConfig = DIALOGUE_VOICE_PRESET_CONFIGS[presetId]
    return {
        preset: presetId,
        seed: presetConfig.seed,
        enabled: true,
        volume: 0.55,
        rate: 1,
        pitchOffset: 0,
        controls: controlsFromPreset(presetConfig),
    }
}

export function normalizeDialogueVoice(input: DialogueVoiceRef | undefined, fallback: DialogueVoiceRef = DEFAULT_DIALOGUE_VOICE): NormalizedDialogueVoice {
    const fallbackPreset = isDialogueVoicePreset(fallback.preset) ? fallback.preset : DEFAULT_DIALOGUE_VOICE.preset
    const presetId = isDialogueVoicePreset(input?.preset) ? input.preset : fallbackPreset
    const presetConfig = DIALOGUE_VOICE_PRESET_CONFIGS[presetId]
    const rate = safeNumber(input?.rate, fallback.rate, MIN_VOICE_RATE, MAX_VOICE_RATE)
    const pitchOffset = safeNumber(input?.pitchOffset, fallback.pitchOffset, -36, 36)
    const volume = safeNumber(input?.volume, fallback.volume, 0, 1)
    return {
        preset: presetId,
        seed: cleanSeed(input?.seed) || cleanSeed(fallback.seed) || presetConfig.seed,
        enabled: input?.enabled ?? fallback.enabled ?? true,
        volume,
        rate,
        pitchOffset,
        controls: {
            ...controlsFromPreset(presetConfig),
            speed: clamp(presetConfig.speed * rate, 35, 360),
            pitch: clamp(presetConfig.pitch + pitchOffset, 24, 240),
        },
    }
}

export function controlsFromPreset(presetConfig: DialogueVoicePresetConfig): DialogueVoiceControls {
    const {
        bankSize, syllables, variation, pitch, speed, mouth, formant, harmonics,
        subharmonics, chest, double, motion, prosody, stress, jitter, breath,
        creak, nasal, consonants, plosives, fricatives, sonorants, transitions,
        warmth, room,
    } = presetConfig
    return {
        bankSize, syllables, variation, pitch, speed, mouth, formant, harmonics,
        subharmonics, chest, double, motion, prosody, stress, jitter, breath,
        creak, nasal, consonants, plosives, fricatives, sonorants, transitions,
        warmth, room,
    }
}

export function dialogueVoiceCacheKey(text: string, voice: NormalizedDialogueVoice): string {
    return [
        'v1',
        voice.preset,
        voice.seed,
        voice.enabled ? 'on' : 'off',
        fixed(voice.volume),
        fixed(voice.rate),
        fixed(voice.pitchOffset),
        text.trim(),
    ].join('|')
}

function safeNumber(value: unknown, fallback: unknown, min: number, max: number): number {
    const n = Number(value)
    const f = Number(fallback)
    return clamp(Number.isFinite(n) ? n : Number.isFinite(f) ? f : min, min, max)
}

function cleanSeed(value: unknown): string {
    return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

function fixed(value: number): string {
    return Number.isFinite(value) ? value.toFixed(3) : '0'
}

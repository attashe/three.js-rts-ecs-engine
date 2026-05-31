import { chance, clamp, pick, rngFrom, xmur3, type Rng } from './random'
import { DIALOGUE_VOICE_PRESET_CONFIGS, normalizeDialogueVoice } from './presets'
import type {
    DialogueVoiceConfig,
    DialogueVoiceRef,
    DialogueVoiceStep,
    DialogueVoiceToken,
    GeneratedDialogueVoiceLine,
    NormalizedDialogueVoice,
} from './types'

const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?|\d+|[^\w\s]|\s+/g
const KEEP = new Set(['a', 'i'])

interface ParsedSyllable {
    raw: string
    onset: string
    nucleus: string
    coda: string
    v1: string
    v2: string
}

export function buildDialogueVoiceConfig(voiceRef?: DialogueVoiceRef): DialogueVoiceConfig {
    const voice = normalizeDialogueVoice(voiceRef)
    return {
        ...voice,
        presetConfig: DIALOGUE_VOICE_PRESET_CONFIGS[voice.preset],
        stableVocabulary: true,
        keepCase: true,
        addParticles: true,
        legato: true,
    }
}

export function generateDialogueVoiceLine(text: string, voiceRef?: DialogueVoiceRef | NormalizedDialogueVoice): GeneratedDialogueVoiceLine {
    const voice = normalizeDialogueVoice(voiceRef)
    const config = buildDialogueVoiceConfig(voice)
    const tokens = String(text).match(WORD_RE) ?? []
    const lineRng = rngFrom(`${config.seed}|${config.preset}|line|${text.length}`)
    const bank = makeBank(config)
    const sequence: DialogueVoiceStep[] = []
    const out: string[] = []
    const wordMap = new Map<string, string>()
    let wordIndex = 0

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]!
        if (isWord(token)) {
            const mapped = makeWord(token, config, lineRng)
            out.push(mapped.text)
            const lower = token.toLowerCase()
            if (!wordMap.has(lower)) wordMap.set(lower, mapped.text.toLowerCase())
            for (let si = 0; si < mapped.syllables.length; si++) {
                sequence.push({
                    bank: hashBank(mapped.syllables[si]!, bank.length, config),
                    syl: mapped.syllables[si]!,
                    pun: '',
                    wordIndex,
                    syIndex: si,
                    wordLen: mapped.syllables.length,
                })
            }
            wordIndex++
            continue
        }
        out.push(token)
        if (isPunctuation(token)) {
            if (sequence.length > 0) sequence[sequence.length - 1]!.pun = token
            const particle = maybeParticle(token, tokens[i + 1], config, lineRng)
            if (particle) {
                out.push(` ${particle}`)
                sequence.push({
                    bank: hashBank(particle.toLowerCase(), bank.length, config),
                    syl: particle.toLowerCase(),
                    pun: '',
                    wordIndex,
                    syIndex: 0,
                    wordLen: 1,
                })
            }
        }
    }

    return {
        sourceText: text,
        fantasyText: out.join('')
            .replace(/\s+([,.!?;:])/g, '$1')
            .replace(/([.!?])\s+([a-z])/g, (_m, p: string, ch: string) => `${p} ${ch.toUpperCase()}`),
        bank,
        sequence,
        wordMap,
    }
}

export function parseSyllable(label: string): ParsedSyllable {
    const raw = String(label || '').toLowerCase().replace(/[^a-z]/g, '')
    const vowel = raw.match(/[aeiou]+/)
    if (!vowel) return { raw, onset: raw, nucleus: 'a', coda: '', v1: 'a', v2: 'a' }
    const onset = raw.slice(0, vowel.index)
    const nucleus = vowel[0]
    const coda = raw.slice((vowel.index ?? 0) + nucleus.length)
    return {
        raw,
        onset,
        nucleus,
        coda,
        v1: nucleus[0] || 'a',
        v2: nucleus[nucleus.length - 1] || nucleus[0] || 'a',
    }
}

function makeBank(config: DialogueVoiceConfig): DialogueVoiceToken[] {
    const c = config.controls
    const preset = config.presetConfig
    const rng = rngFrom(`${config.seed}|${config.preset}|bank|${c.bankSize}|${preset.syllablePool.join('-')}`)
    const bank: DialogueVoiceToken[] = []
    const used = new Set<string>()
    for (let i = 0; i < c.bankSize; i++) {
        let label = pick(preset.syllablePool, rng)
        if (used.has(label) && chance(0.7, rng)) label += Math.floor(2 + rng() * 8)
        used.add(label)
        const parsed = parseSyllable(label)
        bank.push({
            id: i,
            label,
            raw: parsed.raw,
            onset: parsed.onset,
            coda: parsed.coda,
            nucleus: parsed.nucleus,
            v1: parsed.v1,
            v2: parsed.v2,
            pitch: clamp(c.pitch + (rng() - 0.5) * c.variation * 2.1, 28, 220),
            dur: clamp((0.125 + rng() * 0.125) * (100 / c.speed) * (0.74 + c.mouth / 150), 0.055, 0.48),
            bright: clamp(c.formant + (rng() - 0.5) * c.variation * 0.8, 0, 100),
            harm: clamp(c.harmonics + (rng() - 0.5) * c.variation * 0.7, 0, 100),
            sub: clamp(c.subharmonics + (rng() - 0.5) * c.variation * 0.55, 0, 100),
            chest: clamp(c.chest + (rng() - 0.5) * c.variation * 0.55, 0, 100),
            double: clamp(c.double + (rng() - 0.5) * c.variation * 0.6, 0, 100),
            motion: clamp(c.motion + (rng() - 0.5) * c.variation * 0.9, 0, 100),
            jitter: clamp(c.jitter + (rng() - 0.5) * c.variation * 0.45, 0, 100),
            breath: clamp(c.breath + (rng() - 0.5) * c.variation * 0.38, 0, 100),
            creak: clamp(c.creak + (rng() - 0.5) * c.variation * 0.55, 0, 100),
            nasal: clamp(c.nasal + (rng() - 0.5) * c.variation * 0.65, 0, 100),
            consAmt: clamp(c.consonants + (rng() - 0.5) * c.variation * 0.35, 0, 100),
            plosive: clamp(c.plosives + (rng() - 0.5) * c.variation * 0.32, 0, 100),
            fricative: clamp(c.fricatives + (rng() - 0.5) * c.variation * 0.35, 0, 100),
            sonorant: clamp(c.sonorants + (rng() - 0.5) * c.variation * 0.35, 0, 100),
            transition: clamp(c.transitions + (rng() - 0.5) * c.variation * 0.28, 0, 100),
            warm: clamp(c.warmth + (rng() - 0.5) * c.variation * 0.42, 0, 100),
            stress: 0.8 + rng() * 0.45,
            phase: rng() * Math.PI * 2,
            detune: (rng() - 0.5) * 0.012,
            skew: (rng() - 0.5) * 2,
        })
    }
    return bank
}

function isWord(token: string): boolean {
    return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(token)
}

function isPunctuation(token: string): boolean {
    return /^[^\w\s]$/.test(token)
}

function wordSyllables(word: string, config: DialogueVoiceConfig, rng: Rng): number {
    const c = config.controls
    const len = word.replace(/[^A-Za-z]/g, '').length
    let count = len <= 2 ? 1 : len <= 5 ? 2 : len <= 8 ? 3 : 4
    count += c.syllables > 50
        ? Math.floor(((c.syllables - 50) / 50) * 2 + rng() * 1.5)
        : Math.ceil(((c.syllables - 50) / 50) * 1.3)
    if (chance(c.variation / 450, rng)) count++
    if (chance(c.subharmonics / 900, rng)) count = Math.max(1, count - 1)
    return clamp(count, 1, 6)
}

function makeWord(word: string, config: DialogueVoiceConfig, globalRng: Rng): { text: string; syllables: string[] } {
    const lower = word.toLowerCase()
    if (KEEP.has(lower)) return { text: lower, syllables: [lower] }
    const rng = rngFrom(config.stableVocabulary
        ? `${config.seed}|${config.preset}|${lower}`
        : `${config.seed}|${config.preset}|${lower}|${globalRng()}`)
    const count = wordSyllables(lower, config, rng)
    const syllables: string[] = []
    for (let i = 0; i < count; i++) syllables.push(fantasySyllable(config, rng, i, count))
    let mapped = syllables.join('')
    if (lower.endsWith('ing')) mapped += pick(['na', 'in', 'um', 'ka', 'esh'], rng)
    if (lower.endsWith('s') && !lower.endsWith('ss')) mapped += pick(['z', 'm', 'la', 'r'], rng)
    if (config.keepCase && word[0] === word[0]?.toUpperCase()) mapped = mapped[0]!.toUpperCase() + mapped.slice(1)
    if (config.keepCase && word.toUpperCase() === word) mapped = mapped.toUpperCase()
    return { text: mapped, syllables }
}

function fantasySyllable(config: DialogueVoiceConfig, rng: Rng, index: number, count: number): string {
    const preset = config.presetConfig
    let value = ''
    if ((config.preset === 'tiny' || config.preset === 'gnome') && chance(0.45, rng)) value = pick(preset.syllablePool, rng)
    else {
        value = pick(preset.onsetPool, rng)
            + pick(preset.vowelPool, rng)
            + ((index === count - 1 || chance(0.28, rng)) ? pick(preset.codaPool, rng) : '')
    }
    return value.replace(/([a-z])\1\1+/g, '$1$1') || 'a'
}

function maybeParticle(prev: string, next: string | undefined, config: DialogueVoiceConfig, rng: Rng): string {
    if (!config.addParticles || !/[.!?;]/.test(prev) || !next || /^\s+$/.test(next)) return ''
    if (!chance(0.2 + config.controls.prosody / 480, rng)) return ''
    const particle = pick(config.presetConfig.particlePool, rng)
    return config.keepCase ? particle[0]!.toUpperCase() + particle.slice(1) : particle
}

function hashBank(syllable: string, bankSize: number, config: DialogueVoiceConfig): number {
    if (bankSize <= 0) return 0
    return xmur3(`${config.seed}|${config.preset}|${syllable}`)() % bankSize
}

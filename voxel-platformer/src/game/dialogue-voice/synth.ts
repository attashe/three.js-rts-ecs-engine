import { clamp, rngFrom } from './random'
import { dialogueVoiceCacheKey, normalizeDialogueVoice } from './presets'
import { buildDialogueVoiceConfig, generateDialogueVoiceLine } from './text'
import type {
    DialogueVoiceConfig,
    DialogueVoiceRef,
    DialogueVoiceRenderResult,
    DialogueVoiceStep,
    DialogueVoiceToken,
    GeneratedDialogueVoiceLine,
    NormalizedDialogueVoice,
} from './types'

export const DIALOGUE_VOICE_SAMPLE_RATE = 32000
const MAX_RENDER_SECONDS = 9

type ConsonantKind = 'none' | 'plosive' | 'affricate' | 'fricative' | 'nasal' | 'liquid'
type ConsonantPlace = 'open' | 'labial' | 'dental' | 'alveolar' | 'postalveolar' | 'palatal' | 'velar' | 'central'

interface ConsonantInfo {
    kind: ConsonantKind
    place: ConsonantPlace
    voiced: boolean
}

interface BiquadFilterState {
    b0: number
    b1: number
    b2: number
    a1: number
    a2: number
    z1: number
    z2: number
}

interface LowpassState {
    x: number
    y: number
}

interface ConsonantFilterSet {
    fric: BiquadFilterState
    fricLow: BiquadFilterState
    noiseLP: LowpassState
    murmur: BiquadFilterState
    nasal: BiquadFilterState
    liquid: BiquadFilterState
}

interface Segment {
    info: ConsonantInfo
    filter: ConsonantFilterSet
    start: number
    end: number
    dur: number
}

export function synthDialogueVoiceLine(text: string, voiceRef?: DialogueVoiceRef): DialogueVoiceRenderResult {
    const voice = normalizeDialogueVoice(voiceRef)
    if (!voice.enabled || text.trim().length === 0) {
        return {
            samples: new Float32Array(0),
            sampleRate: DIALOGUE_VOICE_SAMPLE_RATE,
            fantasyText: '',
            duration: 0,
            cacheKey: dialogueVoiceCacheKey(text, voice),
        }
    }
    const config = buildDialogueVoiceConfig(voice)
    const generated = generateDialogueVoiceLine(text, voice)
    const samples = renderGeneratedLine(generated, config, DIALOGUE_VOICE_SAMPLE_RATE)
    return {
        samples,
        sampleRate: DIALOGUE_VOICE_SAMPLE_RATE,
        fantasyText: generated.fantasyText,
        duration: samples.length / DIALOGUE_VOICE_SAMPLE_RATE,
        cacheKey: dialogueVoiceCacheKey(text, voice),
    }
}

export function renderGeneratedLine(
    generated: GeneratedDialogueVoiceLine,
    config: DialogueVoiceConfig,
    sampleRate = DIALOGUE_VOICE_SAMPLE_RATE,
): Float32Array {
    const chunks: Float32Array[] = []
    const sequence = generated.sequence.slice(0, 96)
    for (let i = 0; i < sequence.length; i++) {
        const step = sequence[i]!
        const token = generated.bank[step.bank] ?? generated.bank[0]
        if (!token) continue
        const nextStep = sequence[i + 1]
        const nextToken = nextStep ? (generated.bank[nextStep.bank] ?? token) : token
        chunks.push(renderToken(token, config, sampleRate, step, i, sequence.length, nextToken))
        chunks.push(new Float32Array(Math.floor(gap(step, config) * sampleRate)))
    }
    const maxSamples = Math.floor(MAX_RENDER_SECONDS * sampleRate)
    const rawLength = Math.min(maxSamples, chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    const out = new Float32Array(rawLength)
    let pos = 0
    const crossfade = Math.floor(0.008 * sampleRate * (config.legato ? 1 : 0))
    for (const chunk of chunks) {
        if (pos >= out.length) break
        const trimmed = chunk.length > out.length - pos ? chunk.subarray(0, out.length - pos) : chunk
        crossAppend(out, trimmed, pos, crossfade)
        pos += trimmed.length
    }
    return postProcess(addRoom(out, sampleRate, config.controls.room), config)
}

function renderToken(
    token: DialogueVoiceToken,
    config: DialogueVoiceConfig,
    sampleRate: number,
    step: DialogueVoiceStep,
    index: number,
    total: number,
    nextToken: DialogueVoiceToken,
): Float32Array {
    const c = config.controls
    const pun = step.pun || ''
    const stress = (step.syIndex === 0 ? 1 + c.stress / 175 : 1) * token.stress
    const onsetInfos = clusterInfos(token.onset)
    const codaInfos = clusterInfos(token.coda)
    const onAnchor = lastOrNone(onsetInfos)
    const offAnchor = firstOrNone(codaInfos)
    const vowelDur = clamp(token.dur * (1 + (c.mouth - 50) / 235) * (/[.!?]/.test(pun) ? 1.14 : 1) * stress, 0.06, 0.58)
    const onset = segmentList(onsetInfos, token, config, 'onset', sampleRate)
    const coda = segmentList(codaInfos, token, config, 'coda', sampleRate)
    const onDur = onset.reduce((sum, segment) => sum + segment.dur, 0)
    const offDur = coda.reduce((sum, segment) => sum + segment.dur, 0)
    const dur = clamp(onDur + vowelDur + offDur, 0.07, 0.84)
    const count = Math.max(16, Math.floor(dur * sampleRate))
    const out = new Float32Array(count)

    const pitchStart = 55 * Math.pow(2, (token.pitch + pitchCurve(step, config, index, total, pun)) / 48)
    const pitchEnd = 55 * Math.pow(2, (token.pitch + (nextToken.pitch - token.pitch) * 0.032 + token.skew * 2.4) / 48)
    const vowelA = formants(token.v1, token.bright, token.nasal, c.mouth)
    const vowelB = formants(token.v2, token.bright, token.nasal, c.mouth)
    const onsetLocus = locus(onAnchor.place, token, config)
    const codaLocus = locus(offAnchor.place, token, config)
    const formantA = makeFormantSet(vowelA, token, sampleRate, 0.94)
    const formantB = makeFormantSet(vowelB, token, sampleRate, 0.96)
    const onsetFormants = makeFormantSet(onsetLocus, token, sampleRate, 0.82)
    const codaFormants = makeFormantSet(codaLocus, token, sampleRate, 0.84)
    const nasalF = bp(250 + token.nasal * 3.0, 2.2, sampleRate)
    const liquidF = bp(980 + token.bright * 7, 3.1, sampleRate)
    const chestF = bp(82 + token.chest * 2.0, 1.45, sampleRate)
    const throatF = bp(145 + token.creak * 2.0, 2.0, sampleRate)
    const airLP = lp(720 + token.bright * 16, sampleRate)
    const bodyLP = lp(240 + token.chest * 4.8, sampleRate)
    const rng = rngFrom(`${token.label}|${token.id}|${config.seed}|${index}|${pun}`)
    let phase = token.phase
    let phaseD = token.phase + 0.73
    let jitter = 0
    let shimmer = 0

    for (let n = 0; n < count; n++) {
        const t = n / sampleRate
        const localV = clamp((t - onDur) / Math.max(0.001, vowelDur), 0, 1)
        jitter = jitter * 0.993 + (rng() * 2 - 1) * 0.007
        shimmer = shimmer * 0.995 + (rng() * 2 - 1) * 0.005
        const vibrato = Math.sin(2 * Math.PI * (4.0 + token.skew * 0.6) * n / sampleRate + token.phase) * (c.prosody / 100) * 0.0046
        const freq = pitchStart + (pitchEnd - pitchStart) * smoothstep(0, 1, localV)
        const jf = 1 + jitter * (token.jitter / 100) * 0.032 + vibrato
        phase += 2 * Math.PI * freq * jf / sampleRate
        phaseD += 2 * Math.PI * freq * (1 + token.detune + (token.motion / 100) * 0.0024 * Math.sin(2 * Math.PI * localV + token.phase)) / sampleRate
        const glot = sourceWave(phase, phaseD, token, config, shimmer * (token.jitter / 100) * 0.22)
        let y = 0

        if (t < onDur && onset.length > 0) {
            const segment = segmentAt(onset, t)
            const p = (t - segment.start) / Math.max(0.001, segment.dur)
            const globalP = t / Math.max(0.001, onDur)
            y += renderConsonant(segment.info, p, 'onset', phase, glot, rng() * 2 - 1, token, config, segment.filter)
            const loc = formantMix(onsetFormants, glot) * (1 - globalP) + formantMix(formantA, glot) * globalP
            y += loc * consonantLeak(segment.info, p, 'onset', token, config)
        } else if (t > onDur + vowelDur && coda.length > 0) {
            const lt = t - onDur - vowelDur
            const segment = segmentAt(coda, lt)
            const p = (lt - segment.start) / Math.max(0.001, segment.dur)
            const globalP = lt / Math.max(0.001, offDur)
            y += renderConsonant(segment.info, p, 'coda', phase, glot, rng() * 2 - 1, token, config, segment.filter)
            const loc = formantMix(formantB, glot) * (1 - globalP) + formantMix(codaFormants, glot) * globalP
            y += loc * consonantLeak(segment.info, p, 'coda', token, config)
        }

        if (t >= onDur && t <= onDur + vowelDur) {
            const p = localV
            const attack = 0.078 - (c.mouth / 100) * 0.022
            const release = 0.19
            const env = Math.pow(clamp(Math.min(1, p / attack) * Math.min(1, (1 - p) / release), 0, 1), 0.64)
            const drift = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (p * (0.58 + token.motion * 0.010)) + token.phase)
            const mix = clamp(p * 0.70 + drift * (token.motion / 100) * 0.20, 0, 1)
            let vowel = formantMix(formantA, glot) * (1 - mix) + formantMix(formantB, glot) * mix
            const trans = (token.transition / 100) * (c.transitions / 100)
            const trLen = 0.088 + 0.050 * trans
            const startMix = onAnchor.kind === 'none' ? 0 : Math.pow(clamp(1 - p / (trLen / Math.max(vowelDur, 0.001)), 0, 1), 0.86) * trans
            const endMix = offAnchor.kind === 'none' ? 0 : Math.pow(clamp((p - (1 - trLen / Math.max(vowelDur, 0.001))) / (trLen / Math.max(vowelDur, 0.001)), 0, 1), 0.86) * trans * 0.80
            vowel = vowel * Math.max(0, 1 - startMix - endMix)
                + formantMix(onsetFormants, glot) * startMix
                + formantMix(codaFormants, glot) * endMix
            const nasal = filt(nasalF, glot) * (token.nasal / 170)
            const liquid = filt(liquidF, glot) * (onAnchor.kind === 'liquid' || offAnchor.kind === 'liquid' ? token.sonorant / 390 : 0)
            const chest = filt(chestF, glot) * (token.chest / 100) + low(bodyLP, glot) * (token.chest / 470)
            const throat = filt(throatF, glot) * (token.creak / 125)
            const air = low(airLP, rng() * 2 - 1) * (token.breath / 100) * 0.030 * (0.35 + 0.65 * env)
            y += (vowel + nasal + liquid + chest + throat + air) * env * 0.405
        }

        out[n] = softClip(y, token.warm)
    }
    fadeEnds(out)
    return out
}

const CONS_PATTERNS = ['tch', 'sch', 'thr', 'shr', 'str', 'skr', 'sk', 'st', 'sp', 'sn', 'sl', 'sm', 'sw', 'gr', 'kr', 'dr', 'tr', 'br', 'bl', 'gl', 'kl', 'fl', 'fr', 'vr', 'ch', 'sh', 'zh', 'th', 'kh', 'gh', 'ng', 'tz', 'ss', 'll', 'rr'] as const

function splitCluster(input: string): string[] {
    let s = String(input || '').toLowerCase().replace(/[^a-z]/g, '')
    const out: string[] = []
    while (s) {
        let hit = ''
        for (const pattern of CONS_PATTERNS) {
            if (s.startsWith(pattern)) { hit = pattern; break }
        }
        if (!hit) hit = s[0]!
        if (['thr', 'shr', 'str', 'skr'].includes(hit)) out.push(hit.slice(0, 2), hit.slice(2))
        else if (hit.length > 1 && ['gr', 'kr', 'dr', 'tr', 'br', 'bl', 'gl', 'kl', 'fl', 'fr', 'vr', 'sk', 'st', 'sp', 'sn', 'sl', 'sm', 'sw'].includes(hit)) out.push(hit[0]!, hit.slice(1))
        else out.push(hit)
        s = s.slice(hit.length)
    }
    return out.filter(Boolean).slice(0, 4)
}

function consInfo(value: string): ConsonantInfo {
    const s = String(value || '').toLowerCase()
    if (!s) return { kind: 'none', place: 'open', voiced: false }
    if (s === 'ng') return { kind: 'nasal', place: 'velar', voiced: true }
    if (/[mn]/.test(s[0]!)) return { kind: 'nasal', place: s[0] === 'm' ? 'labial' : 'alveolar', voiced: true }
    if (/^(l|r|w|y)/.test(s)) return { kind: 'liquid', place: s[0] === 'w' ? 'labial' : s[0] === 'y' ? 'palatal' : 'alveolar', voiced: true }
    if (/^(ch|j|tz|tch)/.test(s)) return { kind: 'affricate', place: 'postalveolar', voiced: s[0] === 'j' }
    if (/^(sh|zh|ss)/.test(s)) return { kind: 'fricative', place: 'postalveolar', voiced: s[0] === 'z' }
    if (/^(kh|gh|x|h)/.test(s)) return { kind: 'fricative', place: 'velar', voiced: s[0] === 'g' }
    if (/^(th)/.test(s)) return { kind: 'fricative', place: 'dental', voiced: false }
    if (/[sfvz]/.test(s[0]!)) return { kind: 'fricative', place: s[0] === 'f' || s[0] === 'v' ? 'labial' : 'alveolar', voiced: s[0] === 'v' || s[0] === 'z' }
    if (/[pbtdkg]/.test(s[0]!)) return { kind: 'plosive', place: 'pb'.includes(s[0]!) ? 'labial' : 'td'.includes(s[0]!) ? 'alveolar' : 'velar', voiced: 'bdg'.includes(s[0]!) }
    return { kind: 'liquid', place: 'central', voiced: true }
}

function clusterInfos(value: string): ConsonantInfo[] {
    return splitCluster(value).map(consInfo).filter((info) => info.kind !== 'none')
}

function lastOrNone(values: ConsonantInfo[]): ConsonantInfo {
    return values[values.length - 1] ?? { kind: 'none', place: 'open', voiced: false }
}

function firstOrNone(values: ConsonantInfo[]): ConsonantInfo {
    return values[0] ?? { kind: 'none', place: 'open', voiced: false }
}

function segmentList(
    infos: ConsonantInfo[],
    token: DialogueVoiceToken,
    config: DialogueVoiceConfig,
    where: 'onset' | 'coda',
    sampleRate: number,
): Segment[] {
    const c = config.controls
    const arr = infos.map((info, index) => ({
        info,
        filter: consFilters(info, token, sampleRate),
        dur: segmentDuration(info, token, config, where) * (index ? 0.68 : 1),
        start: 0,
        end: 0,
    }))
    const max = (where === 'onset' ? 0.118 : 0.132) * (100 / c.speed) * (0.82 + c.consonants / 260)
    const sum = arr.reduce((total, segment) => total + segment.dur, 0)
    if (sum > max && sum > 0) {
        const scale = max / sum
        for (const segment of arr) segment.dur *= scale
    }
    let pos = 0
    for (const segment of arr) {
        segment.start = pos
        pos += segment.dur
        segment.end = pos
    }
    return arr
}

function segmentAt(segments: Segment[], time: number): Segment {
    for (const segment of segments) if (time <= segment.end) return segment
    return segments[segments.length - 1]!
}

function segmentDuration(info: ConsonantInfo, token: DialogueVoiceToken, config: DialogueVoiceConfig, where: 'onset' | 'coda'): number {
    const speed = 100 / config.controls.speed
    const art = config.controls.consonants / 100
    if (info.kind === 'none') return 0
    if (info.kind === 'plosive') return (0.042 + 0.038 * token.plosive / 100) * art * speed * (where === 'coda' ? 0.8 : 1)
    if (info.kind === 'affricate') return (0.062 + 0.052 * token.fricative / 100) * art * speed
    if (info.kind === 'fricative') return (0.064 + 0.074 * token.fricative / 100) * art * speed * (where === 'coda' ? 1.08 : 1)
    if (info.kind === 'nasal') return (0.055 + 0.070 * token.sonorant / 100) * art * speed
    if (info.kind === 'liquid') return (0.045 + 0.060 * token.sonorant / 100) * art * speed
    return 0.030 * speed
}

function renderConsonant(
    info: ConsonantInfo,
    p: number,
    where: 'onset' | 'coda',
    phase: number,
    glot: number,
    noise: number,
    token: DialogueVoiceToken,
    config: DialogueVoiceConfig,
    filters: ConsonantFilterSet,
): number {
    if (info.kind === 'none') return 0
    const art = (token.consAmt / 100) * (0.48 + config.controls.consonants / 260)
    const placeGain = info.place === 'alveolar' ? 1.02 : info.place === 'postalveolar' ? 0.92 : info.place === 'velar' ? 0.86 : info.place === 'labial' ? 0.66 : 0.78
    const murmur = filt(filters.murmur, glot)
    const liquid = filt(filters.liquid, glot)
    if (info.kind === 'plosive') {
        const pp = token.plosive / 100
        const hold = where === 'onset' ? 1 - smoothstep(0.32, 0.74, p) : 1 - smoothstep(0.18, 0.80, p)
        const release = where === 'onset' ? bell(p, 0.76, 0.05) : bell(p, 0.14, 0.12)
        return (murmur * 0.07) * (pp * art * (info.voiced ? 1 : 0)) * hold
            + shapedNoise(filters, noise, 0.42) * (0.014 * pp * art * placeGain) * release
    }
    if (info.kind === 'affricate') {
        const stream = smoothstep(0.30, 0.55, p) * (1 - smoothstep(0.88, 1, p))
        return shapedNoise(filters, noise, 0.48) * (0.024 * token.fricative / 100 * art * placeGain) * stream
            + (info.voiced ? murmur * 0.055 * art * (1 - stream) : 0)
    }
    if (info.kind === 'fricative') {
        const stream = Math.pow(Math.sin(Math.PI * p), 0.60) * smoothstep(0, 0.18, p) * (1 - smoothstep(0.84, 1, p))
        return shapedNoise(filters, noise, 0.70) * (0.032 * token.fricative / 100 * art * placeGain) * stream
            + (info.voiced ? (murmur * 0.060 + liquid * 0.010) * art * stream : murmur * 0.010 * art * stream)
    }
    if (info.kind === 'nasal') {
        const e = Math.pow(Math.sin(Math.PI * p), 0.38)
        return filt(filters.nasal, glot) * (0.24 * token.sonorant / 100 * art) * e
            + murmur * (0.13 * token.sonorant / 100 * art) * e
            + Math.sin(phase * 0.5 + token.phase) * (0.020 * token.sonorant / 100 * art) * e
    }
    if (info.kind === 'liquid') {
        const e = Math.pow(Math.sin(Math.PI * p), 0.44)
        return liquid * (0.18 * token.sonorant / 100 * art) * e
            + murmur * (0.048 * token.sonorant / 100 * art) * e
    }
    return 0
}

function consonantLeak(info: ConsonantInfo, p: number, where: 'onset' | 'coda', token: DialogueVoiceToken, config: DialogueVoiceConfig): number {
    if (info.kind === 'none') return 0
    const art = (token.consAmt / 100) * (config.controls.consonants / 100)
    const base = info.kind === 'nasal' ? 0.19
        : info.kind === 'liquid' ? 0.17
            : info.kind === 'fricative' ? (info.voiced ? 0.060 : 0.024)
                : info.kind === 'affricate' ? (info.voiced ? 0.052 : 0.018)
                    : (info.voiced ? 0.045 : 0.012)
    const shape = where === 'onset' ? smoothstep(0.15, 0.94, p) : (1 - smoothstep(0.06, 0.84, p))
    return base * art * shape
}

function sourceWave(phase: number, phaseD: number, token: DialogueVoiceToken, config: DialogueVoiceConfig, shimmer: number): number {
    const h = token.harm / 100
    const bright = token.bright / 100
    const sub = token.sub / 100
    const dbl = token.double / 100
    const creak = token.creak / 100
    const pulse = Math.tanh((Math.sin(phase) + 0.38 * Math.sin(phase * 2 - 0.75) + 0.10 * Math.sin(phase * 3 + 0.35)) * (1.05 + creak * 1.25 + h * 0.55))
    let x = pulse * (0.54 + 0.10 * bright)
    const harmonics = 3 + Math.floor(h * 10)
    const tilt = 1.45 - bright * 0.42 + creak * 0.20
    for (let k = 2; k <= harmonics; k++) {
        const odd = k % 2 ? 1.10 : 0.86
        const amp = Math.pow(k, -tilt) * (0.38 * h) * odd * (1 + (k % 2 ? token.skew * 0.045 : -token.skew * 0.035))
        x += Math.sin(phase * k + token.phase * 0.17 * k) * amp
    }
    x += Math.sin(phase * 0.5 + token.phase) * (0.16 * sub)
    x += Math.sin(phase / 3 + token.phase * 1.7) * (0.045 * sub * creak)
    if (dbl > 0) x += Math.sin(phaseD) * (0.16 * dbl) + Math.sin(phaseD * 2 + 1.1) * (0.045 * dbl * h)
    return x * (1 + shimmer) * (0.96 + config.controls.harmonics / 1500)
}

function pitchCurve(step: DialogueVoiceStep, config: DialogueVoiceConfig, index: number, total: number, pun: string): number {
    const phrase = index / Math.max(1, total - 1)
    const prosody = config.controls.prosody / 100
    const arch = Math.sin(Math.PI * phrase) * 5 * prosody
    const fall = (pun === '.' ? -5 : pun === '?' ? 7 : pun === '!' ? 4 : pun === ',' ? 2 : 0) * prosody
    const wordStress = (step.syIndex === 0 ? 1 : 0) * (config.controls.stress / 100) * 3.6
    const alt = ((step.wordIndex % 3) - 1) * 0.9 * prosody
    return arch + fall + wordStress + alt
}

function gap(step: DialogueVoiceStep, config: DialogueVoiceConfig): number {
    let g = 0.018 * (100 / config.controls.speed)
    if (step.pun === ',') g += 0.06
    if (step.pun === '.' || step.pun === '!') g += 0.13
    if (step.pun === '?') g += 0.15
    if (config.legato && !/[.!?,]/.test(step.pun)) g *= 0.22
    return clamp(g, 0.002, 0.24)
}

function formants(vowel: string, bright: number, nasal: number, mouth: number): [number, number, number] {
    const base = ({ a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240] } as Record<string, [number, number, number]>)[vowel] ?? [650, 1200, 2400]
    const b = bright / 100
    const n = nasal / 100
    const m = mouth / 100
    return [
        base[0] * (0.76 + b * 0.38 + m * 0.12) + n * 80,
        base[1] * (0.80 + b * 0.34) + n * 250,
        base[2] * (0.84 + b * 0.24),
    ]
}

function locus(place: ConsonantPlace, token: DialogueVoiceToken, config: DialogueVoiceConfig): [number, number, number] {
    const f = token.bright / 100
    const m = config.controls.mouth / 100
    if (place === 'labial') return [360 + 120 * m, 760 + 180 * f, 2200]
    if (place === 'dental') return [430 + 130 * m, 1450 + 250 * f, 2550]
    if (place === 'alveolar') return [420 + 120 * m, 1750 + 350 * f, 2650]
    if (place === 'postalveolar') return [410 + 100 * m, 1350 + 260 * f, 2300]
    if (place === 'palatal') return [330 + 90 * m, 2050 + 350 * f, 2850]
    if (place === 'velar') return [470 + 140 * m, 1180 + 220 * f, 2500]
    return formants(token.v1, token.bright, token.nasal, config.controls.mouth)
}

function fricFreq(place: ConsonantPlace): number {
    return place === 'labial' ? 1250 : place === 'dental' ? 2900 : place === 'alveolar' ? 5200 : place === 'postalveolar' ? 2800 : place === 'velar' ? 1800 : 3200
}

function consFilters(info: ConsonantInfo, token: DialogueVoiceToken, sampleRate: number): ConsonantFilterSet {
    const base = fricFreq(info.place)
    return {
        fric: bp(base, info.kind === 'fricative' ? 1.55 : 3.6, sampleRate),
        fricLow: bp(Math.max(360, base * 0.42), 1.25, sampleRate),
        noiseLP: lp(1800 + token.bright * 18, sampleRate),
        murmur: bp(155 + token.chest * 2.0 + (info.place === 'velar' ? 58 : 0), 1.45, sampleRate),
        nasal: bp(245 + (info.place === 'velar' ? 85 : 0), 1.55, sampleRate),
        liquid: bp(700 + (info.place === 'palatal' ? 620 : 0) + token.bright * 5, 2.25, sampleRate),
    }
}

function bp(freq: number, q: number, sampleRate: number): BiquadFilterState {
    const f = clamp(freq, 40, sampleRate * 0.45)
    const w = 2 * Math.PI * f / sampleRate
    const a = Math.sin(w) / (2 * q)
    const cc = Math.cos(w)
    const a0 = 1 + a
    return { b0: a / a0, b1: 0, b2: -a / a0, a1: -2 * cc / a0, a2: (1 - a) / a0, z1: 0, z2: 0 }
}

function lp(freq: number, sampleRate: number): LowpassState {
    return { x: Math.exp(-2 * Math.PI * freq / sampleRate), y: 0 }
}

function filt(filter: BiquadFilterState, input: number): number {
    const y = filter.b0 * input + filter.z1
    filter.z1 = filter.b1 * input - filter.a1 * y + filter.z2
    filter.z2 = filter.b2 * input - filter.a2 * y
    return y
}

function low(filter: LowpassState, input: number): number {
    filter.y = (1 - filter.x) * input + filter.x * filter.y
    return filter.y
}

function shapedNoise(filters: ConsonantFilterSet, noise: number, amount: number): number {
    const slow = low(filters.noiseLP, noise)
    return (filt(filters.fric, slow) * 0.34 + filt(filters.fricLow, slow) * 0.10) * amount
}

function makeFormantSet(freqs: [number, number, number], token: DialogueVoiceToken, sampleRate: number, scale = 1): [BiquadFilterState, BiquadFilterState, BiquadFilterState] {
    const q = 3.35 + token.bright * 0.014
    return [bp(freqs[0], q * scale, sampleRate), bp(freqs[1], (q + 0.9) * scale, sampleRate), bp(freqs[2], (q + 2.0) * scale, sampleRate)]
}

function formantMix(filters: [BiquadFilterState, BiquadFilterState, BiquadFilterState], glot: number): number {
    return filt(filters[0], glot) * 1.03 + filt(filters[1], glot) * 0.60 + filt(filters[2], glot) * 0.24
}

function softClip(input: number, amount: number): number {
    const a = amount / 100
    if (a <= 0.001) return input
    const drive = 1 + a * 2.8
    return Math.tanh(input * drive) / (Math.tanh(drive) || 1)
}

function smoothstep(a: number, b: number, x: number): number {
    const t = clamp((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

function bell(x: number, center: number, width: number): number {
    const d = (x - center) / Math.max(0.001, width)
    return Math.exp(-d * d)
}

function crossAppend(dst: Float32Array, src: Float32Array, pos: number, crossfade: number): void {
    if (src.length === 0 || pos >= dst.length) return
    if (pos === 0 || crossfade <= 0) {
        dst.set(src.subarray(0, Math.min(src.length, dst.length - pos)), pos)
        return
    }
    const overlap = Math.min(crossfade, src.length, pos, dst.length - pos)
    for (let i = 0; i < overlap; i++) {
        const a = i / overlap
        dst[pos - overlap + i] = dst[pos - overlap + i]! * (1 - a) + src[i]! * a
    }
    if (overlap < src.length && pos < dst.length) dst.set(src.subarray(overlap, overlap + dst.length - pos), pos)
}

function addRoom(samples: Float32Array, sampleRate: number, amount: number): Float32Array {
    const a = amount / 100
    if (a <= 0.001 || samples.length === 0) return samples
    const out = new Float32Array(samples.length)
    const d1 = Math.floor(0.031 * sampleRate)
    const d2 = Math.floor(0.067 * sampleRate)
    const d3 = Math.floor(0.109 * sampleRate)
    for (let i = 0; i < samples.length; i++) {
        let y = samples[i]!
        if (i > d1) y += out[i - d1]! * 0.20 * a
        if (i > d2) y += out[i - d2]! * 0.13 * a
        if (i > d3) y += out[i - d3]! * 0.075 * a
        out[i] = y
    }
    return out
}

function postProcess(samples: Float32Array, config: DialogueVoiceConfig): Float32Array {
    if (samples.length === 0) return samples
    const out = new Float32Array(samples.length)
    let prevX = 0
    let prevY = 0
    let peak = 0.001
    let rms = 0
    for (let i = 0; i < samples.length; i++) {
        let y = samples[i]! - prevX + 0.996 * prevY
        prevX = samples[i]!
        prevY = y
        const ax = Math.abs(y)
        const threshold = 0.58
        const knee = 0.30
        if (ax > threshold) y = Math.sign(y) * (threshold + (ax - threshold) / (1 + (ax - threshold) / knee))
        out[i] = y
        peak = Math.max(peak, Math.abs(y))
        rms += y * y
    }
    rms = Math.sqrt(rms / Math.max(1, out.length))
    const target = 0.135 + (config.controls.warmth / 100) * 0.025
    const gain = Math.min(1.55, target / Math.max(0.012, rms), 0.92 / peak)
    const warm = config.controls.warmth / 100
    for (let i = 0; i < out.length; i++) {
        const y = out[i]! * gain * (1.02 + warm * 0.12)
        out[i] = Math.tanh(y * (1 + warm * 0.46)) / (Math.tanh(1 + warm * 0.46) || 1)
    }
    return out
}

function fadeEnds(samples: Float32Array): void {
    const fade = Math.min(170, Math.floor(samples.length * 0.075))
    for (let i = 0; i < fade; i++) {
        const a = i / fade
        samples[i] *= a
        samples[samples.length - 1 - i] *= a
    }
}

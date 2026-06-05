// Cinematics data model — a cinematic is an ordered list of timed steps that
// direct the camera, on-screen text, character speech and movement. Everything
// here is plain JSON-serializable data (no functions, no engine handles) so it
// round-trips through the level serializer for free and is safe to clone.
//
// Sequencing: steps run in order. A step's `wait` flag decides whether the
// sequence blocks for it before starting the next step (`wait: true`, "▶") or
// lets the next step begin concurrently (`wait: false`, "‖"). That maps 1:1 to
// the async runtime: `await step` vs fire-and-continue (see CinematicDirector).

import type { EaseKind } from './ease'

export type { EaseKind }

export interface Vec3 {
    x: number
    y: number
    z: number
}

/** A free camera framing: where the camera sits, what it looks at, and the
 *  orthographic zoom. Captured directly from the editor's orbit camera. */
export interface CameraShot {
    position: Vec3
    target: Vec3
    zoom: number
}

export type CinematicStepType =
    | 'camera'
    | 'subtitle'
    | 'speech'
    | 'move'
    | 'wait'
    | 'fade'
    | 'sound'

interface StepBase {
    /** Stable id, unique within the cinematic — used as the editor list key. */
    id: string
}

export interface CameraStep extends StepBase {
    type: 'camera'
    wait: boolean
    /** Tween seconds; 0 = a hard cut. */
    duration: number
    ease: EaseKind
    shot: CameraShot
}

export interface SubtitleStep extends StepBase {
    type: 'subtitle'
    wait: boolean
    duration: number
    text: string
    speaker?: string
}

export interface SpeechStep extends StepBase {
    type: 'speech'
    wait: boolean
    npcId: string
    text: string
    /** On-screen seconds; defaults to an estimate from the text length. */
    seconds?: number
}

export interface MoveStep extends StepBase {
    type: 'move'
    /** `wait: true` blocks until the NPC arrives (or `timeoutSeconds` elapses). */
    wait: boolean
    npcId: string
    to: Vec3
    timeoutSeconds?: number
}

export interface WaitStep extends StepBase {
    type: 'wait'
    /** Always blocks — a pure pause to pace the sequence. */
    wait: true
    duration: number
}

export interface FadeStep extends StepBase {
    type: 'fade'
    wait: boolean
    duration: number
    to: 'black' | 'clear'
}

export interface SoundStep extends StepBase {
    type: 'sound'
    /** Fire-and-forget — never blocks the sequence. */
    wait: false
    soundId: string
    volume?: number
    fade?: number
}

export type CinematicStep =
    | CameraStep
    | SubtitleStep
    | SpeechStep
    | MoveStep
    | WaitStep
    | FadeStep
    | SoundStep

export interface Cinematic {
    id: string
    name: string
    /** Auto-play once when the level starts. */
    playOnStart?: boolean
    /** Show letterbox bars during playback. Default true. */
    letterbox?: boolean
    /** Freeze player input/control during playback. Default true. */
    freezePlayer?: boolean
    /** When this cinematic finishes, end the game — the runtime rolls the
     *  endgame credits and returns to the title. Used for the final shrine. */
    endsGame?: boolean
    steps: CinematicStep[]
}

/** Default seconds a `move` step waits for arrival before giving up. */
export const DEFAULT_MOVE_TIMEOUT_SECONDS = 8
/** Distance (world units) under which an NPC counts as "arrived". */
export const MOVE_ARRIVAL_EPSILON = 0.6

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (shared by editor + runtime + tests)
// ─────────────────────────────────────────────────────────────────────

function cloneVec(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z }
}

export function cloneShot(shot: CameraShot): CameraShot {
    return { position: cloneVec(shot.position), target: cloneVec(shot.target), zoom: shot.zoom }
}

export function cloneStep(step: CinematicStep): CinematicStep {
    switch (step.type) {
        case 'camera':
            return { ...step, shot: cloneShot(step.shot) }
        case 'move':
            return { ...step, to: cloneVec(step.to) }
        default:
            return { ...step }
    }
}

export function cloneCinematic(c: Cinematic): Cinematic {
    return {
        id: c.id,
        name: c.name,
        playOnStart: c.playOnStart,
        letterbox: c.letterbox,
        freezePlayer: c.freezePlayer,
        endsGame: c.endsGame,
        steps: c.steps.map(cloneStep),
    }
}

/** Whether a step blocks the sequence before the next step starts. */
export function stepWaits(step: CinematicStep): boolean {
    return step.wait
}

/** A readable-pace estimate of how long a line of speech stays on screen. */
export function estimateSpeechSeconds(text: string): number {
    const words = text.trim().split(/\s+/).filter(Boolean).length
    // ~2.2 words/sec reading pace, clamped so very short/long lines stay sane.
    return Math.max(1.5, Math.min(9, words / 2.2 + 0.8))
}

/** Nominal on-stage duration of a single step (for the editor scrubber). For
 *  `move` this is the timeout, since real arrival time isn't known up front. */
export function stepDuration(step: CinematicStep): number {
    switch (step.type) {
        case 'camera':
        case 'subtitle':
        case 'wait':
        case 'fade':
            return Math.max(0, step.duration)
        case 'speech':
            return step.seconds ?? estimateSpeechSeconds(step.text)
        case 'move':
            return step.timeoutSeconds ?? DEFAULT_MOVE_TIMEOUT_SECONDS
        case 'sound':
            return 0
    }
}

/**
 * Estimated total seconds, honouring the wait/parallel model: only `wait`
 * steps advance the sequence clock; concurrent (`wait: false`) steps merely
 * extend the furthest end time. Mirrors the director's execution exactly.
 */
export function estimateDuration(c: Cinematic): number {
    let clock = 0
    let maxEnd = 0
    for (const step of c.steps) {
        const end = clock + stepDuration(step)
        if (end > maxEnd) maxEnd = end
        if (stepWaits(step)) clock = end
    }
    return Math.max(clock, maxEnd)
}

/** Validation problems for a cinematic; empty = valid. `knownNpcIds`, when
 *  given, flags speech/move steps that target a missing NPC. */
export function validateCinematic(c: Cinematic, knownNpcIds?: ReadonlySet<string>): string[] {
    const problems: string[] = []
    if (!c.id) problems.push('Cinematic has no id.')
    if (c.steps.length === 0) problems.push(`"${c.name}" has no steps.`)
    const seen = new Set<string>()
    for (const step of c.steps) {
        if (seen.has(step.id)) problems.push(`Duplicate step id "${step.id}".`)
        seen.add(step.id)
        if ((step.type === 'speech' || step.type === 'move') && knownNpcIds && !knownNpcIds.has(step.npcId)) {
            problems.push(`Step "${step.id}" targets unknown NPC "${step.npcId}".`)
        }
        if ('duration' in step && step.duration < 0) {
            problems.push(`Step "${step.id}" has a negative duration.`)
        }
    }
    return problems
}

/** Build a fresh step of the given type with sensible defaults. The caller
 *  supplies the `id` (editor uses a per-cinematic counter). `shot` seeds a
 *  camera step (e.g. the current view) when provided. */
export function newStep(type: CinematicStepType, id: string, shot?: CameraShot): CinematicStep {
    switch (type) {
        case 'camera':
            return { id, type, wait: true, duration: 2, ease: 'easeInOut', shot: shot ? cloneShot(shot) : zeroShot() }
        case 'subtitle':
            return { id, type, wait: true, duration: 3, text: '' }
        case 'speech':
            return { id, type, wait: true, npcId: '', text: '' }
        case 'move':
            return { id, type, wait: true, npcId: '', to: { x: 0, y: 0, z: 0 } }
        case 'wait':
            return { id, type, wait: true, duration: 1 }
        case 'fade':
            return { id, type, wait: true, duration: 0.8, to: 'black' }
        case 'sound':
            return { id, type, wait: false, soundId: '', fade: 0 }
    }
}

function zeroShot(): CameraShot {
    return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, zoom: 1 }
}

// Serializable animation state-graph definition + validation.
//
// PURE module — no `three` import — so it compiles under tsconfig.test.json and
// the whole graph contract is unit-testable headless. The runtime
// (AnimationController) consumes these defs to drive a THREE.AnimationMixer, and
// the editor authors/serialises them, but neither concern leaks in here.

/** How a clip plays once selected as a state. */
export type LoopMode = 'loop' | 'once' | 'clamp'

/** Comparison operators allowed in a transition condition. */
export type CmpOp = '<' | '<=' | '>' | '>=' | '==' | '!='

export const CMP_OPS: readonly CmpOp[] = ['<', '<=', '>', '>=', '==', '!=']
export const LOOP_MODES: readonly LoopMode[] = ['loop', 'once', 'clamp']

/** A single `param <op> value` test against the state machine's param bag. */
export interface Condition {
    param: string
    op: CmpOp
    value: number
}

/** One animation state. `clip` defaults to `id`, so a state named `walk`
 *  plays the `walk` clip unless overridden. */
export interface AnimStateDef {
    id: string
    clip?: string
    loop?: LoopMode
    /** Playback-speed multiplier. Defaults to 1. */
    speed?: number
    /** When true, the controller scales this clip's playback by the character's
     *  movement speed (reduces foot-sliding on locomotion clips). */
    syncToSpeed?: boolean
    /** Movement speed (world units/s) at which a sync'd clip plays at its base
     *  `speed`. Faster movement speeds the clip up, slower slows it. */
    syncRefSpeed?: number
}

/** A directed, conditional transition between states. */
export interface AnimTransitionDef {
    /** Source state id, or `'*'` to match from any state. */
    from: string | '*'
    to: string
    /** ANDed; empty/omitted => always satisfied (an exit-time transition). */
    conditions?: Condition[]
    /** Crossfade duration in seconds. Defaults to 0.2. */
    blendSeconds?: number
    /** Higher priority wins when several transitions are satisfied the same
     *  tick. Defaults to 0. */
    priority?: number
    /** Minimum seconds spent in the source state before this may fire
     *  (debounce). Defaults to 0. */
    minTimeInState?: number
}

/** A numeric parameter the graph reads in its conditions. */
export interface AnimParamDef {
    name: string
    default: number
    /** A one-shot trigger: gameplay sets it (e.g. to 1), it's visible to exactly
     *  one `tick()`'s transition evaluation, then the state machine resets it to
     *  `default`. Use for attack/cast-style events; leave off for latched/level
     *  params (speed, grounded, dead). */
    trigger?: boolean
}

/** A complete, serialisable animation graph. */
export interface AnimGraphDef {
    schemaVersion: number
    id: string
    initial: string
    params?: AnimParamDef[]
    states: AnimStateDef[]
    transitions: AnimTransitionDef[]
}

export const ANIM_GRAPH_SCHEMA_VERSION = 1

export interface AnimGraphValidation {
    ok: boolean
    errors: string[]
}

export interface MissingGraphClip {
    stateId: string
    clip: string
}

export interface AnimGraphClipValidation {
    ok: boolean
    missing: MissingGraphClip[]
}

// ── Defaulted accessors (single source of truth for the implicit defaults) ──

export function stateClip(state: AnimStateDef): string {
    return state.clip ?? state.id
}

export function stateLoop(state: AnimStateDef): LoopMode {
    return state.loop ?? 'loop'
}

export function stateSpeed(state: AnimStateDef): number {
    return Number.isFinite(state.speed) ? state.speed! : 1
}

export function stateSyncRefSpeed(state: AnimStateDef): number {
    return Number.isFinite(state.syncRefSpeed) && state.syncRefSpeed! > 0 ? state.syncRefSpeed! : 1
}

export function transitionBlend(t: AnimTransitionDef): number {
    return Number.isFinite(t.blendSeconds) ? Math.max(0, t.blendSeconds!) : 0.2
}

export function transitionPriority(t: AnimTransitionDef): number {
    return Number.isFinite(t.priority) ? t.priority! : 0
}

export function transitionMinTime(t: AnimTransitionDef): number {
    return Number.isFinite(t.minTimeInState) ? Math.max(0, t.minTimeInState!) : 0
}

/**
 * Validate an (untrusted) graph definition. Accepts `unknown` so it doubles as
 * the deserialisation guard — it narrows and reports every structural problem
 * rather than throwing. Returns `{ ok, errors }`.
 */
export function validateAnimGraph(input: unknown): AnimGraphValidation {
    const errors: string[] = []
    if (!isRecord(input)) {
        return { ok: false, errors: ['graph must be an object'] }
    }

    if (typeof input.schemaVersion !== 'number') errors.push('schemaVersion must be a number')
    if (typeof input.id !== 'string' || input.id.length === 0) errors.push('id must be a non-empty string')

    const states = input.states
    const stateIds = new Set<string>()
    if (!Array.isArray(states) || states.length === 0) {
        errors.push('states must be a non-empty array')
    } else {
        for (const s of states) {
            if (!isRecord(s) || typeof s.id !== 'string' || s.id.length === 0) {
                errors.push('every state needs a non-empty string id')
                continue
            }
            if (stateIds.has(s.id)) errors.push(`duplicate state id "${s.id}"`)
            stateIds.add(s.id)
            if (s.loop !== undefined && !LOOP_MODES.includes(s.loop as LoopMode)) {
                errors.push(`state "${s.id}" has invalid loop "${String(s.loop)}"`)
            }
        }
    }

    if (typeof input.initial !== 'string' || !stateIds.has(input.initial)) {
        errors.push(`initial "${String(input.initial)}" must reference a declared state`)
    }

    const paramNames = new Set<string>()
    if (input.params !== undefined) {
        if (!Array.isArray(input.params)) {
            errors.push('params must be an array when present')
        } else {
            for (const p of input.params) {
                if (!isRecord(p) || typeof p.name !== 'string' || typeof p.default !== 'number') {
                    errors.push('every param needs a string name and number default')
                    continue
                }
                paramNames.add(p.name)
            }
        }
    }

    const transitions = input.transitions
    if (!Array.isArray(transitions)) {
        errors.push('transitions must be an array')
    } else {
        for (const t of transitions) {
            if (!isRecord(t)) { errors.push('every transition must be an object'); continue }
            if (t.from !== '*' && (typeof t.from !== 'string' || !stateIds.has(t.from))) {
                errors.push(`transition.from "${String(t.from)}" must be '*' or a declared state`)
            }
            if (typeof t.to !== 'string' || !stateIds.has(t.to)) {
                errors.push(`transition.to "${String(t.to)}" must be a declared state`)
            }
            if (t.conditions !== undefined) {
                if (!Array.isArray(t.conditions)) {
                    errors.push(`transition ${String(t.from)}→${String(t.to)} conditions must be an array`)
                } else {
                    for (const c of t.conditions) {
                        if (!isRecord(c) || typeof c.param !== 'string' || typeof c.value !== 'number'
                            || !CMP_OPS.includes(c.op as CmpOp)) {
                            errors.push(`transition ${String(t.from)}→${String(t.to)} has a malformed condition`)
                            continue
                        }
                        if (paramNames.size > 0 && !paramNames.has(c.param)) {
                            errors.push(`condition references undeclared param "${c.param}"`)
                        }
                    }
                }
            }
        }
    }

    return { ok: errors.length === 0, errors }
}

/** Validate that every graph state can resolve its configured clip. This keeps
 *  missing action/pose clips from degrading into silent T-poses or frozen
 *  layers at runtime. */
export function validateGraphClips(graph: AnimGraphDef, clipNames: Iterable<string>): AnimGraphClipValidation {
    const available = new Set(clipNames)
    const seen = new Set<string>()
    const missing: MissingGraphClip[] = []
    for (const state of graph.states) {
        const clip = stateClip(state)
        if (available.has(clip) || seen.has(`${state.id}:${clip}`)) continue
        missing.push({ stateId: state.id, clip })
        seen.add(`${state.id}:${clip}`)
    }
    return { ok: missing.length === 0, missing }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

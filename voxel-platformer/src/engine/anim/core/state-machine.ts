// Pure animation state-machine evaluator.
//
// Decides which state is active and, during a transition, the crossfade weights
// between the outgoing and incoming states. Knows nothing about Three — it emits
// `ActiveLayer[]` (state id + weight, summing to 1) that the AnimationController
// maps onto AnimationActions. Deterministic and side-effect-free per tick, so
// it's fully unit-testable.

import type { AnimGraphDef, AnimTransitionDef } from './state-graph'
import { transitionBlend, transitionMinTime, transitionPriority } from './state-graph'
import { evalConditions, type AnimParamBag } from './conditions'

/** A state contributing to the current pose, with its normalised weight. */
export interface ActiveLayer {
    stateId: string
    weight: number
}

export class AnimStateMachine {
    private readonly def: AnimGraphDef
    private readonly params: AnimParamBag = {}
    /** name → default for one-shot trigger params, reset after each tick. */
    private readonly triggerDefaults: ReadonlyArray<readonly [string, number]>
    private current: string
    private previous: string | null = null
    private timeInState = 0
    private blendElapsed = 0
    private blendDuration = 0

    constructor(def: AnimGraphDef) {
        this.def = def
        this.current = def.initial
        for (const p of def.params ?? []) this.params[p.name] = p.default
        this.triggerDefaults = (def.params ?? []).filter((p) => p.trigger).map((p) => [p.name, p.default] as const)
    }

    setParam(name: string, value: number): void {
        this.params[name] = value
    }

    setParams(bag: AnimParamBag): void {
        for (const k in bag) this.params[k] = bag[k]!
    }

    get currentStateId(): string { return this.current }
    get previousStateId(): string | null { return this.previous }
    get timeInCurrentState(): number { return this.timeInState }

    /** 0..1 crossfade progress into the current state (1 when not blending). */
    get blendAlpha(): number {
        if (this.blendDuration <= 0) return 1
        return Math.min(1, this.blendElapsed / this.blendDuration)
    }

    /** Advance time, evaluate transitions, and return the active layer weights. */
    tick(dt: number): ActiveLayer[] {
        this.timeInState += dt
        this.blendElapsed += dt

        const next = this.pickTransition()
        if (next) {
            this.previous = this.current
            this.current = next.to
            this.timeInState = 0
            this.blendElapsed = 0
            this.blendDuration = transitionBlend(next)
        }

        // Triggers are consumed by this tick's transition pick; clear them so
        // they fire exactly once per gameplay `setParam`.
        for (const [name, dflt] of this.triggerDefaults) this.params[name] = dflt

        return this.layers()
    }

    /** Snap to a state with no blend (editor scrubbing / explicit overrides). */
    reset(stateId: string = this.def.initial): void {
        this.current = stateId
        this.previous = null
        this.timeInState = 0
        this.blendElapsed = 0
        this.blendDuration = 0
        for (const [name, dflt] of this.triggerDefaults) this.params[name] = dflt
    }

    private pickTransition(): AnimTransitionDef | null {
        let best: AnimTransitionDef | null = null
        let bestPriority = -Infinity
        for (const t of this.def.transitions) {
            if (t.from !== '*' && t.from !== this.current) continue
            if (t.to === this.current) continue
            if (this.timeInState < transitionMinTime(t)) continue
            if (!evalConditions(t.conditions, this.params)) continue
            const priority = transitionPriority(t)
            if (priority > bestPriority) {
                best = t
                bestPriority = priority
            }
        }
        return best
    }

    private layers(): ActiveLayer[] {
        const alpha = this.blendAlpha
        if (this.previous === null || alpha >= 1 || this.blendDuration <= 0) {
            return [{ stateId: this.current, weight: 1 }]
        }
        return [
            { stateId: this.previous, weight: 1 - alpha },
            { stateId: this.current, weight: alpha },
        ]
    }
}

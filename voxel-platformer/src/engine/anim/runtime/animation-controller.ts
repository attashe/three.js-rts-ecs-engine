// Per-entity playback: maps the pure state machine's layer weights onto
// THREE.AnimationActions and ticks a single AnimationMixer.
//
// The state machine stays authoritative over blending — we drive each action's
// effective weight directly from `ActiveLayer.weight` rather than three's
// crossFade helpers, so there's one blend curve, defined in the graph.

import { AnimationMixer, LoopOnce, LoopRepeat, type AnimationAction, type Object3D } from 'three'
import {
    AnimStateMachine,
    stateClip,
    stateLoop,
    stateSpeed,
    stateSyncRefSpeed,
    type AnimGraphDef,
    type AnimParamBag,
    type AnimStateDef,
} from '../core'
import type { ClipSet } from './clip-source'

export class AnimationController {
    readonly root: Object3D
    readonly mixer: AnimationMixer
    readonly machine: AnimStateMachine
    readonly sockets: Map<string, Object3D>

    private readonly clipSet: ClipSet
    private readonly stateDefs = new Map<string, AnimStateDef>()
    private readonly stateIndex = new Map<string, number>()
    private readonly actions = new Map<string, AnimationAction>()
    private activeStates = new Set<string>()
    private locomotionSpeed = 0

    constructor(clipSet: ClipSet, graph: AnimGraphDef) {
        this.clipSet = clipSet
        this.root = clipSet.root
        this.sockets = clipSet.sockets
        this.mixer = new AnimationMixer(clipSet.root)
        this.machine = new AnimStateMachine(graph)
        graph.states.forEach((s, i) => {
            this.stateDefs.set(s.id, s)
            this.stateIndex.set(s.id, i)
        })
    }

    setParams(bag: AnimParamBag): void {
        this.machine.setParams(bag)
    }

    /** Current horizontal movement speed, used to time-scale `syncToSpeed`
     *  clips (walk/run) so the feet track the ground. */
    setLocomotionSpeed(speed: number): void {
        this.locomotionSpeed = speed
    }

    /** Index of the active state within its graph (for the debug mirror). */
    get currentStateIndex(): number {
        return this.stateIndex.get(this.machine.currentStateId) ?? 0
    }

    get previousStateIndex(): number {
        const prev = this.machine.previousStateId
        return prev ? this.stateIndex.get(prev) ?? 0 : 0
    }

    /** Tick the SM, apply layer weights, advance the mixer. */
    update(dt: number): void {
        const layers = this.machine.tick(dt)
        const next = new Set<string>()
        for (const layer of layers) {
            const action = this.actionFor(layer.stateId)
            if (!action) continue
            action.enabled = true
            if (!this.activeStates.has(layer.stateId)) action.play()
            action.setEffectiveWeight(layer.weight)
            this.applyTimeScale(layer.stateId, action)
            next.add(layer.stateId)
        }
        for (const id of this.activeStates) {
            if (!next.has(id)) this.actions.get(id)?.stop()
        }
        this.activeStates = next
        this.mixer.update(dt)
    }

    /** Advance only the mixer, without ticking the state machine. For previewing
     *  a single clip set up via `playStateImmediate` (no transitions fire). */
    advance(dt: number): void {
        this.mixer.update(dt)
    }

    /** Editor affordance: snap to a state and play it at full weight. */
    playStateImmediate(stateId: string): void {
        this.machine.reset(stateId)
        for (const a of this.actions.values()) a.stop()
        this.activeStates.clear()
        const action = this.actionFor(stateId)
        if (!action) return
        action.reset()
        action.enabled = true
        action.setEffectiveWeight(1)
        action.play()
        this.activeStates.add(stateId)
        this.mixer.update(0)
    }

    /** Editor affordance: park a single state at a normalised time. */
    scrub(stateId: string, t01: number): void {
        const action = this.actionFor(stateId)
        if (!action) return
        for (const a of this.actions.values()) { a.stop() }
        this.activeStates.clear()
        action.reset()
        action.enabled = true
        action.setEffectiveWeight(1)
        action.play()
        action.paused = true
        action.time = Math.max(0, Math.min(1, t01)) * action.getClip().duration
        this.activeStates.add(stateId)
        this.mixer.update(0)
    }

    dispose(): void {
        this.mixer.stopAllAction()
        this.mixer.uncacheRoot(this.root)
        this.actions.clear()
        this.activeStates.clear()
    }

    private applyTimeScale(stateId: string, action: AnimationAction): void {
        const def = this.stateDefs.get(stateId)
        if (!def) return
        if (!def.syncToSpeed) return
        const rate = clamp(this.locomotionSpeed / stateSyncRefSpeed(def), 0.45, 2.2)
        action.timeScale = stateSpeed(def) * rate
    }

    private actionFor(stateId: string): AnimationAction | undefined {
        const existing = this.actions.get(stateId)
        if (existing) return existing
        const def = this.stateDefs.get(stateId)
        if (!def) return undefined
        const clip = this.clipSet.clips.get(stateClip(def))
        if (!clip) return undefined
        const action = this.mixer.clipAction(clip)
        const loop = stateLoop(def)
        action.loop = loop === 'loop' ? LoopRepeat : LoopOnce
        action.clampWhenFinished = loop === 'clamp'
        action.timeScale = stateSpeed(def)
        this.actions.set(stateId, action)
        return action
    }
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v
}

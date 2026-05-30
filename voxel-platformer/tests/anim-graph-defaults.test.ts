import test from 'node:test'
import assert from 'node:assert/strict'
import {
    AnimStateMachine,
    REQUIRED_CLIP_IDS,
    computeLocomotionParams,
    stateClip,
    validateAnimGraph,
    type LocomotionSignals,
} from '../src/engine/anim/core'
import { locomotionGraph } from '../src/game/anim/graph-defaults'

test('the default locomotion graph is valid and self-consistent', () => {
    const g = locomotionGraph()
    assert.equal(validateAnimGraph(g).ok, true)

    // Every state's clip is one of the required Blender clip ids.
    const required = new Set<string>(REQUIRED_CLIP_IDS)
    for (const s of g.states) assert.ok(required.has(stateClip(s)), `${stateClip(s)} is a required clip`)

    // Every condition references a declared param.
    const declared = new Set((g.params ?? []).map((p) => p.name))
    for (const t of g.transitions) {
        for (const c of t.conditions ?? []) assert.ok(declared.has(c.param), `${c.param} declared`)
    }
})

function driver() {
    const sm = new AnimStateMachine(locomotionGraph())
    return {
        sm,
        step(sig: LocomotionSignals, times = 1, dt = 0.05) {
            for (let i = 0; i < times; i++) {
                sm.setParams(computeLocomotionParams(sig))
                sm.tick(dt)
            }
            return sm.currentStateId
        },
    }
}

const onGround = (speedXZ: number): LocomotionSignals => ({ speedXZ, vy: 0, grounded: true, blocked: false, movementState: speedXZ > 0.5 ? 1 : 0 })

test('ground locomotion walks, runs, and settles from movement speed', () => {
    const d = driver()
    assert.equal(d.sm.currentStateId, 'idle')
    assert.equal(d.step(onGround(2)), 'walk')
    assert.equal(d.step(onGround(4)), 'run')
    assert.equal(d.step(onGround(0), 2), 'idle') // run → walk → idle across two ticks
})

test('airborne and landing sequence: jump → fall → land → idle', () => {
    const d = driver()
    assert.equal(d.step({ speedXZ: 0, vy: 6, grounded: false, blocked: false, movementState: 2 }), 'jump')
    assert.equal(d.step({ speedXZ: 0, vy: -3, grounded: false, blocked: false, movementState: 2 }), 'fall')
    assert.equal(d.step({ speedXZ: 0, vy: -3, grounded: true, blocked: false, movementState: 0 }), 'land')
    // land holds until its min time elapses, then recovers to idle.
    assert.equal(d.sm.currentStateId, 'land')
    assert.equal(d.step(onGround(0), 6), 'idle')
})

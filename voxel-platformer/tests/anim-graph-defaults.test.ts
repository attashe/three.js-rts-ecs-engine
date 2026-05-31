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
import { combatLocomotionGraph, locomotionGraph } from '../src/game/anim/graph-defaults'

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

test('combat graph is valid, with a one-shot attack and a terminal dead state', () => {
    const g = combatLocomotionGraph()
    assert.equal(validateAnimGraph(g).ok, true)

    const stateIds = new Set(g.states.map((s) => s.id))
    assert.ok(stateIds.has('attack') && stateIds.has('attackWide') && stateIds.has('shoot') && stateIds.has('die') && stateIds.has('dead'))

    // `shoot` and `attackWide` are one-shot triggers that return to locomotion,
    // like the base thrust attack.
    const shootParam = (g.params ?? []).find((p) => p.name === 'shoot')
    assert.equal(shootParam?.trigger, true)
    const wideParam = (g.params ?? []).find((p) => p.name === 'attackWide')
    assert.equal(wideParam?.trigger, true)

    // `dead` is terminal — nothing transitions out of it.
    assert.equal(g.transitions.some((t) => t.from === 'dead'), false)

    // attack is a declared trigger param; dead latches (not a trigger).
    const attackParam = (g.params ?? []).find((p) => p.name === 'attack')
    const deadParam = (g.params ?? []).find((p) => p.name === 'dead')
    assert.equal(attackParam?.trigger, true)
    assert.notEqual(deadParam?.trigger, true)

    // priority ordering: dead > attack > airborne(jump/fall).
    const pri = (to: string) => Math.max(...g.transitions.filter((t) => t.to === to).map((t) => t.priority ?? 0))
    assert.ok(pri('dead') > pri('attack'))
    assert.ok(pri('attack') > pri('jump'))
})

test('combat graph: attack trigger plays once then returns, dead is absorbing', () => {
    const sm = new AnimStateMachine(combatLocomotionGraph())
    const idle = computeLocomotionParams({ speedXZ: 0, vy: 0, grounded: true, blocked: false, movementState: 0 })

    sm.setParams(idle)
    sm.setParam('attack', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'attack')
    // After the swing reads (minTime ~0.42s) it returns to idle.
    for (let i = 0; i < 12; i++) { sm.setParams(idle); sm.tick(0.05) }
    assert.equal(sm.currentStateId, 'idle')

    // Wide swing is a separate one-shot melee variant.
    sm.setParam('attackWide', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'attackWide')
    for (let i = 0; i < 14; i++) { sm.setParams(idle); sm.tick(0.05) }
    assert.equal(sm.currentStateId, 'idle')

    // Bow shot is a separate one-shot that also returns to idle.
    sm.setParam('shoot', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'shoot')
    for (let i = 0; i < 14; i++) { sm.setParams(idle); sm.tick(0.05) }
    assert.equal(sm.currentStateId, 'idle')

    // Death: first the `die` topple, then it settles into the absorbing `dead`.
    sm.setParam('dead', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'die')
    for (let i = 0; i < 16; i++) sm.tick(0.05) // past the topple (DIE_SECONDS)
    assert.equal(sm.currentStateId, 'dead')
    sm.setParams(computeLocomotionParams({ speedXZ: 4, vy: 0, grounded: true, blocked: false, movementState: 1 }))
    for (let i = 0; i < 5; i++) sm.tick(0.05)
    assert.equal(sm.currentStateId, 'dead', 'stays dead regardless of other params')
})

test('combat graph ignores attack and shoot triggers while airborne', () => {
    const sm = new AnimStateMachine(combatLocomotionGraph())
    const jump = computeLocomotionParams({ speedXZ: 0, vy: 6, grounded: false, blocked: false, movementState: 2 })
    const fall = computeLocomotionParams({ speedXZ: 0, vy: -4, grounded: false, blocked: false, movementState: 2 })

    sm.setParams(jump)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'jump')

    sm.setParams(jump)
    sm.setParam('attackWide', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'jump')

    sm.setParams(fall)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'fall')

    sm.setParams(fall)
    sm.setParam('shoot', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'fall')
})

test('combat graph does not start attack or shoot from death states', () => {
    const sm = new AnimStateMachine(combatLocomotionGraph())
    const idle = computeLocomotionParams({ speedXZ: 0, vy: 0, grounded: true, blocked: false, movementState: 0 })

    sm.setParams(idle)
    sm.setParam('dead', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'die')

    sm.setParams(idle)
    sm.setParam('attack', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'die')

    for (let i = 0; i < 16; i++) sm.tick(0.05)
    assert.equal(sm.currentStateId, 'dead')

    sm.setParams(idle)
    sm.setParam('shoot', 1)
    sm.tick(0.05)
    assert.equal(sm.currentStateId, 'dead')
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

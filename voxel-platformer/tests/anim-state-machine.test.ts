import test from 'node:test'
import assert from 'node:assert/strict'
import { AnimStateMachine, type AnimGraphDef } from '../src/engine/anim/core'

function graph(extra: Partial<AnimGraphDef> = {}): AnimGraphDef {
    return {
        schemaVersion: 1,
        id: 'test',
        initial: 'a',
        params: [{ name: 'x', default: 0 }],
        states: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        transitions: [{ from: 'a', to: 'b', conditions: [{ param: 'x', op: '>', value: 1 }] }],
        ...extra,
    }
}

test('transition fires when its condition is met', () => {
    const sm = new AnimStateMachine(graph())
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'a', 'stays put while condition is false')
    sm.setParam('x', 2)
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'b')
    assert.equal(sm.previousStateId, 'a')
})

test('any-state (*) transitions match regardless of current state', () => {
    const sm = new AnimStateMachine(graph({
        transitions: [
            { from: 'a', to: 'b', conditions: [] },
            { from: '*', to: 'c', conditions: [{ param: 'x', op: '==', value: 9 }], priority: 5 },
        ],
    }))
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'b')
    sm.setParam('x', 9)
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'c', 'any-state transition fires from b')
})

test('priority resolves competing transitions', () => {
    const sm = new AnimStateMachine(graph({
        transitions: [
            { from: 'a', to: 'b', conditions: [{ param: 'x', op: '>', value: 0 }], priority: 1 },
            { from: 'a', to: 'c', conditions: [{ param: 'x', op: '>', value: 0 }], priority: 5 },
        ],
    }))
    sm.setParam('x', 1)
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'c', 'higher priority wins')
})

test('minTimeInState debounces a transition', () => {
    const sm = new AnimStateMachine(graph({
        transitions: [{ from: 'a', to: 'b', minTimeInState: 0.5, conditions: [{ param: 'x', op: '>', value: 0 }] }],
    }))
    sm.setParam('x', 1)
    sm.tick(0.2)
    assert.equal(sm.currentStateId, 'a', 'too soon to fire')
    sm.tick(0.2)
    assert.equal(sm.currentStateId, 'a', 'still under the debounce')
    sm.tick(0.2)
    assert.equal(sm.currentStateId, 'b', 'fires once minTimeInState elapsed')
})

test('crossfade weights advance, clamp, and always sum to 1', () => {
    const sm = new AnimStateMachine(graph({
        transitions: [{ from: 'a', to: 'b', blendSeconds: 0.2, conditions: [{ param: 'x', op: '>', value: 0 }] }],
    }))
    sm.setParam('x', 1)
    const onFire = sm.tick(0.05) // transition fires this tick; blend resets to 0
    assert.equal(onFire.length, 2)
    assert.equal(sm.currentStateId, 'b')
    assert.ok(Math.abs(onFire.reduce((s, l) => s + l.weight, 0) - 1) < 1e-6)
    assert.ok(sm.blendAlpha < 0.01)

    const mid = sm.tick(0.1) // alpha ≈ 0.5
    assert.equal(mid.length, 2)
    assert.ok(Math.abs(mid.reduce((s, l) => s + l.weight, 0) - 1) < 1e-6)
    assert.ok(sm.blendAlpha > 0.4 && sm.blendAlpha < 0.6)

    const done = sm.tick(0.2) // past blend end
    assert.equal(done.length, 1)
    assert.equal(done[0]!.stateId, 'b')
    assert.equal(done[0]!.weight, 1)
    assert.equal(sm.blendAlpha, 1)
})

test('reset snaps to a state with no blend', () => {
    const sm = new AnimStateMachine(graph())
    sm.setParam('x', 2)
    sm.tick(0.1)
    sm.reset('a')
    assert.equal(sm.currentStateId, 'a')
    assert.equal(sm.previousStateId, null)
    assert.equal(sm.blendAlpha, 1)
    sm.setParam('x', 0) // clear the trigger so the next tick stays put
    assert.deepEqual(sm.tick(0).map((l) => l.stateId), ['a'])
})

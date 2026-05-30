import test from 'node:test'
import assert from 'node:assert/strict'
import { AnimStateMachine, type AnimGraphDef } from '../src/engine/anim/core'

// idle ↔ attack, where `attack` is a one-shot trigger param. attack returns to
// idle immediately (minTimeInState 0, unconditional), so if the trigger did NOT
// reset, the machine would ping-pong idle→attack forever.
function triggerGraph(): AnimGraphDef {
    return {
        schemaVersion: 1,
        id: 'trig',
        initial: 'idle',
        params: [{ name: 'attack', default: 0, trigger: true }],
        states: [{ id: 'idle' }, { id: 'attack' }],
        transitions: [
            { from: 'idle', to: 'attack', conditions: [{ param: 'attack', op: '==', value: 1 }] },
            { from: 'attack', to: 'idle' },
        ],
    }
}

test('a trigger param fires exactly once then auto-resets', () => {
    const sm = new AnimStateMachine(triggerGraph())
    sm.setParam('attack', 1)
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'attack', 'trigger fired')
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'idle', 'returns to idle')
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'idle', 'does NOT re-fire — trigger was consumed')

    // Setting it again fires again.
    sm.setParam('attack', 1)
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'attack')
})

test('reset clears a pending trigger', () => {
    const sm = new AnimStateMachine(triggerGraph())
    sm.setParam('attack', 1)
    sm.reset('idle')
    sm.tick(0.1)
    assert.equal(sm.currentStateId, 'idle', 'trigger cleared by reset, no fire')
})

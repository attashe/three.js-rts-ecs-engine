import test from 'node:test'
import assert from 'node:assert/strict'
import {
    deserializeAnimGraph,
    migrateAnimGraph,
    serializeAnimGraph,
    validateAnimGraph,
    type AnimGraphDef,
} from '../src/engine/anim/core'

const valid: AnimGraphDef = {
    schemaVersion: 1,
    id: 'g',
    initial: 'idle',
    params: [{ name: 'speed', default: 0 }],
    states: [{ id: 'idle' }, { id: 'walk' }],
    transitions: [{ from: 'idle', to: 'walk', conditions: [{ param: 'speed', op: '>', value: 1 }] }],
}

test('serialize → deserialize round-trips a valid graph', () => {
    const back = deserializeAnimGraph(serializeAnimGraph(valid))
    assert.deepEqual(back, valid)
})

test('migration stamps a missing schemaVersion', () => {
    const { schemaVersion: _drop, ...legacy } = valid
    const migrated = migrateAnimGraph(legacy) as AnimGraphDef
    assert.equal(migrated.schemaVersion, 1)
    // deserialize accepts the legacy (un-versioned) form via migration
    assert.equal(deserializeAnimGraph(JSON.stringify(legacy)).schemaVersion, 1)
})

test('validateAnimGraph rejects malformed graphs', () => {
    assert.equal(validateAnimGraph(null).ok, false)
    assert.equal(validateAnimGraph({ schemaVersion: 1, id: 'x', initial: 'nope', states: [{ id: 'a' }], transitions: [] }).ok, false)
    // transition targets an undeclared state
    assert.equal(validateAnimGraph({ ...valid, transitions: [{ from: 'idle', to: 'ghost' }] }).ok, false)
    // condition references an undeclared param
    assert.equal(validateAnimGraph({ ...valid, transitions: [{ from: 'idle', to: 'walk', conditions: [{ param: 'ghost', op: '>', value: 1 }] }] }).ok, false)
    // duplicate state id
    assert.equal(validateAnimGraph({ ...valid, states: [{ id: 'idle' }, { id: 'idle' }] }).ok, false)
})

test('deserialize throws on an invalid graph', () => {
    assert.throws(() => deserializeAnimGraph('{"schemaVersion":1,"id":"","initial":"x","states":[],"transitions":[]}'))
})

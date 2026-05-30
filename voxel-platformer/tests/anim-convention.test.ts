import test from 'node:test'
import assert from 'node:assert/strict'
import {
    REQUIRED_CLIP_IDS,
    SOCKET_NAMES,
    SLOT_TO_SOCKET,
    validateClipNames,
    validateSocketNames,
} from '../src/engine/anim/core'

test('validateClipNames flags missing required clips and reports extras', () => {
    const full = validateClipNames([...REQUIRED_CLIP_IDS, 'wave'])
    assert.equal(full.ok, true)
    assert.deepEqual(full.missing, [])
    assert.deepEqual(full.extra, ['wave'])

    const partial = validateClipNames(['idle', 'walk'])
    assert.equal(partial.ok, false)
    assert.deepEqual(partial.missing.sort(), ['fall', 'jump', 'land', 'run'])
})

test('validateSocketNames reports canonical coverage; sockets are optional', () => {
    const all = validateSocketNames([...SOCKET_NAMES])
    assert.equal(all.ok, true)
    const partial = validateSocketNames(['socket_head'])
    assert.equal(partial.ok, false)
    assert.ok(partial.missing.includes('socket_hand_R'))
    const unknown = validateSocketNames(['socket_tail'])
    assert.deepEqual(unknown.extra, ['socket_tail'])
})

test('every equip slot maps to a canonical socket name', () => {
    for (const socket of Object.values(SLOT_TO_SOCKET)) {
        assert.ok(SOCKET_NAMES.includes(socket), `${socket} is canonical`)
    }
})

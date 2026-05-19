import test from 'node:test'
import assert from 'node:assert/strict'
import { addOffset, pistonOffset } from '../src/editor/piston-direction'

test('pistonOffset: each direction translates along its own axis', () => {
    assert.deepEqual(pistonOffset('north', 1), { x: 0, y: 0, z: -1 })
    assert.deepEqual(pistonOffset('south', 1), { x: 0, y: 0, z: 1 })
    assert.deepEqual(pistonOffset('east', 1), { x: 1, y: 0, z: 0 })
    assert.deepEqual(pistonOffset('west', 1), { x: -1, y: 0, z: 0 })
    assert.deepEqual(pistonOffset('up', 1), { x: 0, y: 1, z: 0 })
    assert.deepEqual(pistonOffset('down', 1), { x: 0, y: -1, z: 0 })
})

test('pistonOffset: distance scales the axis step', () => {
    assert.deepEqual(pistonOffset('up', 4), { x: 0, y: 4, z: 0 })
    assert.deepEqual(pistonOffset('west', 3), { x: -3, y: 0, z: 0 })
})

test('pistonOffset: distance is clamped to >= 1 and floored', () => {
    assert.deepEqual(pistonOffset('up', 0), { x: 0, y: 1, z: 0 })
    assert.deepEqual(pistonOffset('up', -5), { x: 0, y: 1, z: 0 })
    assert.deepEqual(pistonOffset('east', 2.7), { x: 2, y: 0, z: 0 })
})

test('addOffset: componentwise add', () => {
    assert.deepEqual(addOffset({ x: 5, y: 4, z: 3 }, { x: 0, y: 2, z: 0 }), { x: 5, y: 6, z: 3 })
    assert.deepEqual(addOffset({ x: -1, y: 0, z: 7 }, { x: 4, y: 0, z: -2 }), { x: 3, y: 0, z: 5 })
})

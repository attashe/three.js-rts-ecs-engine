import test from 'node:test'
import assert from 'node:assert/strict'
import { CHUNK_DIM, chunkKey } from '../src/engine/voxel/chunk'
import {
    chunkChebyshev,
    chunkCoordsInRadius,
    chunkDistanceSq,
    coordKey,
    diffActiveSet,
    focusChunk,
    isWithinRadius,
    sameChunk,
    worldToChunk,
} from '../src/engine/voxel/chunk-streaming'

test('worldToChunk floors negative-safe at the chunk size', () => {
    assert.equal(worldToChunk(0), 0)
    assert.equal(worldToChunk(CHUNK_DIM - 1), 0)
    assert.equal(worldToChunk(CHUNK_DIM), 1)
    assert.equal(worldToChunk(-1), -1)
    assert.equal(worldToChunk(-CHUNK_DIM), -1)
    assert.equal(worldToChunk(-CHUNK_DIM - 1), -2)
})

test('focusChunk maps a world point to its chunk coord', () => {
    const c = focusChunk({ x: CHUNK_DIM * 2 + 5, y: 3, z: -1 })
    assert.deepEqual(c, { cx: 2, cy: 0, cz: -1 })
    assert.ok(sameChunk(c, { cx: 2, cy: 0, cz: -1 }))
})

test('chebyshev + radius membership', () => {
    const center = { cx: 0, cy: 0, cz: 0 }
    assert.equal(chunkChebyshev(center, { cx: 2, cy: -1, cz: 1 }), 2)
    assert.equal(isWithinRadius(center, { cx: 2, cy: 0, cz: 0 }, 2), true)
    assert.equal(isWithinRadius(center, { cx: 3, cy: 0, cz: 0 }, 2), false)
})

test('chunkDistanceSq orders nearer chunks first', () => {
    const center = { cx: 0, cy: 0, cz: 0 }
    const near = chunkDistanceSq(center, { cx: 1, cy: 0, cz: 0 })
    const far = chunkDistanceSq(center, { cx: 2, cy: 1, cz: 0 })
    assert.equal(near, 1)
    assert.equal(far, 5)
    assert.ok(near < far)
})

test('chunkCoordsInRadius yields a full (2r+1)^3 cube including the center', () => {
    const center = { cx: 5, cy: 1, cz: -3 }
    const coords = [...chunkCoordsInRadius(center, 2)]
    assert.equal(coords.length, 5 * 5 * 5)
    assert.ok(coords.some((c) => sameChunk(c, center)))
    for (const c of coords) assert.ok(chunkChebyshev(center, c) <= 2)
})

test('diffActiveSet reports keys to mesh (enter) and dispose (leave)', () => {
    const current = new Set([chunkKey(0, 0, 0), chunkKey(1, 0, 0)])
    const desired = new Set([chunkKey(1, 0, 0), chunkKey(2, 0, 0)])
    const { enter, leave } = diffActiveSet(current, desired)
    assert.deepEqual(enter.sort(), [chunkKey(2, 0, 0)])
    assert.deepEqual(leave.sort(), [chunkKey(0, 0, 0)])
})

test('coordKey matches chunkKey', () => {
    assert.equal(coordKey({ cx: 3, cy: -2, cz: 7 }), chunkKey(3, -2, 7))
})

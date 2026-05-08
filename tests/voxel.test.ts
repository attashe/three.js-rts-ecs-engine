import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager, worldToVoxel } from '../src/client/engine/voxel/chunk-manager'
import { CHUNK_DIM, chunkKey } from '../src/client/engine/voxel/chunk'
import { deserializeLevel, serializeLevel } from '../src/client/engine/voxel/level-serializer'
import { voxelAABBOverlap, sweepAxis } from '../src/client/engine/voxel/voxel-collide'
import { findPath } from '../src/client/engine/voxel/voxel-path'
import { AIR, BLOCK, DEFAULT_PALETTE } from '../src/client/engine/voxel/palette'
import { areEnemies, FactionId, relationBetween, Relation } from '../src/client/engine/ecs/factions'

test('worldToVoxel floors positive and negative coordinates', () => {
    assert.deepEqual(worldToVoxel(1.9, 0, -0.1), { x: 1, y: 0, z: -1 })
    assert.deepEqual(worldToVoxel(-1.1, -2.9, 32), { x: -2, y: -3, z: 32 })
})

test('ChunkManager maps negative world coordinates to stable chunk/local storage', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    chunks.setVoxel(-1, 0, -33, BLOCK.stone)

    assert.equal(chunks.getVoxel(-1, 0, -33), BLOCK.stone)
    assert.equal(chunks.getChunk(-1, 0, -2)?.getLocal(CHUNK_DIM - 1, 0, CHUNK_DIM - 1), BLOCK.stone)
})

test('bulk edits summarize changed voxels and dirty chunk keys', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.getOrCreate(1, 0, 0)
    chunks.drainDirty()

    const result = chunks.applyBulk([
        { x: CHUNK_DIM - 1, y: 0, z: 0, value: BLOCK.stone },
        { x: CHUNK_DIM - 1, y: 0, z: 0, value: BLOCK.stone },
    ])

    assert.equal(result.changedVoxels, 1)
    const dirty = chunks.drainDirty().map((chunk) => chunkKey(chunk.cx, chunk.cy, chunk.cz)).sort()
    assert.deepEqual(dirty, ['0,0,0', '1,0,0'])
})

test('voxelAABBOverlap treats max boundary as exclusive', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)

    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 1,
        maxY: 1,
        maxZ: 1,
    }), false)

    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0.99,
        minY: 0,
        minZ: 0,
        maxX: 1.2,
        maxY: 1,
        maxZ: 1,
    }), true)
})

test('sweepAxis clamps movement before a blocking voxel', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)
    const pos = { x: 0, y: 0, z: 0.5 }
    const half = { x: 0.25, y: 0.5, z: 0.25 }

    const sweep = sweepAxis(chunks, pos, half, 'x', 2)

    assert.equal(sweep.blocked, true)
    assert.ok(pos.x < 0.751)
    assert.ok(pos.x > 0.74)
})

test('findPath respects layered standing heights', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    for (let x = 0; x < 3; x++) {
        chunks.setVoxel(x, 0, 0, BLOCK.stone)
        chunks.setVoxel(x, 4, 0, BLOCK.stone)
    }

    const lower = findPath(
        chunks,
        { x: 0, y: 1, z: 0 },
        { x: 2, y: 1, z: 0 },
        { maxStepUp: 1, maxDrop: 1 },
    )
    assert.deepEqual(lower?.map((p) => p.y), [1, 1, 1])

    const upper = findPath(
        chunks,
        { x: 0, y: 5, z: 0 },
        { x: 2, y: 5, z: 0 },
        { maxStepUp: 1, maxDrop: 1 },
    )
    assert.deepEqual(upper?.map((p) => p.y), [5, 5, 5])
})

test('findPath treats no-walk blockers as impassable', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x < 3; x++) chunks.setVoxel(x, 0, 0, BLOCK.stone)
    chunks.setVoxel(1, 1, 0, BLOCK.noWalk)

    const path = findPath(
        chunks,
        { x: 0, y: 1, z: 0 },
        { x: 2, y: 1, z: 0 },
        { maxStepUp: 1, maxDrop: 1 },
    )

    assert.equal(path, null)
})

test('door voxels block paths while closed and reopen the path when cleared', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x < 3; x++) chunks.setVoxel(x, 0, 0, BLOCK.stone)
    chunks.setVoxel(1, 1, 0, BLOCK.door)
    chunks.setVoxel(1, 2, 0, BLOCK.door)

    const closed = findPath(
        chunks,
        { x: 0, y: 1, z: 0 },
        { x: 2, y: 1, z: 0 },
        { maxStepUp: 1, maxDrop: 1 },
    )
    assert.equal(closed, null)

    chunks.setVoxel(1, 1, 0, AIR)
    chunks.setVoxel(1, 2, 0, AIR)
    const open = findPath(
        chunks,
        { x: 0, y: 1, z: 0 },
        { x: 2, y: 1, z: 0 },
        { maxStepUp: 1, maxDrop: 1 },
    )
    assert.deepEqual(open?.map((p) => p.x), [0, 1, 2])
})

test('findPath can route around dynamic blocked cells', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x < 3; x++) {
        for (let z = -1; z <= 1; z++) chunks.setVoxel(x, 0, z, BLOCK.stone)
    }

    const path = findPath(
        chunks,
        { x: 0, y: 1, z: 0 },
        { x: 2, y: 1, z: 0 },
        {
            maxStepUp: 1,
            maxDrop: 1,
            isBlocked: (x, y, z) => x === 1 && y === 1 && z === 0,
        },
    )

    assert.ok(path)
    assert.equal(path.some((p) => p.x === 1 && p.y === 1 && p.z === 0), false)
    assert.equal(path.at(-1)?.x, 2)
    assert.equal(path.at(-1)?.z, 0)
})

test('faction relationship matrix classifies friends, neutrals, and enemies', () => {
    assert.equal(relationBetween(FactionId.Player, FactionId.Player), Relation.Friend)
    assert.equal(relationBetween(FactionId.Player, FactionId.Neutral), Relation.Neutral)
    assert.equal(relationBetween(FactionId.Player, FactionId.Hostile), Relation.Enemy)
    assert.equal(areEnemies(FactionId.Hostile, FactionId.Neutral), true)
})

test('level serialization round-trips palette, metadata, and chunks', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(2, 3, 4, BLOCK.grass)
    chunks.setVoxel(-1, 0, 0, BLOCK.brick)

    const metadata = { spawn: { x: 2.5, y: 4, z: 4.5 }, name: 'test-level' }
    const buffer = serializeLevel(chunks, metadata)
    const loaded = deserializeLevel<typeof metadata>(buffer)

    assert.deepEqual(loaded.metadata, metadata)
    assert.equal(loaded.chunks.palette.entries[BLOCK.brick]?.name, 'brick')
    assert.equal(loaded.chunks.getVoxel(2, 3, 4), BLOCK.grass)
    assert.equal(loaded.chunks.getVoxel(-1, 0, 0), BLOCK.brick)
    assert.equal(loaded.chunks.chunkCount(), chunks.chunkCount())
})

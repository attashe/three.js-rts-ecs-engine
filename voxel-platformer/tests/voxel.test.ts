import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager, worldToVoxel } from '../src/engine/voxel/chunk-manager'
import { CHUNK_DIM, chunkKey } from '../src/engine/voxel/chunk'
import { deserializeLevel, serializeLevel } from '../src/engine/voxel/level-serializer'
import { voxelAABBOverlap, sweepAxis } from '../src/engine/voxel/voxel-collide'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'

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

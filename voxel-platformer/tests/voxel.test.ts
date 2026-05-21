import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager, worldToVoxel } from '../src/engine/voxel/chunk-manager'
import { CHUNK_DIM, chunkKey } from '../src/engine/voxel/chunk'
import { deserializeLevel, serializeLevel } from '../src/engine/voxel/level-serializer'
import { voxelAABBOverlap, sweepAxis } from '../src/engine/voxel/voxel-collide'
import { greedyMesh } from '../src/engine/voxel/greedy-mesher'
import { movementEnvironmentForAABB } from '../src/engine/voxel/movement-effects'
import { BLOCK, DEFAULT_PALETTE, isCollidable, voxelOpacity } from '../src/engine/voxel/palette'
import { voxelRaycast } from '../src/engine/voxel/voxel-raycast'
import { Vector3 } from 'three'

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

test('water and cloud are non-physical visible blocks', () => {
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.water), false)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.cloud), false)
    assert.ok(voxelOpacity(DEFAULT_PALETTE, BLOCK.water) < 1)
    assert.ok(voxelOpacity(DEFAULT_PALETTE, BLOCK.cloud) < 1)

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.water)
    chunks.setVoxel(1, 0, 0, BLOCK.cloud)

    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0,
        minY: 0,
        minZ: 0,
        maxX: 2,
        maxY: 1,
        maxZ: 1,
    }), false, 'non-physical blocks do not collide')
})

test('movementEnvironmentForAABB applies water movement effects only', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.water)
    chunks.setVoxel(2, 0, 0, BLOCK.cloud)

    const water = movementEnvironmentForAABB(chunks, {
        minX: 0.1,
        minY: 0,
        minZ: 0.1,
        maxX: 0.9,
        maxY: 1,
        maxZ: 0.9,
    })
    assert.equal(water.jumpDisabled, true)
    assert.ok(water.speedMultiplier < 1, `expected water to slow movement, got ${water.speedMultiplier}`)

    const cloud = movementEnvironmentForAABB(chunks, {
        minX: 2.1,
        minY: 0,
        minZ: 0.1,
        maxX: 2.9,
        maxY: 1,
        maxZ: 0.9,
    })
    assert.deepEqual(cloud, { speedMultiplier: 1, jumpDisabled: false })
})

test('voxelRaycast: arrows (collidable predicate) pass through water and hit stone behind', () => {
    // Regression: water has `raycastTarget: true` so the editor cursor can
    // target water cells, but arrows must pass through. The arrow-hit-system
    // calls voxelRaycast with the `isCollidable` predicate to get that
    // behaviour — verify it skips water and lands on the next collidable
    // cell along the ray.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(2, 0, 0, BLOCK.water)
    chunks.setVoxel(5, 0, 0, BLOCK.stone)

    const origin = new Vector3(0.5, 0.5, 0.5)
    const dir = new Vector3(1, 0, 0)

    // Default predicate hits the water (so the editor cursor can target it).
    const editorHit = voxelRaycast(chunks, origin, dir, 10)
    assert.equal(editorHit?.voxel.x, 2, 'editor cursor targets water')

    // isCollidable predicate skips water, hits the stone behind.
    const arrowHit = voxelRaycast(chunks, origin, dir, 10, isCollidable)
    assert.equal(arrowHit?.voxel.x, 5, 'arrow passes through water and lands on stone')
})

test('greedyMesh emits alpha for transparent non-occluding voxels', () => {
    const mesh = greedyMesh((x, y, z) => (
        x === 0 && y === 0 && z === 0 ? BLOCK.water : BLOCK.air
    ), 1, DEFAULT_PALETTE)

    assert.ok(mesh.vertexCount > 0, 'water should render despite being non-occluding')
    assert.equal(mesh.colors.length, mesh.vertexCount * 4, 'mesh colors include alpha')
    assert.ok(mesh.colors.some((_, i) => i % 4 === 3 && mesh.colors[i]! < 1), 'at least one vertex is translucent')
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

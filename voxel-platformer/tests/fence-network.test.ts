import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import {
    BLOCK,
    DEFAULT_PALETTE,
    fenceBlockIndex,
    isCollidable,
    isFenceBlock,
    isRaycastTarget,
    isRenderableVoxel,
    voxelOpacity,
} from '../src/engine/voxel/palette'
import {
    FENCE_MASK,
    fenceConnectionMask,
} from '../src/game/fence/fence-network'

test('default fence is a collidable adaptive special block', () => {
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.fence]?.name, 'fence')
    assert.equal(isFenceBlock(DEFAULT_PALETTE, BLOCK.fence), true)
    assert.equal(fenceBlockIndex(DEFAULT_PALETTE), BLOCK.fence)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.fence), true)
    assert.equal(isRaycastTarget(DEFAULT_PALETTE, BLOCK.fence), true)
    assert.equal(isRenderableVoxel(DEFAULT_PALETTE, BLOCK.fence), false)
    assert.equal(voxelOpacity(DEFAULT_PALETTE, BLOCK.fence), 0)
})

test('fence graph connects to same-height neighboring fence cells', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 1, 0, BLOCK.fence)

    assert.equal(fenceConnectionMask(chunks, 0, 1, 0), 0)

    chunks.setVoxel(1, 1, 0, BLOCK.fence)
    chunks.setVoxel(-1, 1, 0, BLOCK.fence)
    assert.equal(fenceConnectionMask(chunks, 0, 1, 0), FENCE_MASK.east | FENCE_MASK.west)

    chunks.setVoxel(0, 1, -1, BLOCK.fence)
    chunks.setVoxel(0, 1, 1, BLOCK.fence)
    assert.equal(fenceConnectionMask(chunks, 0, 1, 0), FENCE_MASK.north | FENCE_MASK.east | FENCE_MASK.south | FENCE_MASK.west)
})


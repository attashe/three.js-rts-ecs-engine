import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import {
    AIR,
    BLOCK,
    DEFAULT_PALETTE,
    clonePalette,
    isCollidable,
    isRaycastTarget,
    isRenderableVoxel,
    isTorchBlock,
    voxelOpacity,
} from '../src/engine/voxel/palette'
import { voxelAABBOverlap } from '../src/engine/voxel/voxel-collide'
import { resolveTorchMount, selectTorchLightKeys, selectTorchSoundKeys } from '../src/game/torch-block-system'

test('default torch is a raycastable non-physical prop block', () => {
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.torch]?.name, 'torch')
    assert.equal(isTorchBlock(DEFAULT_PALETTE, BLOCK.torch), true)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.torch), false)
    assert.equal(isRaycastTarget(DEFAULT_PALETTE, BLOCK.torch), true)
    assert.equal(isRenderableVoxel(DEFAULT_PALETTE, BLOCK.torch), false)
    assert.equal(voxelOpacity(DEFAULT_PALETTE, BLOCK.torch), 0)

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.torch)
    assert.equal(voxelAABBOverlap(chunks, {
        minX: 0.1,
        minY: 0,
        minZ: 0.1,
        maxX: 0.9,
        maxY: 0.9,
        maxZ: 0.9,
    }), false)
})

test('older palettes keep custom material index when torch is appended', () => {
    const oldPalette = clonePalette(DEFAULT_PALETTE)
    oldPalette.entries.length = BLOCK.torch
    oldPalette.entries.push({
        name: 'custom index fourteen',
        color: [0.3, 0.2, 0.7],
        solid: true,
    })

    const chunks = new ChunkManager(oldPalette)
    const torchIndex = chunks.palette.entries.findIndex((entry) => entry.renderAs === 'torch')

    assert.equal(chunks.palette.entries[BLOCK.torch]?.name, 'custom index fourteen')
    assert.equal(isTorchBlock(chunks.palette, BLOCK.torch), false)
    assert.ok(torchIndex > BLOCK.torch)
    assert.equal(chunks.palette.entries[torchIndex]?.name, 'torch')
})

test('torch block alignment prefers walls, then floor support, then floating', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.torch)

    assert.deepEqual(resolveTorchMount(chunks, 0, 0, 0), {
        kind: 'floating',
        normalX: 0,
        normalZ: 0,
    })

    chunks.setVoxel(0, -1, 0, BLOCK.stone)
    assert.deepEqual(resolveTorchMount(chunks, 0, 0, 0), {
        kind: 'standing',
        normalX: 0,
        normalZ: 0,
    })

    chunks.setVoxel(-1, 0, 0, BLOCK.stone)
    assert.deepEqual(resolveTorchMount(chunks, 0, 0, 0), {
        kind: 'wall',
        normalX: 1,
        normalZ: 0,
    })

    chunks.setVoxel(-1, 0, 0, AIR)
    chunks.setVoxel(1, 0, 0, BLOCK.water)
    assert.deepEqual(resolveTorchMount(chunks, 0, 0, 0), {
        kind: 'standing',
        normalX: 0,
        normalZ: 0,
    })
})

test('torch sound selection keeps the nearest subtle emitters inside radius', () => {
    const selected = selectTorchSoundKeys([
        { key: 'near-a', x: 1, y: 0, z: 0 },
        { key: 'near-b', x: 2, y: 0, z: 0 },
        { key: 'far', x: 8, y: 0, z: 0 },
        { key: 'near-c', x: 3, y: 0, z: 0 },
    ], { x: 0, y: 0, z: 0 }, 5, 2)

    assert.deepEqual([...selected].sort(), ['near-a', 'near-b'])
})

test('torch light selection caps active point lights by camera distance', () => {
    const selected = selectTorchLightKeys([
        { key: 'a', x: 1, y: 0, z: 0 },
        { key: 'b', x: 4, y: 0, z: 0 },
        { key: 'c', x: 2, y: 0, z: 0 },
        { key: 'd', x: 3, y: 0, z: 0 },
    ], { x: 0, y: 0, z: 0 }, 2)

    assert.deepEqual([...selected].sort(), ['a', 'c'])
})

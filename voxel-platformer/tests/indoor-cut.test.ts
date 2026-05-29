import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { isViewpointBlocked } from '../src/game/indoor-cut-system'

function chunks(): ChunkManager {
    return new ChunkManager(DEFAULT_PALETTE)
}

// Camera sits up and to the +x/+z side, like the isometric view.
const VIEWPOINT = { x: 40, y: 60, z: 40 }

test('open line of sight to the character is not blocked', () => {
    const c = chunks()
    assert.equal(isViewpointBlocked(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28), false)
})

test('a roof/wall between the character and the camera blocks the view', () => {
    const c = chunks()
    // A slab of stone a few cells along the line toward the camera.
    for (let x = 2; x <= 5; x++) {
        for (let z = 2; z <= 5; z++) {
            c.setVoxel(x, 9, z, BLOCK.stone)
        }
    }
    assert.equal(isViewpointBlocked(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28), true)
})

test('detects occlusion even when the column directly above the head is open', () => {
    const c = chunks()
    // Tower-like: open shaft straight up (no blocks at x=0,z=0 above the head),
    // but a wall on the camera-facing side blocks the diagonal line of sight.
    for (let y = 6; y <= 16; y++) {
        for (let x = 3; x <= 4; x++) {
            for (let z = 3; z <= 4; z++) c.setVoxel(x, y, z, BLOCK.stone)
        }
    }
    // Column above the head is clear...
    assert.equal(c.getVoxel(0, 12, 0), BLOCK.air)
    // ...yet the character is occluded from the camera.
    assert.equal(isViewpointBlocked(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28), true)
})

test('foliage does not block the view — standing under a canopy stays open', () => {
    const c = chunks()
    for (const leaf of [BLOCK.leaf, BLOCK.leafDark, BLOCK.leafLight, BLOCK.deepLeaf]) {
        const cc = chunks()
        for (let x = 2; x <= 5; x++) {
            for (let z = 2; z <= 5; z++) cc.setVoxel(x, 9, z, leaf)
        }
        assert.equal(isViewpointBlocked(cc, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28), false, `leaf ${leaf}`)
    }
})

test('occluders beyond maxDistance do not count', () => {
    const c = chunks()
    // A wall far away along the sight line — outside the 4-block reach.
    for (let x = 20; x <= 24; x++) {
        for (let z = 20; z <= 24; z++) c.setVoxel(x, 30, z, BLOCK.stone)
    }
    assert.equal(isViewpointBlocked(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 4), false)
})

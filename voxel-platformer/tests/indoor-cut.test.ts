import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { castViewObstruction } from '../src/game/indoor-cut-system'

function chunks(): ChunkManager {
    return new ChunkManager(DEFAULT_PALETTE)
}

// Camera sits up and to the +x/+z side, like the isometric view.
const VIEWPOINT = { x: 40, y: 60, z: 40 }

test('open line of sight to the character is not obstructed', () => {
    const c = chunks()
    assert.equal(castViewObstruction(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28), null)
})

test('a roof/wall between the character and the camera obstructs the view', () => {
    const c = chunks()
    for (let x = 2; x <= 5; x++) {
        for (let z = 2; z <= 5; z++) c.setVoxel(x, 9, z, BLOCK.stone)
    }
    const hit = castViewObstruction(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28)
    assert.ok(hit, 'expected an obstruction')
    assert.ok(hit!.t > 0, 'obstruction has a positive distance used to size the cut corridor')
})

test('detects obstruction even when the column directly above the head is open', () => {
    const c = chunks()
    // Tower-like: open shaft straight up, but a wall on the camera-facing side
    // blocks the diagonal line of sight.
    for (let y = 6; y <= 16; y++) {
        for (let x = 3; x <= 4; x++) {
            for (let z = 3; z <= 4; z++) c.setVoxel(x, y, z, BLOCK.stone)
        }
    }
    assert.equal(c.getVoxel(0, 12, 0), BLOCK.air)
    assert.ok(castViewObstruction(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28))
})

test('a far wall in a large room is still detected, and its distance drives a longer corridor', () => {
    // The iso sight line from (0,6,0) toward (40,60,40) advances equally in x
    // and z (x≈z) while climbing in y, so put each wall as a pillar on that
    // diagonal at the height the ray passes through.
    const near = chunks()
    for (let y = 7; y <= 14; y++) near.setVoxel(3, y, 3, BLOCK.stone)
    const far = chunks()
    for (let y = 20; y <= 27; y++) far.setVoxel(14, y, 14, BLOCK.stone)

    const nearHit = castViewObstruction(near, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28)
    const farHit = castViewObstruction(far, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28)
    assert.ok(nearHit && farHit)
    // The far wall is detected and reports a greater distance, so the system
    // sizes a longer cut corridor to reach it (the large-room fix).
    assert.ok(farHit!.t > nearHit!.t)
})

test('foliage does not obstruct the view — standing under a canopy stays open', () => {
    for (const leaf of [BLOCK.leaf, BLOCK.leafDark, BLOCK.leafLight, BLOCK.deepLeaf]) {
        const c = chunks()
        for (let x = 2; x <= 5; x++) for (let z = 2; z <= 5; z++) c.setVoxel(x, 9, z, leaf)
        assert.equal(castViewObstruction(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 28), null, `leaf ${leaf}`)
    }
})

test('occluders beyond maxDistance do not count', () => {
    const c = chunks()
    for (let x = 20; x <= 24; x++) for (let z = 20; z <= 24; z++) c.setVoxel(x, 30, z, BLOCK.stone)
    assert.equal(castViewObstruction(c, { x: 0, y: 6, z: 0 }, VIEWPOINT, 4), null)
})

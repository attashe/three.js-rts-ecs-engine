import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE, BLOCK, AIR } from '../src/engine/voxel/palette'
import { createGameWorld } from '../src/engine/ecs/world'
import { nearestDoorInteractionTarget, scanDoors } from '../src/game/doors'

function worldWithDoor(): ChunkManager {
    const m = new ChunkManager(DEFAULT_PALETTE)
    // A 2-wide x 3-tall upright doorway at x=5..6, y=1..3, z=8.
    for (let x = 5; x <= 6; x++) {
        for (let y = 1; y <= 3; y++) m.setVoxel(x, y, 8, BLOCK.door)
    }
    return m
}

const farPlayer = { eid: 1, x: 50, y: 2, z: 50 }
const nearPlayer = { eid: 1, x: 5.5, y: 2, z: 6.5 }

test('scanDoors registers an upright door-block cluster', () => {
    const chunks = worldWithDoor()
    const world = createGameWorld()
    scanDoors(world, chunks)
    assert.equal(world.doors.length, 1)
    assert.equal(world.doors[0]!.cells.length, 6)
    assert.equal(world.doors[0]!.open, false)
})

test('scanDoors ignores a flat single-layer door slab (floor pad)', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 5; x <= 6; x++) {
        for (let z = 17; z <= 18; z++) chunks.setVoxel(x, 1, z, BLOCK.door)
    }
    const world = createGameWorld()
    scanDoors(world, chunks)
    assert.equal(world.doors.length, 0)
})

test('door interaction opens (clears voxels) and closes (refills) the doorway', () => {
    const chunks = worldWithDoor()
    const world = createGameWorld()
    scanDoors(world, chunks)

    assert.equal(nearestDoorInteractionTarget(world, farPlayer, chunks), null, 'no door out of range')

    const open = nearestDoorInteractionTarget(world, nearPlayer, chunks)
    assert.ok(open, 'door reachable')
    assert.equal(open!.prompt, 'Open door')

    open!.interact(world, nearPlayer)
    assert.equal(world.doors[0]!.open, true)
    assert.equal(chunks.getVoxel(5, 2, 8), AIR, 'door voxels cleared when open')
    assert.equal(chunks.getVoxel(6, 3, 8), AIR)

    const close = nearestDoorInteractionTarget(world, nearPlayer, chunks)
    assert.ok(close)
    assert.equal(close!.prompt, 'Close door')
    close!.interact(world, nearPlayer)
    assert.equal(world.doors[0]!.open, false)
    assert.equal(chunks.getVoxel(5, 2, 8), BLOCK.door, 'door voxels restored when closed')
    assert.equal(chunks.getVoxel(6, 1, 8), BLOCK.door)
})

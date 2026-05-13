import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { BoxCollider, PlayerControlled, Position, Velocity } from '../src/engine/ecs/components'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import { createPistonSystem } from '../src/engine/ecs/systems/piston-system'
import { registerPistonMechanism } from '../src/game/mechanisms'

function placePlayer(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, PlayerControlled)
    Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = z
    BoxCollider.x[eid] = 0.34; BoxCollider.y[eid] = 0.9; BoxCollider.z[eid] = 0.34
    return eid
}

test('PistonSystem: timer flips the block between from and to', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        interval: 1,
        initial: 'from',
    })
    // registerPistonMechanism seeds the initial cell.
    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.plank)

    const system = createPistonSystem(chunks)
    // Two half-second ticks to consume the interval.
    system.update(world, 0.5)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.air, 'still at from after 0.5 s')
    system.update(world, 0.5)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.plank, 'flipped to "to" once timer hits zero')
    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.air, 'source cell cleared')
})

test('PistonSystem: characterPolicy "block" refuses to flip when the player overlaps the target', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        interval: 1,
        characterPolicy: 'block',
    })

    // Player straddles the target cell.
    placePlayer(world, 6.5, 1, 0.5)

    createPistonSystem(chunks).update(world, 1)
    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.air, 'flip refused while player is in the way')
    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.brick, 'source cell still holds the block')
})

test('PistonSystem: characterPolicy "push" carries the player along the full flip delta', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        interval: 1,
        characterPolicy: 'push',
    })

    const player = placePlayer(world, 5.5, 3, 0.5)

    createPistonSystem(chunks).update(world, 1)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.plank, 'piston extended into the target cell')
    // Push uses the full delta vector (target - source = (0, +2, 0)) so the
    // player lands on top of the newly-placed block, not embedded in it.
    assert.ok(Math.abs(Position.y[player] - 5) < 1e-5, `expected player.y ≈ 5, got ${Position.y[player]}`)
})

test('PistonSystem: "push" refuses the flip if the displaced player would land in a wall', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    // Wall above the player's would-be landing spot.
    chunks.setVoxel(5, 5, 0, BLOCK.stone)
    chunks.setVoxel(5, 6, 0, BLOCK.stone)
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        interval: 1,
        characterPolicy: 'push',
    })

    const player = placePlayer(world, 5.5, 3, 0.5)
    const startY = Position.y[player]

    createPistonSystem(chunks).update(world, 1)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.air, 'flip refused — push would crush the player')
    assert.equal(Position.y[player], startY, 'player stays put when the flip is refused')
})

test('PistonSystem: blocked flip retries sooner than a full interval', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        interval: 5,
        characterPolicy: 'block',
    })
    placePlayer(world, 6.5, 1, 0.5)

    createPistonSystem(chunks).update(world, 5)
    // Refused — retry should be quick (capped at 0.25 s), not another 5 s.
    assert.ok(piston.timer <= 0.25 + 1e-6, `expected fast retry, got timer=${piston.timer}`)
})

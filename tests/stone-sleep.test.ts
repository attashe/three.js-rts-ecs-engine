import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { BoxCollider, MovingObject, Position, RigidBody, Sleeping, Velocity } from '../src/client/engine/ecs/components'
import { createPhysicsSystem } from '../src/client/engine/ecs/systems/physics-system'
import { ChunkManager } from '../src/client/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/client/engine/voxel/palette'
import { createGameWorld, type GameWorld } from '../src/client/engine/ecs/world'

test('PhysicsSystem: overlapping resting stones can sleep instead of spinning forever', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = -1; x <= 2; x++) {
        for (let z = -1; z <= 1; z++) {
            chunks.setVoxel(x, 0, z, BLOCK.stone)
        }
    }

    const world = createGameWorld()
    const a = addRestingStone(world, 0.5, 1.48, 0.5)
    const b = addRestingStone(world, 0.9, 1.48, 0.5)
    const physics = createPhysicsSystem(chunks)

    for (let i = 0; i < 12; i++) physics.update(world, 1 / 60)

    assert.equal(hasComponent(world, a, Sleeping), true)
    assert.equal(hasComponent(world, b, Sleeping), true)
})

test('PhysicsSystem: pushed stone with no actual translation stops rolling and sleeps', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = -1; x <= 2; x++) {
        for (let z = -1; z <= 1; z++) {
            chunks.setVoxel(x, 0, z, BLOCK.stone)
        }
    }

    const world = createGameWorld()
    addSleepingStoneObstacle(world, 0.9, 1.48, 0.5)
    const pushed = addRestingStone(world, 0.5, 1.48, 0.5)
    Velocity.x[pushed] = 2
    RigidBody.linearDamping[pushed] = 0.9
    RigidBody.rollOnGround[pushed] = 1

    const physics = createPhysicsSystem(chunks)
    physics.update(world, 1 / 60)

    assert.equal(Velocity.x[pushed], 0)
    for (let i = 0; i < 8; i++) physics.update(world, 1 / 60)
    assert.equal(hasComponent(world, pushed, Sleeping), true)
})

test('PhysicsSystem: embedded rolling stone recovers out of terrain surface', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            chunks.setVoxel(x, 0, z, BLOCK.stone)
        }
    }

    const world = createGameWorld()
    const stone = addRestingStone(world, 0.5, 0.72, 0.5)
    RigidBody.rollOnGround[stone] = 1
    Velocity.x[stone] = 0.25
    Velocity.z[stone] = 0.15

    const physics = createPhysicsSystem(chunks)
    physics.update(world, 1 / 60)

    assert.ok(Position.y[stone] >= 1.48)
    assert.equal(Velocity.x[stone], 0)
    assert.equal(Velocity.y[stone], 0)
    assert.equal(Velocity.z[stone], 0)
})

test('PhysicsSystem: embedded rolling stone recovers out of voxel wall', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            chunks.setVoxel(x, 0, z, BLOCK.stone)
        }
    }
    for (let y = 1; y <= 3; y++) {
        chunks.setVoxel(0, y, 0, BLOCK.stone)
    }

    const world = createGameWorld()
    const stone = addRestingStone(world, 0.5, 1.48, 0.5)
    RigidBody.rollOnGround[stone] = 1
    Velocity.x[stone] = 0.2

    const physics = createPhysicsSystem(chunks)
    physics.update(world, 1 / 60)

    assert.ok(Position.x[stone] > 1)
    assert.equal(Velocity.x[stone], 0)
    assert.equal(Velocity.y[stone], 0)
    assert.equal(Velocity.z[stone], 0)
})

function addRestingStone(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, RigidBody)
    addComponent(world, eid, MovingObject)
    Position.x[eid] = x
    Position.y[eid] = y
    Position.z[eid] = z
    BoxCollider.x[eid] = 0.48
    BoxCollider.y[eid] = 0.48
    BoxCollider.z[eid] = 0.48
    RigidBody.mass[eid] = 24
    RigidBody.gravityScale[eid] = 1
    RigidBody.sleepThresholdSq[eid] = 0.04
    RigidBody.sleepDelay[eid] = 0.05
    RigidBody.centerAnchored[eid] = 1
    RigidBody.linearDamping[eid] = 0.9
    MovingObject.kind[eid] = 2
    return eid
}

function addSleepingStoneObstacle(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addRestingStone(world, x, y, z)
    addComponent(world, eid, Sleeping)
    world.obstacles.add(eid, {
        minX: x - 0.48,
        maxX: x + 0.48,
        minY: y - 0.48,
        maxY: y + 0.48,
        minZ: z - 0.48,
        maxZ: z + 0.48,
    })
    return eid
}

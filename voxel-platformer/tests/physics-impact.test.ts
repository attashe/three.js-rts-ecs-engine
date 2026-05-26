import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import {
    BoxCollider,
    MovingObject,
    Position,
    RigidBody,
    Velocity,
} from '../src/engine/ecs/components'
import { createPhysicsSystem, type ImpactEvent } from '../src/engine/ecs/systems/physics-system'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { createGameWorld } from '../src/engine/ecs/world'

test('physics-system fires onImpact for a fast vertical landing', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            chunks.setVoxel(x, 0, z, BLOCK.stone)
        }
    }

    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, RigidBody)
    addComponent(world, eid, MovingObject)
    Position.x[eid] = 0.5
    Position.y[eid] = 1.5
    Position.z[eid] = 0.5
    BoxCollider.x[eid] = 0.48
    BoxCollider.y[eid] = 0.48
    BoxCollider.z[eid] = 0.48
    RigidBody.centerAnchored[eid] = 1
    RigidBody.gravityScale[eid] = 1
    RigidBody.mass[eid] = 24
    MovingObject.kind[eid] = 2
    Velocity.y[eid] = -12

    const events: ImpactEvent[] = []
    const physics = createPhysicsSystem(chunks, {
        onImpact: (event) => { events.push(event) },
    })

    for (let i = 0; i < 8; i++) physics.update(world, 1 / 60)

    assert.ok(events.length >= 1, 'expected at least one impact event')
    const event = events[0]!
    assert.equal(event.eid, eid)
    assert.equal(event.movingObjectKind, 2)
    assert.ok(event.speed > 4)
    assert.ok(event.y >= 1)
})

test('physics-system skips onImpact when inbound speed is below impactMinSpeed', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)

    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, RigidBody)
    Position.x[eid] = 0.5
    Position.y[eid] = 1.5
    Position.z[eid] = 0.5
    BoxCollider.x[eid] = 0.48
    BoxCollider.y[eid] = 0.48
    BoxCollider.z[eid] = 0.48
    RigidBody.centerAnchored[eid] = 1
    RigidBody.gravityScale[eid] = 0  // Suppress gravity so we control speed.
    Velocity.y[eid] = -1.5

    const events: ImpactEvent[] = []
    const physics = createPhysicsSystem(chunks, {
        impactMinSpeed: 4.0,
        onImpact: (event) => { events.push(event) },
    })

    for (let i = 0; i < 30; i++) physics.update(world, 1 / 60)

    assert.equal(events.length, 0, 'gentle landings should not emit impact events')
})

test('physics-system reports movingObjectKind 0 for entities without a MovingObject component', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)

    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    Position.x[eid] = 0.5
    Position.y[eid] = 1.5
    Position.z[eid] = 0.5
    BoxCollider.x[eid] = 0.4
    BoxCollider.y[eid] = 0.4
    BoxCollider.z[eid] = 0.4
    Velocity.y[eid] = -10

    const events: ImpactEvent[] = []
    const physics = createPhysicsSystem(chunks, {
        onImpact: (event) => { events.push(event) },
    })

    for (let i = 0; i < 4; i++) physics.update(world, 1 / 60)

    assert.ok(events.length >= 1)
    assert.equal(events[0]!.movingObjectKind, 0)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { BoxCollider, Position, RigidBody } from '../src/engine/ecs/components'
import { colliderAabbForEntity } from '../src/engine/ecs/collider-bounds'
import { createGameWorld } from '../src/engine/ecs/world'
import type { AABB } from '../src/engine/voxel/voxel-collide'

test('colliderAabbForEntity keeps default colliders foot anchored', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    Position.x[eid] = 2
    Position.y[eid] = 3
    Position.z[eid] = 4
    BoxCollider.x[eid] = 0.4
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.5

    assertAabbNear(colliderAabbForEntity(world, eid, emptyAabb()), {
        minX: 1.6,
        minY: 3,
        minZ: 3.5,
        maxX: 2.4,
        maxY: 4.8,
        maxZ: 4.5,
    })
})

test('colliderAabbForEntity centers RigidBody center-anchored stones', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, RigidBody)
    Position.x[eid] = 2
    Position.y[eid] = 3
    Position.z[eid] = 4
    BoxCollider.x[eid] = 0.4
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.5
    RigidBody.centerAnchored[eid] = 1

    assertAabbNear(colliderAabbForEntity(world, eid, emptyAabb()), {
        minX: 1.6,
        minY: 2.1,
        minZ: 3.5,
        maxX: 2.4,
        maxY: 3.9,
        maxZ: 4.5,
    })
})

function emptyAabb(): AABB {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
}

function assertAabbNear(actual: AABB, expected: AABB): void {
    assertNear(actual.minX, expected.minX, 'minX')
    assertNear(actual.minY, expected.minY, 'minY')
    assertNear(actual.minZ, expected.minZ, 'minZ')
    assertNear(actual.maxX, expected.maxX, 'maxX')
    assertNear(actual.maxY, expected.maxY, 'maxY')
    assertNear(actual.maxZ, expected.maxZ, 'maxZ')
}

function assertNear(actual: number, expected: number, label: string): void {
    assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: expected ${expected}, got ${actual}`)
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { addComponent, addEntity } from 'bitecs'
import {
    BoxCollider,
    HorizontalBlocked,
    MoveAlongPath,
    MovementState,
    Position,
    Velocity,
} from '../src/client/engine/ecs/components'
import { MoveAlongPathSystem } from '../src/client/engine/ecs/systems/move-along-path-system'
import { MovementStateId } from '../src/client/engine/ecs/movement-state'
import { createGameWorld } from '../src/client/engine/ecs/world'

test('MoveAlongPathSystem sidesteps left or right when blocked instead of pushing forward forever', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, MoveAlongPath)
    addComponent(world, eid, HorizontalBlocked)
    Position.x[eid] = 0
    Position.y[eid] = 1
    Position.z[eid] = 0
    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    world.pathByEid.set(eid, {
        points: [new Vector3(0, 1, 5)],
        index: 0,
        speed: 2,
    })

    MoveAlongPathSystem.update(world, 0.13)

    assert.ok(Math.abs(Velocity.x[eid]) > 1, `expected a strong lateral sidestep, got vx=${Velocity.x[eid]}`)
    assert.ok(Velocity.z[eid] > 0, `expected a small forward component, got vz=${Velocity.z[eid]}`)
    assert.ok(Math.abs(Velocity.z[eid]) < 1, `expected sidestep to dominate forward push, got vz=${Velocity.z[eid]}`)
})

test('MoveAlongPathSystem treats actor-contact blocked state like a physical blockage', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, MoveAlongPath)
    Position.x[eid] = 0
    Position.y[eid] = 1
    Position.z[eid] = 0
    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    MovementState.value[eid] = MovementStateId.Blocked
    world.pathByEid.set(eid, {
        points: [new Vector3(0, 1, 5)],
        index: 0,
        speed: 2,
    })

    MoveAlongPathSystem.update(world, 0.13)

    assert.ok(Math.abs(Velocity.x[eid]) > 1, `expected contact block to trigger sidestep, got vx=${Velocity.x[eid]}`)
    assert.equal(MovementState.value[eid], MovementStateId.Moving)
    assert.ok((world.pathByEid.get(eid)?.blockedTime ?? 0) > 0)
})

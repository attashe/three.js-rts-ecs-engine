import { Group } from 'three'
import { addComponent, addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    BoxCollider,
    MovingObject,
    Pickup,
    PickupValue,
    Position,
    Renderable,
    Rotation,
    Velocity,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { createArrow, createStone } from './assets'

export const MovingObjectKind = {
    Arrow: 1,
    Stone: 2,
} as const

export interface StoneFallSpawnerConfig {
    position: { x: number; y: number; z: number }
    velocity: { x: number; y: number; z: number }
    interval: number
    jitter?: number
}

export function spawnArrowProjectile(
    world: GameWorld,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Velocity, BoxCollider, MovingObject])
    Position.x[eid] = position.x
    Position.y[eid] = position.y
    Position.z[eid] = position.z
    Velocity.x[eid] = velocity.x
    Velocity.y[eid] = velocity.y
    Velocity.z[eid] = velocity.z
    BoxCollider.x[eid] = 0.06
    BoxCollider.y[eid] = 0.04
    BoxCollider.z[eid] = 0.06
    MovingObject.kind[eid] = MovingObjectKind.Arrow
    MovingObject.age[eid] = 0
    MovingObject.restTime[eid] = 0

    const obj = createArrow()
    obj.scale.setScalar(0.9)
    world.object3DByEid.set(eid, obj)
    addComponent(world, eid, Renderable)
    return eid
}

export function spawnFallingStone(
    world: GameWorld,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Velocity, MovingObject])
    Position.x[eid] = position.x
    Position.y[eid] = position.y
    Position.z[eid] = position.z
    Velocity.x[eid] = velocity.x
    Velocity.y[eid] = velocity.y
    Velocity.z[eid] = velocity.z
    Rotation.y[eid] = Math.atan2(velocity.x, velocity.z)
    MovingObject.kind[eid] = MovingObjectKind.Stone
    MovingObject.age[eid] = 0
    MovingObject.restTime[eid] = 0

    world.object3DByEid.set(eid, createStone())
    addComponent(world, eid, Renderable)
    return eid
}

export function turnArrowIntoPickup(world: GameWorld, eid: number): void {
    addComponents(world, eid, [Pickup, PickupValue])
    PickupValue.kind[eid] = 3
    PickupValue.amount[eid] = 1
    world.pickupByEid.set(eid, {
        label: 'Arrow',
        message: 'Picked up an arrow.',
    })

    const obj = world.object3DByEid.get(eid)
    if (obj instanceof Group) {
        obj.name = 'DroppedArrow'
        obj.scale.setScalar(0.82)
    }
}

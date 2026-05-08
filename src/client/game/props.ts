import { addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    Attackable,
    Faction,
    Health,
    Interactable,
    InteractionRange,
    Pickup,
    PickupValue,
    Position,
    Renderable,
    Rotation,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { FactionId } from '../engine/ecs/factions'
import { createCoinPile, createHealthPotion, createTrainingDummy } from './assets'

export interface PropOptions {
    position: { x: number; y: number; z: number }
    yaw?: number
}

export function spawnCoinPile(world: GameWorld, opts: PropOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, Pickup, PickupValue])
    setTransform(eid, opts)
    PickupValue.kind[eid] = 1
    PickupValue.amount[eid] = 12
    world.pickupByEid.set(eid, {
        label: 'Coins',
        message: 'Picked up 12 gold.',
    })
    world.object3DByEid.set(eid, createCoinPile())
    return eid
}

export function spawnHealthPotion(world: GameWorld, opts: PropOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, Pickup, PickupValue])
    setTransform(eid, opts)
    PickupValue.kind[eid] = 2
    PickupValue.amount[eid] = 25
    world.pickupByEid.set(eid, {
        label: 'Health Potion',
        message: 'Picked up a health potion.',
    })
    world.object3DByEid.set(eid, createHealthPotion())
    return eid
}

export function spawnTrainingDummy(world: GameWorld, opts: PropOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [
        Position,
        Rotation,
        Renderable,
        Interactable,
        InteractionRange,
        Health,
        Faction,
        Attackable,
    ])
    setTransform(eid, opts)
    InteractionRange.value[eid] = 1.7
    Health.max[eid] = 100
    Health.current[eid] = 100
    Faction.id[eid] = FactionId.Hostile
    world.interactionByEid.set(eid, {
        label: 'Training Dummy',
        message: 'A battered practice target. Press F nearby to test your sword.',
    })
    world.object3DByEid.set(eid, createTrainingDummy())
    return eid
}

function setTransform(eid: number, opts: PropOptions): void {
    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0
}

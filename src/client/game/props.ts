import { addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    Group,
    Mesh,
    Object3D,
} from 'three'
import { sharedBoxGeometry, sharedMaterial } from './assets/shared-primitives'
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
    StaticRenderable,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import type { PlayerInventoryItem } from '../engine/ecs/world'
import { FactionId } from '../engine/ecs/factions'
import { createArrow, createBow, createCoinPile, createHealthPotion, createShield, createSword, createTrainingDummy } from './assets'
import { mergeGroupByMaterial } from './assets/merge-group'

export interface PropOptions {
    position: { x: number; y: number; z: number }
    yaw?: number
}

export function spawnCoinPile(world: GameWorld, opts: PropOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, StaticRenderable, Pickup, PickupValue])
    setTransform(eid, opts)
    PickupValue.kind[eid] = 1
    PickupValue.amount[eid] = 12
    world.pickupByEid.set(eid, {
        label: 'Coins',
        message: 'Picked up 12 gold.',
    })
    world.object3DByEid.set(eid, mergeGroupByMaterial(createCoinPile()))
    return eid
}

export function spawnHealthPotion(world: GameWorld, opts: PropOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, StaticRenderable, Pickup, PickupValue])
    setTransform(eid, opts)
    PickupValue.kind[eid] = 2
    PickupValue.amount[eid] = 25
    world.pickupByEid.set(eid, {
        label: 'Health Potion',
        message: 'Picked up a health potion.',
    })
    world.object3DByEid.set(eid, mergeGroupByMaterial(createHealthPotion()))
    return eid
}

export function spawnDroppedInventoryItem(world: GameWorld, item: PlayerInventoryItem, opts: PropOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, StaticRenderable, Pickup])
    setTransform(eid, opts)
    world.pickupByEid.set(eid, {
        label: item.label,
        message: `Picked up ${item.label}.`,
        item: { ...item },
    })
    world.object3DByEid.set(eid, mergeGroupByMaterial(createDroppedObject(item)))
    return eid
}

export function spawnTrainingDummy(world: GameWorld, opts: PropOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [
        Position,
        Rotation,
        Renderable,
        StaticRenderable,
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
    world.object3DByEid.set(eid, mergeGroupByMaterial(createTrainingDummy()))
    return eid
}

function createDroppedObject(item: PlayerInventoryItem): Object3D {
    if (item.id === 'gold') return createCoinPile()
    if (item.id === 'health-potion') return createHealthPotion()
    if (item.id === 'arrows') return createArrow()
    if (item.loadoutKind === 'sword') return createSword()
    if (item.loadoutKind === 'bow') return createBow()
    if (item.equipSlot === 'shield') return createShield()

    const root = new Group()
    root.name = `Dropped${item.label.replace(/\s+/g, '')}`
    const mesh = new Mesh(sharedBoxGeometry(0.34, 0.18, 0.34), sharedMaterial(0x8fa6b8, 0.7))
    mesh.name = 'DroppedItemBox'
    mesh.position.y = 0.12
    mesh.castShadow = true
    mesh.receiveShadow = true
    root.add(mesh)
    return root
}

function setTransform(eid: number, opts: PropOptions): void {
    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0
}

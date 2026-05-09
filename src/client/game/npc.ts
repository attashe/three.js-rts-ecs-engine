import { Group } from 'three'
import { addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    BoxCollider,
    Behaviour,
    Faction,
    Health,
    Interactable,
    InteractionRange,
    Position,
    Renderable,
    Rotation,
    Velocity,
    Wanderer,
    WanderHome,
    WanderRadius,
    WanderTimer,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { FactionId } from '../engine/ecs/factions'
import { BehaviourProfileId, assignBehaviourProfile } from '../engine/ecs/behaviour'
import { createSampleNpc } from './assets'

export interface NpcOptions {
    position: { x: number; y: number; z: number }
    yaw?: number
    faction?: FactionId
    behaviourProfile?: BehaviourProfileId
}

export function spawnSampleNpc(world: GameWorld, opts: NpcOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, BoxCollider, Faction, Health, Interactable, InteractionRange, Behaviour])

    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0

    BoxCollider.x[eid] = 0.35
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.35
    Faction.id[eid] = opts.faction ?? FactionId.Neutral
    Health.max[eid] = 60
    Health.current[eid] = 60
    InteractionRange.value[eid] = 1.8
    world.interactionByEid.set(eid, {
        label: 'Merchant',
        message: 'Roads are quiet today. Bring coins when trade is wired in.',
    })

    world.object3DByEid.set(eid, createForwardFacingNpc())
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.NeutralMerchant, opts.position)
    return eid
}

export function spawnWanderingNpc(world: GameWorld, opts: NpcOptions & { radius?: number }): number {
    const eid = createEntity(world)
    addComponents(world, eid, [
        Position,
        Rotation,
        Velocity,
        Renderable,
        BoxCollider,
        Faction,
        Health,
        Interactable,
        InteractionRange,
        Behaviour,
        Wanderer,
        WanderHome,
        WanderRadius,
        WanderTimer,
    ])

    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0

    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    Faction.id[eid] = opts.faction ?? FactionId.Neutral
    Health.max[eid] = 80
    Health.current[eid] = 80
    InteractionRange.value[eid] = 1.6
    WanderHome.x[eid] = opts.position.x
    WanderHome.y[eid] = opts.position.y
    WanderHome.z[eid] = opts.position.z
    WanderRadius.value[eid] = opts.radius ?? 7
    WanderTimer.value[eid] = 0.25 + (eid % 5) * 0.2

    world.interactionByEid.set(eid, {
        label: 'Wandering Scout',
        message: 'I am testing the paths around these blocked wards.',
    })
    world.object3DByEid.set(eid, createForwardFacingNpc({
        tunicColor: 0x486a88,
        apronColor: 0xc58b45,
        hatColor: 0x34495c,
    }))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.NeutralWanderer, opts.position)
    return eid
}

function createForwardFacingNpc(opts?: Parameters<typeof createSampleNpc>[0]): Group {
    const root = new Group()
    root.name = 'NpcRoot'
    const visual = createSampleNpc(opts)
    // The placeholder NPC mesh was authored facing -Z; the engine movement
    // convention treats +Z as forward for yaw=0.
    visual.rotation.y = Math.PI
    root.add(visual)
    return root
}

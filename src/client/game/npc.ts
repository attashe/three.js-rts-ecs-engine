import { Group } from 'three'
import { addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    Attackable,
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
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { FactionId } from '../engine/ecs/factions'
import { BehaviourProfileId, assignBehaviourProfile } from '../engine/ecs/behaviour'
import { createBanditEnemy, createSampleNpc } from './assets'

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

export interface HostileNpcOptions extends NpcOptions {
    label?: string
}

/**
 * Hostile melee actor. Reuses the same path-following body shape as wandering
 * NPCs (so dynamic-collision and MoveAlongPath treat it identically) but
 * carries `Attackable` so player melee + arrows + falling stones all damage it
 * via the shared `applyDamagePacket` path. AI behaviour is purely profile-
 * driven — drop in a different `behaviourProfile` to get a different archetype.
 */
export function spawnHostileMeleeNpc(world: GameWorld, opts: HostileNpcOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [
        Position,
        Rotation,
        Velocity,
        Renderable,
        BoxCollider,
        Faction,
        Health,
        Attackable,
        Behaviour,
        Wanderer,
    ])

    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0

    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    Faction.id[eid] = opts.faction ?? FactionId.Hostile
    Health.max[eid] = 50
    Health.current[eid] = 50

    world.interactionByEid.set(eid, {
        label: opts.label ?? 'Hostile Marauder',
        message: 'Hostile — strikes on sight.',
    })
    world.object3DByEid.set(eid, createForwardFacingActor(createBanditEnemy()))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.HostileMeleeGrunt, opts.position)
    return eid
}

function createForwardFacingNpc(opts?: Parameters<typeof createSampleNpc>[0]): Group {
    return createForwardFacingActor(createSampleNpc(opts))
}

function createForwardFacingActor(visual: Group): Group {
    const root = new Group()
    root.name = 'NpcRoot'
    // Placeholder meshes are authored facing -Z; the engine movement convention
    // treats +Z as forward for yaw=0, so flip them once on spawn.
    visual.rotation.y = Math.PI
    root.add(visual)
    return root
}

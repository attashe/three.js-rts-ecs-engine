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
    Shield,
    Velocity,
    Wanderer,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { FactionId } from '../engine/ecs/factions'
import { BehaviourProfileId, assignBehaviourProfile } from '../engine/ecs/behaviour'
import { createBanditEnemy, createBow, createQuiver, createRabbit, createSampleNpc, createTownGuardNpc } from './assets'
import { mergeGroupByMaterial } from './assets/merge-group'

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

    world.object3DByEid.set(eid, createMergedForwardFacingNpc())
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
        Attackable,
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
    world.object3DByEid.set(eid, createMergedForwardFacingNpc({
        tunicColor: 0x486a88,
        apronColor: 0xc58b45,
        hatColor: 0x34495c,
    }))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.NeutralWanderer, opts.position)
    return eid
}

export interface VillagerNpcOptions extends NpcOptions {
    label?: string
}

export function spawnVillagerNpc(world: GameWorld, opts: VillagerNpcOptions): number {
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
        Interactable,
        InteractionRange,
        Behaviour,
        Wanderer,
    ])

    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0

    BoxCollider.x[eid] = 0.32
    BoxCollider.y[eid] = 0.86
    BoxCollider.z[eid] = 0.32
    Faction.id[eid] = opts.faction ?? FactionId.Neutral
    Health.max[eid] = 45
    Health.current[eid] = 45
    InteractionRange.value[eid] = 1.6

    world.interactionByEid.set(eid, {
        label: opts.label ?? 'Villager',
        message: 'A villager going about daily work.',
    })
    world.object3DByEid.set(eid, createMergedForwardFacingNpc({
        tunicColor: 0x6f7f4a,
        apronColor: 0xc8a86a,
        hatColor: 0x6b4a2e,
    }))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.Villager, opts.position)
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
    world.object3DByEid.set(eid, mergeGroupByMaterial(createForwardFacingActor(createBanditEnemy(combatPalette(Faction.id[eid])))))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.HostileMeleeGrunt, opts.position)
    return eid
}

export function spawnHostileArcherNpc(world: GameWorld, opts: HostileNpcOptions): number {
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

    BoxCollider.x[eid] = 0.32
    BoxCollider.y[eid] = 0.88
    BoxCollider.z[eid] = 0.32
    Faction.id[eid] = opts.faction ?? FactionId.Hostile
    Health.max[eid] = 42
    Health.current[eid] = 42

    world.interactionByEid.set(eid, {
        label: opts.label ?? 'Bandit Archer',
        message: 'Hostile archer — keeps distance and fires arrows.',
    })
    world.object3DByEid.set(eid, mergeGroupByMaterial(createForwardFacingArcher(Faction.id[eid])))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.HostileArcher, opts.position)
    return eid
}

export interface GuardNpcOptions extends NpcOptions {
    label?: string
}

export function spawnGuardNpc(world: GameWorld, opts: GuardNpcOptions): number {
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
        Shield,
    ])

    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0

    BoxCollider.x[eid] = 0.35
    BoxCollider.y[eid] = 0.92
    BoxCollider.z[eid] = 0.35
    Faction.id[eid] = opts.faction ?? FactionId.Neutral
    Health.max[eid] = 80
    Health.current[eid] = 80
    configureActorShield(eid)

    world.interactionByEid.set(eid, {
        label: opts.label ?? 'Village Guard',
        message: 'Guarding the village roads.',
    })
    world.object3DByEid.set(eid, createForwardFacingActor(createTownGuardNpc()))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.Guard, opts.position)
    return eid
}

export interface HunterNpcOptions extends NpcOptions {
    huntingGround: { x: number; y: number; z: number }
    label?: string
}

export function spawnHunterNpc(world: GameWorld, opts: HunterNpcOptions): number {
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
        Shield,
    ])

    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0

    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    Faction.id[eid] = opts.faction ?? FactionId.Hunter
    Health.max[eid] = 70
    Health.current[eid] = 70
    configureActorShield(eid)

    world.interactionByEid.set(eid, {
        label: opts.label ?? 'Village Hunter',
        message: 'Leaves home, hunts rabbits, then returns.',
    })
    world.object3DByEid.set(eid, createForwardFacingActor(createTownGuardNpc({
        primary: 0x3f6b3a,
        secondary: 0x5a3826,
        metal: 0x8f8a7c,
        accent: 0xc49a54,
    })))
    assignBehaviourProfile(
        world,
        eid,
        opts.behaviourProfile ?? BehaviourProfileId.Hunter,
        opts.position,
        { activity: opts.huntingGround },
    )
    return eid
}

function configureActorShield(eid: number): void {
    Shield.raised[eid] = 1
    Shield.blockArcCos[eid] = Math.cos(Math.PI * 0.42)
    Shield.minY[eid] = 0.42
    Shield.maxY[eid] = 1.5
}

export interface RabbitNpcOptions extends NpcOptions {
    label?: string
}

export function spawnRabbitNpc(world: GameWorld, opts: RabbitNpcOptions): number {
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

    BoxCollider.x[eid] = 0.22
    BoxCollider.y[eid] = 0.28
    BoxCollider.z[eid] = 0.22
    Faction.id[eid] = opts.faction ?? FactionId.Wildlife
    Health.max[eid] = 12
    Health.current[eid] = 12

    world.interactionByEid.set(eid, {
        label: opts.label ?? 'Rabbit',
        message: 'A skittish rabbit.',
    })
    world.object3DByEid.set(eid, mergeGroupByMaterial(createForwardFacingActor(createRabbit())))
    assignBehaviourProfile(world, eid, opts.behaviourProfile ?? BehaviourProfileId.Rabbit, opts.position)
    return eid
}

function createForwardFacingNpc(opts?: Parameters<typeof createSampleNpc>[0]): Group {
    return createForwardFacingActor(createSampleNpc(opts))
}

function createMergedForwardFacingNpc(opts?: Parameters<typeof createSampleNpc>[0]): Group {
    return mergeGroupByMaterial(createForwardFacingNpc(opts))
}

function createForwardFacingArcher(faction: FactionId): Group {
    const visual = createBanditEnemy(combatPalette(faction, true))
    const bow = createBow({ height: 1.18, width: 0.34 })
    bow.name = 'ArcherBow'
    bow.position.set(0.47, 0.88, -0.12)
    bow.rotation.set(0.08, -0.18, -0.18)
    bow.scale.setScalar(0.78)
    visual.add(bow)

    const quiver = createQuiver({ arrowCount: 3 })
    quiver.name = 'ArcherQuiver'
    quiver.position.set(-0.24, 0.94, 0.27)
    quiver.rotation.set(0.16, 0.48, -0.2)
    quiver.scale.setScalar(0.58)
    visual.add(quiver)
    return createForwardFacingActor(visual)
}

function combatPalette(faction: FactionId, archer = false): Parameters<typeof createBanditEnemy>[0] {
    if (faction === FactionId.SkirmishRed) {
        return {
            primary: archer ? 0x8b3d35 : 0xa0443c,
            secondary: 0x5a3826,
            accent: 0x211514,
        }
    }
    if (faction === FactionId.SkirmishBlue) {
        return {
            primary: archer ? 0x335f85 : 0x386f9b,
            secondary: 0x2f3b45,
            accent: 0x151b22,
        }
    }
    return archer
        ? { primary: 0x4b4f63, secondary: 0x4a3524, accent: 0x191819 }
        : {}
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

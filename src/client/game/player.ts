import { Group } from 'three'
import { addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    BoxCollider,
    CameraTarget,
    Faction,
    Health,
    PlayerControlled,
    PlayerResources,
    Position,
    Renderable,
    Rotation,
    Shield,
    Velocity,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { FactionId } from '../engine/ecs/factions'
import {
    createBow,
    createMainCharacter,
    createQuiver,
    createShield,
    createSword,
    MAIN_CHARACTER_COLLIDER_HALF_HEIGHT,
    MAIN_CHARACTER_COLLIDER_RADIUS,
} from './assets'
import { populateDefaultPlayerLoadout } from './items'

export interface PlayerOptions {
    spawn: { x: number; y: number; z: number }
    bodyColor?: number
    rimColor?: number
}

/**
 * Spawn the player entity. Returns its EID.
 *
 * The mesh is a capsule wrapped in a `Group` so the entity's `Position` is
 * the player's *feet*, not the centre of the capsule. The visual offset
 * lives entirely in the Group, so all gameplay code (physics, AABB collider,
 * camera target) deals with foot-space coordinates.
 *
 * Components attached:
 *   Position, Rotation, Velocity     — kinematic state.
 *   BoxCollider                      — half-extents (X, Z) and half-height (Y).
 *                                      AABB spans [pos.y, pos.y + 2*half.y].
 *   PlayerControlled                 — opts the entity into PlayerControlSystem.
 *   CameraTarget                     — the camera follows this entity.
 *   Renderable                       — RenderSyncSystem mirrors Position/Rotation onto the Group.
 *
 * The `Grounded` tag is added/removed by the physics system as it sweeps.
 */
export function spawnPlayer(world: GameWorld, opts: PlayerOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [
        Position,
        Rotation,
        Velocity,
        BoxCollider,
        Health,
        Faction,
        Shield,
        PlayerResources,
        PlayerControlled,
        Renderable,
        CameraTarget,
    ])
    Position.x[eid] = opts.spawn.x
    Position.y[eid] = opts.spawn.y
    Position.z[eid] = opts.spawn.z

    // X/Z are half-widths; Y is half-height (AABB Y spans [foot, foot + 2*half.y]).
    BoxCollider.x[eid] = MAIN_CHARACTER_COLLIDER_RADIUS
    BoxCollider.y[eid] = MAIN_CHARACTER_COLLIDER_HALF_HEIGHT
    BoxCollider.z[eid] = MAIN_CHARACTER_COLLIDER_RADIUS
    Health.max[eid] = 100
    Health.current[eid] = 100
    PlayerResources.maxMana[eid] = 60
    PlayerResources.mana[eid] = 60
    PlayerResources.maxStamina[eid] = 100
    PlayerResources.stamina[eid] = 100
    Faction.id[eid] = FactionId.Player
    Shield.raised[eid] = 0
    Shield.blockArcCos[eid] = Math.cos(Math.PI * 0.42)
    Shield.minY[eid] = 0.45
    Shield.maxY[eid] = 1.45

    const root = new Group()
    root.name = 'PlayerRoot'
    root.add(createMainCharacter({
        tunicColor: opts.bodyColor ?? 0x2f5e8f,
        cloakColor: opts.rimColor ?? 0x7a2430,
    }))
    root.add(createEquippedSword())
    root.add(createEquippedShield())
    root.add(createBackBow())
    root.add(createBackQuiver())

    world.object3DByEid.set(eid, root)
    populateDefaultPlayerLoadout(world)
    return eid
}

function createEquippedShield(): Group {
    const shield = createShield({ width: 0.44, height: 0.68, color: 0x2f5e8f, rimColor: 0xc8b56f })
    shield.name = 'PlayerShield'
    shield.position.set(-0.44, 0.68, 0.08)
    shield.rotation.set(0.72, 0.12, -0.28)
    shield.scale.setScalar(0.84)
    return shield
}

function createEquippedSword(): Group {
    const sword = createSword({ bladeLength: 0.62, bladeWidth: 0.1, hiltLength: 0.2 })
    sword.name = 'EquippedSword'
    sword.position.set(0.43, 0.72, 0.08)
    sword.rotation.set(0.22, 0.1, -0.72)
    sword.scale.setScalar(0.62)
    return sword
}

function createBackBow(): Group {
    const bow = createBow({ height: 1.05, width: 0.3 })
    bow.name = 'BackBow'
    bow.position.set(-0.24, 0.95, 0.22)
    bow.rotation.set(0.12, 0.55, -0.22)
    bow.scale.setScalar(0.75)
    return bow
}

function createBackQuiver(): Group {
    const quiver = createQuiver({ arrowCount: 4 })
    quiver.name = 'BackQuiver'
    quiver.position.set(0.22, 0.92, 0.24)
    quiver.rotation.set(0.1, -0.4, -0.18)
    quiver.scale.setScalar(0.62)
    return quiver
}

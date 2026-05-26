import { Group } from 'three'
import { addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    BoxCollider,
    CameraTarget,
    PlayerControlled,
    Position,
    Renderable,
    Rotation,
    Velocity,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import {
    createBow,
    createMainCharacter,
    createPlayerTorch,
    createQuiver,
    MAIN_CHARACTER_COLLIDER_HALF_HEIGHT,
    MAIN_CHARACTER_COLLIDER_RADIUS,
} from './assets'

export interface PlayerOptions {
    spawn: { x: number; y: number; z: number }
    bodyColor?: number
    rimColor?: number
}

/**
 * Spawn the player entity. Returns its EID.
 *
 * The mesh is a capsule wrapped in a `Group` so the entity's `Position` is
 * the player's *feet*, not the centre of the capsule. The visual offset lives
 * entirely in the Group, so all gameplay code (physics, AABB collider, camera
 * target) deals with foot-space coordinates.
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
        PlayerControlled,
        Renderable,
        CameraTarget,
    ])
    Position.x[eid] = opts.spawn.x
    Position.y[eid] = opts.spawn.y
    Position.z[eid] = opts.spawn.z

    BoxCollider.x[eid] = MAIN_CHARACTER_COLLIDER_RADIUS
    BoxCollider.y[eid] = MAIN_CHARACTER_COLLIDER_HALF_HEIGHT
    BoxCollider.z[eid] = MAIN_CHARACTER_COLLIDER_RADIUS

    const root = new Group()
    root.name = 'PlayerRoot'
    root.add(createMainCharacter({
        tunicColor: opts.bodyColor ?? 0x2f5e8f,
        cloakColor: opts.rimColor ?? 0x7a2430,
    }))
    root.add(createBackBow())
    root.add(createBackQuiver())
    root.add(createHeldTorch())

    world.object3DByEid.set(eid, root)
    return eid
}

function createHeldTorch(): Group {
    const torch = createPlayerTorch()
    torch.position.set(0.35, 0.68, 0.18)
    torch.rotation.set(0.16, -0.04, -0.14)
    torch.scale.setScalar(0.94)
    return torch
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

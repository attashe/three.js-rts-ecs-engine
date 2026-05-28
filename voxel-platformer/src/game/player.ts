import { Group, PointLight } from 'three'
import { addComponents, query } from 'bitecs'
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
import { RENDER_LAYER, setLayerRecursive } from '../engine/render/render-layers'
import { DEFAULT_PLAYER_SETTINGS, type PlayerModelKind, type PlayerSettings } from './player-settings'

export interface PlayerOptions {
    spawn: { x: number; y: number; z: number }
    bodyColor?: number
    rimColor?: number
    settings?: PlayerSettings
}

export const PLAYER_MODEL_KIND_USER_DATA = 'playerModelKind'

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
    const settings = opts.settings ?? DEFAULT_PLAYER_SETTINGS
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
    root.add(createPlayerModel(settings.model, opts))
    root.add(createBackBow())
    root.add(createBackQuiver())
    root.add(createHeldTorch(settings))

    // Move the entire player rig to the PLAYER layer. Cameras + lights
    // that should still see/illuminate the player must opt into this
    // layer via `enablePlayerVisibility()`; otherwise the player goes
    // dark or invisible. The point of this isolation is so the
    // player-held torch's shadow camera (which stays on the WORLD
    // layer only) does not project the player's own body into its
    // shadow map.
    setLayerRecursive(root, RENDER_LAYER.PLAYER)
    // The held torch's PointLight is now on the PLAYER layer only,
    // which would stop it lighting the world. Re-broaden every light
    // descendant to also include the WORLD layer — they need to
    // illuminate both. (The light's `shadow.camera.layers` is a
    // separate mask and stays at the default WORLD-only, so the
    // shadow render still excludes the player body.)
    root.traverse((obj) => {
        if (!(obj instanceof PointLight)) return
        obj.layers.enable(RENDER_LAYER.WORLD)
    })

    world.object3DByEid.set(eid, root)
    return eid
}

interface PlayerVisualOptions {
    bodyColor?: number
    rimColor?: number
}

function createPlayerModel(modelKind: PlayerModelKind, opts: PlayerVisualOptions): Group {
    let model: Group
    if (modelKind === 'keeper') {
        model = createMainCharacter({
            tunicColor: opts.bodyColor ?? 0x1f2c3f,
            cloakColor: opts.rimColor ?? 0x3f2818,
            skinColor: 0xc89461,
            metalColor: 0xffc462,
            bootColor: 0x17120d,
        })
    } else {
        model = createMainCharacter({
            tunicColor: opts.bodyColor ?? 0x2f5e8f,
            cloakColor: opts.rimColor ?? 0x7a2430,
        })
    }
    model.name = 'PlayerModel'
    model.userData[PLAYER_MODEL_KIND_USER_DATA] = modelKind
    return model
}

export function syncPlayerVisuals(world: GameWorld): void {
    const players = query(world, [PlayerControlled, Renderable])
    for (let i = 0; i < players.length; i++) {
        const root = world.object3DByEid.get(players[i]!)
        if (!(root instanceof Group)) continue
        syncPlayerModel(root, world.playerSettings.model)
    }
}

function syncPlayerModel(root: Group, modelKind: PlayerModelKind): void {
    const current = root.children.find((child) => child.userData[PLAYER_MODEL_KIND_USER_DATA] !== undefined)
    if (current?.userData[PLAYER_MODEL_KIND_USER_DATA] === modelKind) return

    const next = createPlayerModel(modelKind, {})
    setLayerRecursive(next, RENDER_LAYER.PLAYER)
    if (!current) {
        root.add(next)
        return
    }

    const index = root.children.indexOf(current)
    root.remove(current)
    root.add(next)
    const appendedIndex = root.children.indexOf(next)
    if (index >= 0 && appendedIndex >= 0 && index < appendedIndex) {
        root.children.splice(appendedIndex, 1)
        root.children.splice(index, 0, next)
    }
}

function createHeldTorch(settings: PlayerSettings): Group {
    const torch = createPlayerTorch(settings.torch)
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

import { Group, PointLight, type Object3D } from 'three'
import { addComponents, query } from 'bitecs'
import type { GameWorld, WeaponStance } from '../engine/ecs/world'
import {
    Animated,
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
    createPlayerTorch,
    createQuiver,
    MAIN_CHARACTER_COLLIDER_HALF_HEIGHT,
    MAIN_CHARACTER_COLLIDER_RADIUS,
} from './assets'
import { AnimationController } from '../engine/anim'
import { playerProfile } from './anim/character-profiles'
import { equip, unequipSlot } from './anim/equipment'
import { handLoadoutKey, type EquipmentHandLoadout } from './anim/equipment-types'
import { RENDER_LAYER, setLayerRecursive } from '../engine/render/render-layers'
import { disposeObject3D } from '../engine/render/dispose-object'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from './player-settings'

export interface PlayerOptions {
    spawn: { x: number; y: number; z: number }
    bodyColor?: number
    rimColor?: number
    settings?: PlayerSettings
}

export const PLAYER_MODEL_KIND_USER_DATA = 'playerModelKind'
export const PLAYER_MODEL_VISUAL_KEY_USER_DATA = 'playerModelVisualKey'
const PLAYER_EQUIPMENT_KEY_USER_DATA = 'playerEquipmentKey'

/**
 * Spawn the player entity. Returns its EID.
 *
 * The visual rig is a `Group` whose origin is at the player's *feet*, so the
 * entity's `Position` is foot-space (matching the AABB collider and camera
 * target). The player model is a skeletal rig driven by the animation engine:
 * its AnimationController lives in `world.animControllerByEid` and the
 * animation-system ticks it each render frame from movement signals. Equipment
 * (hat / weapons) is parented to the rig's socket bones so it follows the
 * animation.
 *
 * Components attached:
 *   Position, Rotation, Velocity     — kinematic state.
 *   BoxCollider                      — half-extents (X, Z) and half-height (Y).
 *   PlayerControlled                 — opts the entity into PlayerControlSystem.
 *   CameraTarget                     — the camera follows this entity.
 *   Renderable                       — RenderSyncSystem mirrors Position/Rotation onto the Group.
 *   Animated                         — AnimationSystem drives its controller.
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
        Animated,
    ])
    Position.x[eid] = opts.spawn.x
    Position.y[eid] = opts.spawn.y
    Position.z[eid] = opts.spawn.z

    BoxCollider.x[eid] = MAIN_CHARACTER_COLLIDER_RADIUS
    BoxCollider.y[eid] = MAIN_CHARACTER_COLLIDER_HALF_HEIGHT
    BoxCollider.z[eid] = MAIN_CHARACTER_COLLIDER_RADIUS

    const root = new Group()
    root.name = 'PlayerRoot'
    root.add(buildAnimatedPlayerModel(world, eid, settings))
    root.add(createBackBow())
    root.add(createBackQuiver())
    root.add(createHeldTorch(settings))
    world.object3DByEid.set(eid, root)
    equipDefaultLoadout(world, eid)

    // Move the entire player rig (incl. socket equipment) to the PLAYER layer so
    // the held torch's shadow camera (WORLD layer only) doesn't project the
    // player's own body into its shadow map.
    setLayerRecursive(root, RENDER_LAYER.PLAYER)
    // The held torch's PointLight must still light the WORLD layer; re-broaden
    // every light descendant (their shadow.camera.layers stays WORLD-only).
    root.traverse((obj) => {
        if (obj instanceof PointLight) obj.layers.enable(RENDER_LAYER.WORLD)
    })

    return eid
}

/**
 * Build the player's animated rig from its profile, register the
 * AnimationController in the world side-table, and return the model Group.
 */
function buildAnimatedPlayerModel(world: GameWorld, eid: number, settings: PlayerSettings): Object3D {
    const profile = playerProfile(settings.model, { beard: settings.beard })
    const clipSet = profile.clipSource.instantiate()
    const model = clipSet.root
    model.name = 'PlayerModel'
    model.userData[PLAYER_MODEL_KIND_USER_DATA] = settings.model
    model.userData[PLAYER_MODEL_VISUAL_KEY_USER_DATA] = playerModelVisualKey(settings)

    const controller = new AnimationController(clipSet, profile.graph)
    world.animControllerByEid.get(eid)?.dispose()
    world.animControllerByEid.set(eid, controller)
    return model
}

/** Hat on the head, a weapon in each hand — demonstrates the socket system and
 *  the iso-important head slot. Re-run after a model swap (sockets are rebuilt). */
function equipDefaultLoadout(world: GameWorld, eid: number): void {
    equip(world, eid, 'head', 'hat')
    applyWeaponStance(world, eid, world.weaponStance)
}

/**
 * Swap the player's in-hand loadout to match the weapon stance:
 *  - `melee`  — sword (right) + shield (left); the back bow shows (stowed).
 *  - `ranged` — bow (left), hands otherwise empty; back bow hidden (it's in hand).
 * The hat stays on across both. Safe to call repeatedly (re-equips in place).
 */
export function applyWeaponStance(world: GameWorld, eid: number, stance: WeaponStance): void {
    const loadout = world.playerSettings.equipment[stance]
    applyHandLoadout(world, eid, loadout)
    // Avoid showing two bows: hide the decorative back bow while it's in hand.
    const root = world.object3DByEid.get(eid)
    const backBow = root?.getObjectByName('BackBow')
    if (backBow) backBow.visible = !loadoutHasBow(loadout)
    if (root) root.userData[PLAYER_EQUIPMENT_KEY_USER_DATA] = playerEquipmentRuntimeKey(world)
}

export function syncPlayerVisuals(world: GameWorld): void {
    const players = query(world, [PlayerControlled, Renderable])
    for (let i = 0; i < players.length; i++) {
        const eid = players[i]!
        const root = world.object3DByEid.get(eid)
        if (root instanceof Group) syncPlayerModel(world, eid, root, world.playerSettings)
    }
}

function syncPlayerModel(world: GameWorld, eid: number, root: Group, settings: PlayerSettings): void {
    const current = root.children.find((child) => child.userData[PLAYER_MODEL_KIND_USER_DATA] !== undefined)
    if (current?.userData[PLAYER_MODEL_VISUAL_KEY_USER_DATA] === playerModelVisualKey(settings)) {
        if (root.userData[PLAYER_EQUIPMENT_KEY_USER_DATA] !== playerEquipmentRuntimeKey(world)) {
            equipDefaultLoadout(world, eid)
        }
        return
    }

    world.equipmentByEid.delete(eid)
    const next = buildAnimatedPlayerModel(world, eid, settings)

    let index = -1
    if (current) {
        index = root.children.indexOf(current)
        root.remove(current)
        disposeObject3D(current)
    }
    root.add(next)
    if (index >= 0) {
        const appendedIndex = root.children.indexOf(next)
        if (appendedIndex >= 0 && index < appendedIndex) {
            root.children.splice(appendedIndex, 1)
            root.children.splice(index, 0, next)
        }
    }

    equipDefaultLoadout(world, eid)
    setLayerRecursive(next, RENDER_LAYER.PLAYER)
}

function applyHandLoadout(world: GameWorld, eid: number, loadout: EquipmentHandLoadout): void {
    if (loadout.handR) equip(world, eid, 'handR', loadout.handR)
    else unequipSlot(world, eid, 'handR')

    if (loadout.handL) equip(world, eid, 'handL', loadout.handL)
    else unequipSlot(world, eid, 'handL')
}

function loadoutHasBow(loadout: EquipmentHandLoadout): boolean {
    return loadout.handR === 'bow' || loadout.handL === 'bow'
}

function playerEquipmentRuntimeKey(world: GameWorld): string {
    return `${world.weaponStance}:${handLoadoutKey(world.playerSettings.equipment[world.weaponStance])}`
}

function playerModelVisualKey(settings: Pick<PlayerSettings, 'model' | 'beard'>): string {
    return `${settings.model}:${settings.beard}`
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

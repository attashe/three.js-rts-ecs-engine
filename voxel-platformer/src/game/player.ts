import { Group, PointLight, type Object3D } from 'three'
import { addComponents, query } from 'bitecs'
import type { GameWorld, WeaponStance } from '../engine/ecs/world'
import {
    Animated,
    BoxCollider,
    CameraTarget,
    Health,
    Mana,
    PlayerControlled,
    Shield,
    Position,
    Renderable,
    Rotation,
    Velocity,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { HP_PER_HEART } from '../engine/ecs/combat'
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
import { playerEquipmentKey, type EquipmentHandLoadout } from './anim/equipment-types'
import { RENDER_LAYER, setLayerRecursive } from '../engine/render/render-layers'
import { disposeObject3D } from '../engine/render/dispose-object'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from './player-settings'
import { initMana, PLAYER_DEFAULT_MAX_MANA } from './mana'

export interface PlayerOptions {
    spawn: { x: number; y: number; z: number }
    bodyColor?: number
    rimColor?: number
    settings?: PlayerSettings
}

/** Lean HP model rendered as hearts: the player starts with two full hearts
 *  (each heart = `HP_PER_HEART` HP), and the default enemy hit takes half a
 *  heart — so four hits down the player. Scripts can raise `Health.max` per
 *  level if a tougher player is wanted. Mana starts as an empty pool — scripts
 *  opt in through the game-level mana helpers, which spend half-orb units. */
export const PLAYER_DEFAULT_MAX_HEALTH = 2 * HP_PER_HEART

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
        Health,
        Mana,
        Shield,
    ])
    Position.x[eid] = opts.spawn.x
    Position.y[eid] = opts.spawn.y
    Position.z[eid] = opts.spawn.z

    Health.max[eid] = PLAYER_DEFAULT_MAX_HEALTH
    Health.current[eid] = PLAYER_DEFAULT_MAX_HEALTH
    initMana(eid, PLAYER_DEFAULT_MAX_MANA)
    // Directional block covering the body height. Lowered by default; the
    // player-shield-system drives `raised`, the arc width, and the arc
    // direction (front when T is held, left-flank when passive).
    Shield.raised[eid] = 0
    Shield.perfect[eid] = 0
    Shield.heldSeconds[eid] = 0
    Shield.reloadSeconds[eid] = 0
    Shield.blockArcCos[eid] = 0.5
    Shield.blockYawOffset[eid] = 0
    Shield.minY[eid] = 0
    Shield.maxY[eid] = MAIN_CHARACTER_COLLIDER_HALF_HEIGHT * 2

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

/** Persistent accessories plus weapon hands. Re-run after a model swap
 *  because sockets are rebuilt with the new rig. */
function equipDefaultLoadout(world: GameWorld, eid: number): void {
    const head = world.playerSettings.equipment.head
    if (head) equip(world, eid, 'head', head)
    else unequipSlot(world, eid, 'head')
    const boots = world.playerSettings.equipment.boots
    if (boots) {
        equip(world, eid, 'footL', boots)
        equip(world, eid, 'footR', boots)
    } else {
        unequipSlot(world, eid, 'footL')
        unequipSlot(world, eid, 'footR')
    }
    applyWeaponStance(world, eid, world.weaponStance)
    syncPlayerHeldTorchVisibility(world)
}

/**
 * Swap the player's in-hand loadout to match the weapon stance:
 *  - `melee`  — sword (right) + shield (left); bow/quiver hidden.
 *  - `ranged` — bow (left) + arrow (right), quiver shown, duplicate back bow hidden.
 *  - `magic`  — staff or spell focus; bow/quiver hidden.
 * The head item stays on across all stances. Safe to call repeatedly
 * (re-equips in place).
 */
export function applyWeaponStance(world: GameWorld, eid: number, stance: WeaponStance): void {
    const loadout = world.playerSettings.equipment[stance]
    applyHandLoadout(world, eid, loadout)
    // Ranged gear is stance-specific: bow in hand, quiver on back. Keep both
    // out of melee/magic silhouettes so those loadouts read cleanly.
    const root = world.object3DByEid.get(eid)
    const backBow = root?.getObjectByName('BackBow')
    if (backBow) backBow.visible = stance === 'ranged' && !loadoutHasBow(loadout)
    const backQuiver = root?.getObjectByName('BackQuiver')
    if (backQuiver) backQuiver.visible = stance === 'ranged'
    if (root) root.userData[PLAYER_EQUIPMENT_KEY_USER_DATA] = playerEquipmentRuntimeKey(world)
}

export function syncPlayerHeldTorchVisibility(world: GameWorld): void {
    const enabled = world.playerSettings.abilities.torch
    const players = query(world, [PlayerControlled, Renderable])
    for (const eid of players) {
        const root = world.object3DByEid.get(eid)
        const torch = root?.getObjectByName('PlayerTorch')
        if (!torch) continue
        torch.visible = enabled
        torch.traverse((obj) => {
            if (obj instanceof PointLight) {
                obj.visible = enabled
                obj.castShadow = enabled && world.playerSettings.torch.castsShadow
            }
        })
    }
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
    return `${world.weaponStance}:${playerEquipmentKey(world.playerSettings.equipment)}`
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

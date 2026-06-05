import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, query } from 'bitecs'
import { Euler, Mesh, MeshBasicMaterial, PointLight, Quaternion, Scene, Vector3, type Object3D } from 'three'
import { BoxCollider, ClimbingLadder, Grounded, Health, Mana, MovingObject, Shield, Velocity } from '../src/engine/ecs/components'
import { computeLocomotionParams } from '../src/engine/anim/core'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { startMeleeAttack } from '../src/engine/ecs/melee-combat'
import { MELEE_ATTACK_DEFS } from '../src/engine/ecs/melee-types'
import { createMeleeAttackSystem } from '../src/engine/ecs/systems/melee-attack-system'
import { createMeleeCombatSystem } from '../src/engine/ecs/systems/melee-combat-system'
import { createPlayerControlSystem } from '../src/engine/ecs/systems/player-control-system'
import { createProjectileLaunchSystem } from '../src/engine/ecs/systems/projectile-launch-system'
import { createGameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { PLAYER_TORCH_FLAME, PLAYER_TORCH_LIGHT } from '../src/game/assets'
import { MAIN_CHARACTER_COLLIDER_HEIGHT, MAIN_CHARACTER_COLLIDER_RADIUS, MAIN_CHARACTER_JOINTS } from '../src/game/assets/main-character'
import { MovingObjectKind } from '../src/game/moving-objects'
import { createPlayerTorchSystem } from '../src/game/player-torch-system'
import { createPlayerShieldSystem } from '../src/game/player-shield-system'
import {
    BOOT_EQUIPMENT_KINDS,
    HEAD_EQUIPMENT_KINDS,
    HAMMER_EQUIPMENT_KINDS,
    STAFF_EQUIPMENT_KINDS,
    createEquipment,
    equipmentSocketFrame,
    isHammerEquipmentKind,
    isStaffEquipmentKind,
} from '../src/game/anim/equipment'
import { HIGH_JUMP_BOOTS_ITEM_ID, HIGH_SPEED_BOOTS_ITEM_ID } from '../src/game/high-jump-boots'
import { SNIPER_HAT_ITEM_ID, SPEAR_ITEM_ID } from '../src/game/equipment-items'
import {
    HIGH_SPEED_BOOTS_MOVE_SPEED_BONUS,
    RANGER_HAT_ARROW_LIFT_BONUS,
    RANGER_HAT_ARROW_SPEED_BONUS,
} from '../src/game/equipment-effects'
import { HUMANOID_ANIM_TIMINGS } from '../src/game/anim/clip-timings'
import { partCharacterClips } from '../src/game/anim/part-clips'
import {
    PLAYER_MODEL_KIND_USER_DATA,
    applyWeaponStance,
    readPlayerVitals,
    spawnPlayer,
    syncPlayerHeldTorchVisibility,
    syncPlayerVisuals,
} from '../src/game/player'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, normalizePlayerSettings } from '../src/game/player-settings'
import { registerRuntimeNpcs } from '../src/game/npcs/npc-runtime'
import { normalizeNpcConfig } from '../src/game/npcs/npc-types'
import { NPC_TARGET_PLAYER } from '../src/game/npcs/npc-ai'
import {
    createSniperHatTrajectorySystem,
    predictSniperArrowTrajectory,
    sniperTrajectoryPreviewEnabled,
} from '../src/game/sniper-hat-trajectory-system'
import { __resetDebugInfoCache, setDebugInfoEnabled } from '../src/engine/render/render-settings'

function onePressAction(): ActionMap {
    let pressed = true
    return {
        consumePressed() {
            const out = pressed
            pressed = false
            return out
        },
    } as unknown as ActionMap
}

function trackingPressAction(): { actions: ActionMap; calls: () => number } {
    let calls = 0
    return {
        actions: {
            consumePressed() {
                calls++
                return true
            },
        } as unknown as ActionMap,
        calls: () => calls,
    }
}

function heldAction(initialHeld: boolean): { actions: ActionMap; setHeld: (held: boolean) => void } {
    let held = initialHeld
    return {
        actions: {
            isHeld() {
                return held
            },
        } as unknown as ActionMap,
        setHeld(next) {
            held = next
        },
    }
}

function queuedPressAction(count: number): ActionMap {
    return {
        consumePressed() {
            if (count <= 0) return null
            count--
            return { actionId: 'weapon.attack', phase: 'pressed', source: 'player', key: 'test', timeMs: 0 }
        },
    } as unknown as ActionMap
}

test('projectile launch consumes starting arrow inventory and spawns an arrow', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.inventory.arrows = 2
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)

    createProjectileLaunchSystem(onePressAction()).update(world, 1 / 60)

    assert.equal(world.inventory.arrows, 1)
    assert.equal(world.playerSettings.inventory.arrows, 1)
    const arrows = query(world, [MovingObject]).filter((eid) => MovingObject.kind[eid] === MovingObjectKind.Arrow)
    assert.equal(arrows.length, 1)
})

test('ranger hat shoots arrows farther by increasing launch velocity', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.head = 'hat-ranger'
    world.inventory.arrows = 2
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)

    createProjectileLaunchSystem(onePressAction()).update(world, 1 / 60)

    const arrow = query(world, [MovingObject]).find((eid) => MovingObject.kind[eid] === MovingObjectKind.Arrow)
    assert.ok(arrow)
    assert.equal(Velocity.z[arrow!], DEFAULT_PLAYER_SETTINGS.arrowSpeed + RANGER_HAT_ARROW_SPEED_BONUS)
    assert.equal(Velocity.y[arrow!], DEFAULT_PLAYER_SETTINGS.arrowLift + RANGER_HAT_ARROW_LIFT_BONUS)
})

test('sniper hat enables trajectory preview and predicts NPC target-volume hit', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.head = SNIPER_HAT_ITEM_ID
    world.weaponStance = 'ranged'
    world.inventory.arrows = 1
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    registerRuntimeNpcs(world, [
        normalizeNpcConfig({ id: 'target', model: 'keeper', position: { x: 0, y: 1, z: 2.35 } }),
    ])

    assert.equal(sniperTrajectoryPreviewEnabled(world, player), true)
    const prediction = predictSniperArrowTrajectory(world, chunks, player)

    assert.equal(prediction.hit?.kind, 'npc')
    assert.ok(prediction.points.length > 2)
    assert.ok(Math.abs(prediction.hit.position.z - 2.0) < 0.6)

    world.inventory.arrows = 0
    assert.equal(sniperTrajectoryPreviewEnabled(world, player), false)
})

test('sniper hat trajectory prediction marks first terrain hit point', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 1, 4, BLOCK.stone)
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.head = SNIPER_HAT_ITEM_ID
    world.weaponStance = 'ranged'
    world.inventory.arrows = 1
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)

    const prediction = predictSniperArrowTrajectory(world, chunks, player)

    assert.equal(prediction.hit?.kind, 'voxel')
    assert.ok(prediction.hit.position.z >= 4 && prediction.hit.position.z <= 4.1)
})

test('sniper hat trajectory renderer uses overlay line and dots that do not frustum cull', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const scene = new Scene()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.head = SNIPER_HAT_ITEM_ID
    world.weaponStance = 'ranged'
    world.inventory.arrows = 1
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)

    const system = createSniperHatTrajectorySystem(scene, chunks)
    system.init?.(world)
    system.update(world, 1 / 60)

    const root = findObjectByName(scene, 'SniperHatTrajectoryPreview')
    const line = findObjectByName(scene, 'SniperHatTrajectoryLine')
    const dots = findObjectByName(scene, 'SniperHatTrajectoryDots')
    assert.ok(root?.visible)
    assert.ok(line)
    assert.ok(dots)
    assert.equal(line.frustumCulled, false)
    assert.equal(dots.frustumCulled, false)
    assert.ok(line.renderOrder > 0)
    assert.ok(dots.renderOrder > line.renderOrder)

    system.dispose?.()
})

test('spawnPlayer restores carried health and mana snapshots for location travel', () => {
    const departingWorld = createGameWorld()
    const departingPlayer = spawnPlayer(departingWorld, {
        spawn: { x: 0, y: 1, z: 0 },
        settings: departingWorld.playerSettings,
    })
    Health.max[departingPlayer] = 7
    Health.current[departingPlayer] = 3
    Mana.max[departingPlayer] = 8
    Mana.current[departingPlayer] = 5

    const carried = readPlayerVitals(departingWorld)
    assert.ok(carried)

    const arrivingWorld = createGameWorld()
    const arrivingPlayer = spawnPlayer(arrivingWorld, {
        spawn: { x: 8, y: 2, z: 8 },
        settings: arrivingWorld.playerSettings,
        vitals: carried,
    })

    assert.equal(Health.max[arrivingPlayer], 7)
    assert.equal(Health.current[arrivingPlayer], 3)
    assert.equal(Mana.max[arrivingPlayer], 8)
    assert.equal(Mana.current[arrivingPlayer], 5)
})

test('high speed boots increase player control base speed', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.boots = HIGH_SPEED_BOOTS_ITEM_ID
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const actions = {
        isHeld: (id: string) => id === 'move.forward',
        hasBufferedPress: () => false,
        consumePressed: () => null,
    } as unknown as ActionMap
    const input = { getPointer: () => null } as never
    const iso = {
        camera: {},
        getPanForward(out: Vector3) { return out.set(0, 0, -1) },
        getPanRight(out: Vector3) { return out.set(1, 0, 0) },
    } as never

    createPlayerControlSystem(input, actions, iso, { accel: 1000 }).update(world, 1 / 60)

    assert.ok(Velocity.z[player]! > DEFAULT_PLAYER_SETTINGS.moveSpeed)
    assert.ok(Velocity.z[player]! <= DEFAULT_PLAYER_SETTINGS.moveSpeed + HIGH_SPEED_BOOTS_MOVE_SPEED_BONUS)
})

test('projectile launch respects disabled bow ability', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.abilities.bow = false
    world.inventory.arrows = 2
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)

    createProjectileLaunchSystem(onePressAction()).update(world, 1 / 60)

    assert.equal(world.inventory.arrows, 2)
    const arrows = query(world, [MovingObject]).filter((eid) => MovingObject.kind[eid] === MovingObjectKind.Arrow)
    assert.equal(arrows.length, 0)
})

test('projectile launch requires grounded state before consuming shot input', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.inventory.arrows = 2
    spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const input = trackingPressAction()

    createProjectileLaunchSystem(input.actions).update(world, 1 / 60)

    assert.equal(input.calls(), 0)
    assert.equal(world.inventory.arrows, 2)
    const arrows = query(world, [MovingObject]).filter((eid) => MovingObject.kind[eid] === MovingObjectKind.Arrow)
    assert.equal(arrows.length, 0)
})

test('player settings normalization keeps saved/script booleans boolean', () => {
    const settings = normalizePlayerSettings({
        abilities: {
            bow: 'false',
            airPush: '1',
        },
        torch: {
            castsShadow: '0',
        },
    } as never)

    assert.equal(settings.abilities.bow, false)
    assert.equal(settings.abilities.airPush, true)
    assert.equal(settings.torch.castsShadow, false)
})

test('player equipment settings normalize, copy, and drive visible hand loadouts', () => {
    const settings = normalizePlayerSettings({
        equipment: {
            head: 'hat-ranger',
            boots: HIGH_JUMP_BOOTS_ITEM_ID,
            melee: { handR: 'staff-lantern', handL: 'book' },
            ranged: { handR: 'bogus', handL: 'bow' },
            magic: { handR: 'staff-crystal' },
        },
    } as never)

    assert.equal(settings.equipment.head, 'hat-ranger')
    assert.equal(settings.equipment.boots, HIGH_JUMP_BOOTS_ITEM_ID)
    assert.deepEqual(settings.equipment.melee, { handR: 'staff-lantern', handL: 'book' })
    assert.deepEqual(settings.equipment.ranged, { handR: 'arrow', handL: 'bow' })
    assert.deepEqual(settings.equipment.magic, { handR: 'staff-crystal', handL: null })

    const copied = copyPlayerSettings(settings)
    copied.equipment.head = 'hat-sun'
    copied.equipment.boots = null
    copied.equipment.melee.handR = 'sword'
    assert.equal(settings.equipment.head, 'hat-ranger')
    assert.equal(settings.equipment.boots, HIGH_JUMP_BOOTS_ITEM_ID)
    assert.equal(settings.equipment.melee.handR, 'staff-lantern')

    const world = createGameWorld()
    world.playerSettings = settings
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings })
    const root = world.object3DByEid.get(eid)!
    assert.ok(findObjectByName(root, 'equip:hat-ranger'))
    assert.equal(countObjectsByName(root, 'equip:high-jump-boots'), 2)
    assert.ok(findObjectByName(root, 'equip:staff-lantern'))
    assert.ok(findObjectByName(root, 'equip:book'))

    world.weaponStance = 'ranged'
    applyWeaponStance(world, eid, 'ranged')
    assert.equal(findObjectByName(root, 'equip:staff-lantern'), null)
    assert.ok(findObjectByName(root, 'equip:bow'))
    assert.ok(findObjectByName(root, 'equip:arrow'))
})

test('spawned player collider matches the slimmer animated body hitbox', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: DEFAULT_PLAYER_SETTINGS })

    assert.ok(Math.abs(BoxCollider.x[player]! - MAIN_CHARACTER_COLLIDER_RADIUS) < 1e-5)
    assert.ok(Math.abs(BoxCollider.z[player]! - MAIN_CHARACTER_COLLIDER_RADIUS) < 1e-5)
    assert.ok(Math.abs(BoxCollider.y[player]! * 2 - MAIN_CHARACTER_COLLIDER_HEIGHT) < 1e-5)
    assert.ok(BoxCollider.x[player]! < 0.35, 'player collider radius should be slimmer than the old broad body box')
    assert.ok(BoxCollider.y[player]! * 2 < 1.6, 'player collider height should sit slightly below the old full-height box')
})

test('syncPlayerVisuals applies live equipment changes without model swaps', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!

    assert.ok(findObjectByName(root, 'equip:hat'))
    assert.ok(findObjectByName(root, 'equip:sword'))
    world.playerSettings.equipment.head = 'hat-sun'
    world.playerSettings.equipment.boots = HIGH_JUMP_BOOTS_ITEM_ID
    world.playerSettings.equipment.melee = { handR: 'staff-crystal', handL: null }
    syncPlayerVisuals(world)

    assert.equal(findObjectByName(root, 'equip:hat'), null)
    assert.ok(findObjectByName(root, 'equip:hat-sun'))
    assert.equal(findObjectByName(root, 'equip:sword'), null)
    assert.ok(findObjectByName(root, 'equip:staff-crystal'))
    assert.equal(countObjectsByName(root, 'equip:high-jump-boots'), 2)

    world.playerSettings.equipment.boots = null
    syncPlayerVisuals(world)
    assert.equal(countObjectsByName(root, 'equip:high-jump-boots'), 0)
})

test('weapon stance shows bow and quiver only in ranged mode', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!
    const backBow = findObjectByName(root, 'BackBow')
    const backQuiver = findObjectByName(root, 'BackQuiver')

    assert.ok(backBow)
    assert.ok(backQuiver)
    assert.equal(backBow.visible, false)
    assert.equal(backQuiver.visible, false)
    assert.equal(findObjectByName(root, 'equip:bow'), null)

    world.weaponStance = 'ranged'
    applyWeaponStance(world, eid, 'ranged')
    assert.equal(backBow.visible, false, 'ranged hand bow should not duplicate on the back')
    assert.equal(backQuiver.visible, true)
    assert.ok(findObjectByName(root, 'equip:bow'))
    assert.ok(findObjectByName(root, 'equip:arrow'))

    world.weaponStance = 'magic'
    applyWeaponStance(world, eid, 'magic')
    assert.equal(backBow.visible, false)
    assert.equal(backQuiver.visible, false)
    assert.equal(findObjectByName(root, 'equip:bow'), null)
    assert.equal(findObjectByName(root, 'equip:arrow'), null)
})

test('all head equipment variants build distinct hat models', () => {
    const childCounts = new Set<number>()
    for (const kind of HEAD_EQUIPMENT_KINDS) {
        const item = createEquipment(kind)
        assert.equal(item.name, `equip:${kind}`)
        assert.ok(item.children.length >= 5, `${kind} should contain enough shapes to read as a designed hat`)
        childCounts.add(item.children.length)
        const frame = equipmentSocketFrame(kind, 'head')
        assert.ok((frame.offset?.[1] ?? 1) < 0, `${kind} should sit down onto the head socket`)
    }
    assert.ok(findObjectByName(createEquipment(SNIPER_HAT_ITEM_ID), 'SniperHatLens'))
    assert.ok(childCounts.size > 1, 'hat variants should not all share the same silhouette complexity')
})

test('all staff equipment variants build selectable staff models', () => {
    for (const kind of STAFF_EQUIPMENT_KINDS) {
        const item = createEquipment(kind)
        assert.equal(item.name, `equip:${kind}`)
        assert.equal(isStaffEquipmentKind(kind), true)
        assert.ok(item.children.length >= 5, `${kind} should contain enough shapes to read as a designed staff`)
        const frame = equipmentSocketFrame(kind, 'handR')
        assert.ok((frame.offset?.[1] ?? 0) < -0.3, `${kind} should sit low enough to read as a staff`)
    }
    assert.ok(findObjectByName(createEquipment('staff-lantern'), 'LanternStaffGlow'))
    assert.ok(findObjectByName(createEquipment('staff'), 'StaffHeavyHead'))
    assert.ok(findObjectByName(createEquipment('staff-crystal'), 'CrystalStaffCrystal'))
})

test('battle hammer builds as a selectable heavy hand item', () => {
    for (const kind of HAMMER_EQUIPMENT_KINDS) {
        const item = createEquipment(kind)
        assert.equal(item.name, `equip:${kind}`)
        assert.equal(isHammerEquipmentKind(kind), true)
        assert.ok(findObjectByName(item, 'BattleHammerHead'), `${kind} should have a heavy hammer head`)
        assert.ok(findObjectByName(item, 'BattleHammerTopSpike'), `${kind} should keep a pointy silhouette`)
        const frame = equipmentSocketFrame(kind, 'handR')
        const carriedAxis = new Vector3(0, 1, 0).applyEuler(toEuler(frame.orient))
        assert.ok(Math.abs(carriedAxis.y) < 0.12, `${kind} should be carried horizontally`)
        assert.ok(carriedAxis.z > 0.9, `${kind} heavy head should point forward while carried`)
        assert.ok(Math.abs(frame.offset?.[1] ?? 1) < 0.12, `${kind} grip should stay near hand height`)
        assert.ok((frame.offset?.[2] ?? 0) > 0.12, `${kind} should be carried forward of the wrist`)
    }
})

test('boots build as selectable foot equipment', () => {
    for (const kind of BOOT_EQUIPMENT_KINDS) {
        const item = createEquipment(kind)
        assert.equal(item.name, `equip:${kind}`)
        if (kind === HIGH_JUMP_BOOTS_ITEM_ID) {
            assert.ok(findObjectByName(item, 'HighJumpBootSpring'), `${kind} should show a spring-assisted silhouette`)
            assert.ok(findObjectByName(item, 'HighJumpBootGlow'), `${kind} should show the high-jump glow accent`)
        } else {
            assert.ok(findObjectByName(item, 'HighSpeedBootWingL'), `${kind} should show a speed wing silhouette`)
            assert.ok(findObjectByName(item, 'HighSpeedBootGlow'), `${kind} should show the speed glow accent`)
        }
        assert.deepEqual(equipmentSocketFrame(kind, 'footL').offset, [0, 0, 0])
        assert.deepEqual(equipmentSocketFrame(kind, 'footR').offset, [0, 0, 0])
    }
})

test('player beard setting normalizes and rebuilds the procedural model', () => {
    assert.equal(DEFAULT_PLAYER_SETTINGS.beard, 'none')
    assert.equal(normalizePlayerSettings({ beard: 'pointed' }).beard, 'pointed')
    assert.equal(normalizePlayerSettings({ beard: 'bogus' } as never).beard, 'none')

    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!

    assert.equal(findObjectByName(root, 'CharacterBeardFull'), null)
    world.playerSettings.beard = 'full'
    syncPlayerVisuals(world)
    assert.ok(findObjectByName(root, 'CharacterBeardFull'))
})

test('melee attack alternates thrust and wide swing animations', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    const controller = world.animControllerByEid.get(player)!
    const idleParams = computeLocomotionParams({ speedXZ: 0, vy: 0, grounded: true, blocked: false, movementState: 0 })
    const system = createMeleeAttackSystem(queuedPressAction(2))
    const combat = createMeleeCombatSystem()

    system.update(world, 1 / 60)
    combat.update(world, 1 / 60)
    controller.setParams(idleParams)
    controller.update(0.05)
    assert.equal(controller.machine.currentStateId, 'attack')

    for (let i = 0; i < 12; i++) {
        combat.update(world, 0.05)
        controller.setParams(idleParams)
        controller.update(0.05)
    }
    assert.equal(controller.machine.currentStateId, 'idle')

    system.update(world, 0.6)
    controller.setParams(idleParams)
    controller.update(0.05)
    assert.equal(controller.machine.currentStateId, 'attackWide')
})

test('empty melee loadout cannot start a player melee attack', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.melee = { handR: null, handL: null }
    world.weaponStance = 'melee'
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    const system = createMeleeAttackSystem(onePressAction())

    system.update(world, 1 / 60)

    assert.equal(world.meleeAttacks.size, 0)
    assert.ok(world.log.includes('No melee weapon equipped.'))
})

test('staff melee variants use the custom staff bonk animation', () => {
    for (const kind of STAFF_EQUIPMENT_KINDS) {
        const world = createGameWorld()
        world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
        world.playerSettings.equipment.melee = { handR: kind, handL: null }
        world.weaponStance = 'melee'
        const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
        addComponent(world, player, Grounded)
        const controller = world.animControllerByEid.get(player)!
        const idleParams = computeLocomotionParams({ speedXZ: 0, vy: 0, grounded: true, blocked: false, movementState: 0 })
        const system = createMeleeAttackSystem(onePressAction())

        system.update(world, 1 / 60)
        controller.setParams(idleParams)
        controller.update(0.05)

        assert.equal(controller.machine.currentStateId, 'staffAttack', `${kind} should trigger the staff attack`)
    }
})

test('spear melee uses a longer narrow thrust without alternating to wide swing', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.melee = { handR: SPEAR_ITEM_ID, handL: 'shield' }
    world.weaponStance = 'melee'
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    const controller = world.animControllerByEid.get(player)!
    const idleParams = computeLocomotionParams({ speedXZ: 0, vy: 0, grounded: true, blocked: false, movementState: 0 })
    const system = createMeleeAttackSystem(onePressAction())

    system.update(world, 1 / 60)
    controller.setParams(idleParams)
    controller.update(0.05)

    const attack = Array.from(world.meleeAttacks.values())[0]
    assert.ok(attack, 'spear should schedule a melee attack')
    assert.equal(attack!.def.id, 'player-spear-thrust')
    assert.equal(attack!.def.targetMode, 'nearest')
    assert.equal(attack!.def.shape.kind, 'wedge')
    if (attack!.def.shape.kind === 'wedge') {
        assert.ok(attack!.def.shape.range > 2.75, 'spear should reach farther than sword thrust')
        assert.ok(attack!.def.shape.arcRadians < 1.4, 'spear should keep a narrow thrust cone')
    }
    assert.equal(controller.machine.currentStateId, 'spearAttack')
})

test('spear builds as a selectable long hand item', () => {
    const item = createEquipment(SPEAR_ITEM_ID)
    assert.equal(item.name, `equip:${SPEAR_ITEM_ID}`)
    assert.ok(findObjectByName(item, 'SpearHead'))
    assert.ok(findObjectByName(item, 'SpearShaft'))
    assert.ok(findObjectByName(item, 'SpearButtSpike'))
    assert.ok(item.children.length <= 7, 'spear should stay a cheap low-part equipment model')
    const frame = equipmentSocketFrame(SPEAR_ITEM_ID, 'handR')
    const spearDir = new Vector3(0, 1, 0).applyEuler(toEuler(frame.orient))
    assert.ok(spearDir.z > 0.96, 'right-hand spear should point forward')
    assert.ok((frame.offset?.[2] ?? 0) > 0.14, 'spear grip should sit forward of the wrist')
    assert.ok((frame.offset?.[2] ?? 0) < 0.19, 'spear grip should stay close to the wrist')
    assert.ok(Math.abs(frame.offset?.[1] ?? 0) < 0.15, 'spear grip should sit near the socket hand')
})

test('held shield action drives the shield block animation while grounded', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.weaponStance = 'melee'
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    const controller = world.animControllerByEid.get(player)!
    const idleParams = computeLocomotionParams({ speedXZ: 0, vy: 0, grounded: true, blocked: false, movementState: 0 })
    const action = heldAction(true)
    const system = createPlayerShieldSystem(action.actions)

    system.update(world, 1 / 60)
    controller.setParams(idleParams)
    controller.update(0.05)
    assert.equal(controller.machine.currentStateId, 'shieldBlock')

    action.setHeld(false)
    system.update(world, 1 / 60)
    controller.setParams(idleParams)
    controller.update(0.1)
    assert.equal(controller.machine.currentStateId, 'idle')
})

test('passive shield guard uses the left-side yaw offset', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.weaponStance = 'melee'
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    const action = heldAction(false)
    const system = createPlayerShieldSystem(action.actions)

    system.update(world, 1 / 60)

    assert.equal(Shield.raised[player], 1)
    assert.ok(Shield.blockYawOffset[player]! < 0, 'passive shield should cover the left side, not the right')
})

test('empty melee shield loadout suppresses shield guard and debug wedge', () => {
    __resetDebugInfoCache()
    setDebugInfoEnabled(true)
    try {
        const world = createGameWorld()
        world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
        world.playerSettings.equipment.melee = { handR: null, handL: null }
        world.weaponStance = 'melee'
        const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
        addComponent(world, player, Grounded)
        const action = heldAction(true)
        const system = createPlayerShieldSystem(action.actions)

        system.update(world, 1 / 60)

        assert.equal(Shield.raised[player], 0)
        assert.equal(Shield.perfect[player], 0)
        assert.equal(
            world.debugHitboxes.some((hitbox) => hitbox.id === `player:${player}:shield`),
            false,
            'debug shield wedge should not render without an equipped shield',
        )
    } finally {
        setDebugInfoEnabled(false)
        __resetDebugInfoCache()
    }
})

test('empty melee shield loadout cannot block an incoming melee hit', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.equipment.melee = { handR: null, handL: null }
    world.weaponStance = 'melee'
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    registerRuntimeNpcs(world, [
        normalizeNpcConfig({ id: 'guard', model: 'keeper', position: { x: 0, y: 1, z: 1 } }),
    ])
    const guard = world.npcRuntimeById.get('guard')!
    guard.yaw = Math.PI
    const shield = createPlayerShieldSystem(heldAction(true).actions)
    const combat = createMeleeCombatSystem()

    shield.update(world, 1 / 60)
    assert.equal(Shield.raised[player], 0)
    assert.equal(startMeleeAttack(
        world,
        { kind: 'npc', id: 'guard' },
        MELEE_ATTACK_DEFS['npc-slash'],
        { targetId: NPC_TARGET_PLAYER },
    ), true)

    combat.update(world, MELEE_ATTACK_DEFS['npc-slash'].startupSeconds + 0.02)

    assert.equal(Health.current[player], Health.max[player] - 1)
})

test('climbing ladder suppresses player shield guard', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.weaponStance = 'melee'
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    addComponent(world, player, ClimbingLadder)
    const action = heldAction(true)
    const system = createPlayerShieldSystem(action.actions)

    system.update(world, 1 / 60)

    assert.equal(Shield.raised[player], 0)
    assert.equal(Shield.perfect[player], 0)
})

test('front shield uses a short perfect window and reload disables guard', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.weaponStance = 'melee'
    const player = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    addComponent(world, player, Grounded)
    const action = heldAction(true)
    const system = createPlayerShieldSystem(action.actions)

    system.update(world, 0.10)
    assert.equal(Shield.raised[player], 1)
    assert.equal(Shield.perfect[player], 1)

    system.update(world, 0.13)
    assert.equal(Shield.raised[player], 1)
    assert.equal(Shield.perfect[player], 0)

    Shield.reloadSeconds[player] = 0.55
    system.update(world, 0.10)
    assert.equal(Shield.raised[player], 0)
    assert.ok(Shield.reloadSeconds[player]! > 0)

    system.update(world, 0.50)
    assert.equal(Shield.raised[player], 1)
    assert.equal(Shield.perfect[player], 0, 'holding through reload should not recreate a perfect block')
})

test('default hand equipment frames point sword forward, nock arrow, keep shield on the hand, and ground the staff', () => {
    const sword = equipmentSocketFrame('sword', 'handR')
    const shield = equipmentSocketFrame('shield', 'handL')
    const arrow = equipmentSocketFrame('arrow', 'handR')
    const staff = equipmentSocketFrame('staff', 'handR')

    const bladeDir = new Vector3(0, 1, 0).applyEuler(toEuler(sword.orient))
    assert.ok(bladeDir.z > 0.9, 'right-hand sword should point toward the character front')
    assert.ok(bladeDir.y > 0.03, 'right-hand sword should keep a slight upward lift')

    const drawChestPose = new Euler(0.015, 0.52, -0.02, 'XYZ')
    const drawArmPose = new Euler(-1.26, 0.85, -0.5, 'XYZ')
    const arrowDirAtDraw = new Vector3(0, 1, 0)
        .applyEuler(toEuler(arrow.orient))
        .applyEuler(drawArmPose)
        .applyEuler(drawChestPose)
    assert.ok(arrowDirAtDraw.z > 0.96, 'right-hand arrow should point toward the character front at full draw')
    assert.ok(Math.abs(arrowDirAtDraw.x) < 0.08, 'right-hand arrow should not point sideways at full draw')
    assert.ok(Math.abs(arrowDirAtDraw.y) < 0.08, 'right-hand arrow should stay level at full draw')
    assert.ok(Math.abs(arrow.offset?.[0] ?? 1) < 0.04, 'right-hand arrow nock should stay close to the fingers')

    const shieldNormal = new Vector3(0, 0, 1).applyEuler(toEuler(shield.orient))
    assert.ok(shieldNormal.x < -0.85, 'left-hand shield should guard the left side')
    assert.ok(shieldNormal.z > 0.1, 'left-hand shield should stay slightly readable from the front')
    assert.ok(Math.abs((shield.offset?.[0] ?? 0)) < 0.16, 'shield grip should stay close enough to touch the hand')

    assert.ok((staff.offset?.[1] ?? 0) < -0.35, 'staff grip should sit low enough that the base reaches near the floor')
    assert.ok((staff.offset?.[2] ?? 0) > 0.04, 'staff should be carried slightly forward of the wrist')
    const staffIdleDir = new Vector3(0, 1, 0).applyEuler(toEuler(staff.orient))
    assert.ok(staffIdleDir.y > 0.85, 'staff should still read as an upright staff in idle carry')
    assert.ok(staffIdleDir.z > 0.35, 'staff weighted head should lean forward in idle carry')

    const staffModel = createEquipment('staff')
    assert.ok(findObjectByName(staffModel, 'StaffHeavyHead'), 'staff should have a heavy striking head')
    assert.ok(findObjectByName(staffModel, 'StaffSpike'), 'staff should have a pointy striking tip')
})

test('shield block pose brings the shield in front of the body', () => {
    const shield = equipmentSocketFrame('shield', 'handL')
    const clip = partCharacterClips().find((candidate) => candidate.name === 'shieldBlock')
    assert.ok(clip)

    const frontNormal = new Vector3(0, 0, 1)
        .applyEuler(toEuler(shield.orient))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'UpperArmL')!, 0.44))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'Chest')!, 0.44))

    assert.ok(frontNormal.z > 0.8, 'raised shield should face mostly forward')
    assert.ok(Math.abs(frontNormal.x) < 0.5, 'raised shield should leave the passive side-guard pose')

    const heldNormal = new Vector3(0, 0, 1)
        .applyEuler(toEuler(shield.orient))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'UpperArmL')!, HUMANOID_ANIM_TIMINGS.shieldBlock))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'Chest')!, HUMANOID_ANIM_TIMINGS.shieldBlock))
    assert.ok(heldNormal.z > 0.8, 'clamped shield block should hold the front guard pose')
    assert.ok(Math.abs(heldNormal.x) < 0.5, 'clamped shield block should not loop back to side guard')
})

test('staff attack impact drives the pointy head forward and downward', () => {
    const staff = equipmentSocketFrame('staff', 'handR')
    const clip = partCharacterClips().find((candidate) => candidate.name === 'staffAttack')
    assert.ok(clip)

    const staffHeadDir = new Vector3(0, 1, 0)
        .applyEuler(toEuler(staff.orient))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'UpperArmR')!, 0.34))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'Chest')!, 0.34))

    assert.ok(staffHeadDir.z > 0.72, 'staff head should point into the enemy at impact')
    assert.ok(staffHeadDir.y < -0.3, 'staff head should drive downward at impact')
})

test('spear attack impact keeps the point in a tight forward thrust', () => {
    const spear = equipmentSocketFrame(SPEAR_ITEM_ID, 'handR')
    const clip = partCharacterClips().find((candidate) => candidate.name === 'spearAttack')
    assert.ok(clip)

    const startHand = rightHandSocketPositionAt(clip!, 0)
    const anticipationHand = rightHandSocketPositionAt(clip!, 0.22)
    const impactHand = rightHandSocketPositionAt(clip!, HUMANOID_ANIM_TIMINGS.spearImpact)
    assert.ok(anticipationHand.z < startHand.z - 0.38, 'spear anticipation should pull the weapon hand far behind the body')
    assert.ok(impactHand.z > startHand.z + 0.12, 'spear impact should reach past the starting hand line')
    assert.ok(impactHand.z > anticipationHand.z + 0.54, 'spear impact should thrust the weapon hand far forward')

    const spearHeadDir = new Vector3(0, 1, 0)
        .applyEuler(toEuler(spear.orient))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'UpperArmR')!, HUMANOID_ANIM_TIMINGS.spearImpact))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'Chest')!, HUMANOID_ANIM_TIMINGS.spearImpact))

    assert.ok(spearHeadDir.z > 0.95, 'spear point should drive straight into the target at impact')
    assert.ok(Math.abs(spearHeadDir.x) < 0.16, 'spear thrust should not drift sideways at impact')
    assert.ok(Math.abs(spearHeadDir.y) < 0.24, 'spear thrust should stay nearly level at impact')
})

test('hammer attack drives the hammer head down into the ground circle', () => {
    const hammer = equipmentSocketFrame('battle-hammer', 'handR')
    const clip = partCharacterClips().find((candidate) => candidate.name === 'hammerAttack')
    assert.ok(clip)

    const carriedAxis = new Vector3(0, 1, 0).applyEuler(toEuler(hammer.orient))
    assert.ok(Math.abs(carriedAxis.y) < 0.12, 'hammer should be held horizontally before the strike')
    assert.ok(carriedAxis.z > 0.9, 'hammer head should point forward in the carried pose')

    const windupDir = new Vector3(0, 1, 0)
        .applyEuler(toEuler(hammer.orient))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'UpperArmR')!, 0.3))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'Chest')!, 0.3))
    assert.ok(windupDir.y > 0.45, 'hammer wind-up should lift the head upward')

    const hammerHeadDir = new Vector3(0, 1, 0)
        .applyEuler(toEuler(hammer.orient))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'UpperArmR')!, HUMANOID_ANIM_TIMINGS.hammerImpact))
        .applyQuaternion(quaternionAt(clip!.tracks.find((track) => track.target === 'Chest')!, HUMANOID_ANIM_TIMINGS.hammerImpact))

    assert.ok(hammerHeadDir.z > 0.35, 'hammer head should land in front of the character')
    assert.ok(hammerHeadDir.y < -0.85, 'hammer head should drive sharply downward at impact')
})

function toEuler(value: readonly [number, number, number] | undefined): Euler {
    return new Euler(value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0, 'XYZ')
}

function quaternionAt(
    track: { times: number[]; values: number[] },
    time: number,
): Quaternion {
    const index = track.times.findIndex((candidate) => Math.abs(candidate - time) < 1e-6)
    assert.notEqual(index, -1, `missing key at ${time}`)
    const offset = index * 4
    return new Quaternion(
        track.values[offset]!,
        track.values[offset + 1]!,
        track.values[offset + 2]!,
        track.values[offset + 3]!,
    )
}

function rightHandSocketPositionAt(
    clip: { tracks: Array<{ target: string; times: number[]; values: number[] }> },
    time: number,
): Vector3 {
    const shoulder = new Vector3(
        MAIN_CHARACTER_JOINTS.armX,
        MAIN_CHARACTER_JOINTS.shoulderY - MAIN_CHARACTER_JOINTS.chestY,
        MAIN_CHARACTER_JOINTS.armZ,
    )
    const hand = new Vector3(0, MAIN_CHARACTER_JOINTS.handY, 0)
        .applyQuaternion(quaternionAt(clip.tracks.find((track) => track.target === 'UpperArmR')!, time))
    return shoulder.add(hand)
        .applyQuaternion(quaternionAt(clip.tracks.find((track) => track.target === 'Chest')!, time))
}

test('indoorCutEnabled defaults on and round-trips through normalization', () => {
    assert.equal(DEFAULT_PLAYER_SETTINGS.indoorCutEnabled, true)
    // Absent in old saves → defaults on.
    assert.equal(normalizePlayerSettings({}).indoorCutEnabled, true)
    // Explicit (incl. coerced string from a script/save) is respected.
    assert.equal(normalizePlayerSettings({ indoorCutEnabled: false }).indoorCutEnabled, false)
    assert.equal(normalizePlayerSettings({ indoorCutEnabled: 'off' } as never).indoorCutEnabled, false)
    assert.equal(copyPlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, indoorCutEnabled: false }).indoorCutEnabled, false)
})

test('indoorCutMode defaults to corridor and rejects unknown values', () => {
    assert.equal(DEFAULT_PLAYER_SETTINGS.indoorCutMode, 'corridor')
    assert.equal(normalizePlayerSettings({}).indoorCutMode, 'corridor')
    assert.equal(normalizePlayerSettings({ indoorCutMode: 'ybox' }).indoorCutMode, 'ybox')
    assert.equal(normalizePlayerSettings({ indoorCutMode: 'bogus' } as never).indoorCutMode, 'corridor')
})

test('syncPlayerVisuals applies live script model changes', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!

    assert.equal(root.children.some((child) => child.userData[PLAYER_MODEL_KIND_USER_DATA] === 'player'), true)
    world.playerSettings.model = 'keeper'
    syncPlayerVisuals(world)

    assert.equal(root.children.some((child) => child.userData[PLAYER_MODEL_KIND_USER_DATA] === 'keeper'), true)
    assert.equal(root.children.some((child) => child.userData[PLAYER_MODEL_KIND_USER_DATA] === 'player'), false)
})

test('player torch system does not animate shared flame material opacity', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!
    const flameMaterial = findFirstPlayerTorchFlameMaterial(root)
    assert.ok(flameMaterial)
    const opacity = flameMaterial.opacity

    const system = createPlayerTorchSystem()
    system.init?.(world)
    system.update(world, 0.25)

    assert.equal(flameMaterial.opacity, opacity)
})

test('player torch system updates shadow camera range when distance changes', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.abilities.torch = true
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!
    const light = findPlayerTorchLight(root)
    assert.ok(light)

    world.playerSettings.torch.distance = 30
    const system = createPlayerTorchSystem()
    system.init?.(world)
    system.update(world, 0.25)

    assert.ok(light.shadow.camera.far >= 30)
})

test('player torch visibility follows the torch ability flag immediately', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.playerSettings.abilities.torch = false
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!
    const torch = findObjectByName(root, 'PlayerTorch')
    const light = findPlayerTorchLight(root)

    assert.ok(torch)
    assert.ok(light)
    assert.equal(torch.visible, false)
    assert.equal(light.visible, false)

    world.playerSettings.abilities.torch = true
    syncPlayerHeldTorchVisibility(world)
    assert.equal(torch.visible, true)
    assert.equal(light.visible, true)
})

function findFirstPlayerTorchFlameMaterial(root: Object3D): MeshBasicMaterial | null {
    let material: MeshBasicMaterial | null = null
    root.traverse((obj) => {
        if (material || !(obj instanceof Mesh) || !obj.userData[PLAYER_TORCH_FLAME]) return
        if (obj.material instanceof MeshBasicMaterial) material = obj.material
    })
    return material
}

function findPlayerTorchLight(root: Object3D): PointLight | null {
    let light: PointLight | null = null
    root.traverse((obj) => {
        if (!light && obj instanceof PointLight && obj.userData[PLAYER_TORCH_LIGHT]) light = obj
    })
    return light
}

function findObjectByName(root: Object3D, name: string): Object3D | null {
    let found: Object3D | null = null
    root.traverse((obj) => {
        if (!found && obj.name === name) found = obj
    })
    return found
}

function countObjectsByName(root: Object3D, name: string): number {
    let count = 0
    root.traverse((obj) => {
        if (obj.name === name) count++
    })
    return count
}

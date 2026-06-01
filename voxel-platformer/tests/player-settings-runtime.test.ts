import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, query } from 'bitecs'
import { Euler, Mesh, MeshBasicMaterial, PointLight, Quaternion, Vector3, type Object3D } from 'three'
import { BoxCollider, Grounded, MovingObject, Shield } from '../src/engine/ecs/components'
import { computeLocomotionParams } from '../src/engine/anim/core'
import { createMeleeAttackSystem } from '../src/engine/ecs/systems/melee-attack-system'
import { createProjectileLaunchSystem } from '../src/engine/ecs/systems/projectile-launch-system'
import { createGameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { PLAYER_TORCH_FLAME, PLAYER_TORCH_LIGHT } from '../src/game/assets'
import { MAIN_CHARACTER_COLLIDER_HEIGHT, MAIN_CHARACTER_COLLIDER_RADIUS } from '../src/game/assets/main-character'
import { MovingObjectKind } from '../src/game/moving-objects'
import { createPlayerTorchSystem } from '../src/game/player-torch-system'
import { createPlayerShieldSystem } from '../src/game/player-shield-system'
import {
    HEAD_EQUIPMENT_KINDS,
    HAMMER_EQUIPMENT_KINDS,
    STAFF_EQUIPMENT_KINDS,
    createEquipment,
    equipmentSocketFrame,
    isHammerEquipmentKind,
    isStaffEquipmentKind,
} from '../src/game/anim/equipment'
import { HUMANOID_ANIM_TIMINGS } from '../src/game/anim/clip-timings'
import { partCharacterClips } from '../src/game/anim/part-clips'
import {
    PLAYER_MODEL_KIND_USER_DATA,
    applyWeaponStance,
    spawnPlayer,
    syncPlayerHeldTorchVisibility,
    syncPlayerVisuals,
} from '../src/game/player'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, normalizePlayerSettings } from '../src/game/player-settings'

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
            melee: { handR: 'staff-lantern', handL: 'book' },
            ranged: { handR: 'bogus', handL: 'bow' },
            magic: { handR: 'staff-crystal' },
        },
    } as never)

    assert.equal(settings.equipment.head, 'hat-ranger')
    assert.deepEqual(settings.equipment.melee, { handR: 'staff-lantern', handL: 'book' })
    assert.deepEqual(settings.equipment.ranged, { handR: 'arrow', handL: 'bow' })
    assert.deepEqual(settings.equipment.magic, { handR: 'staff-crystal', handL: null })

    const copied = copyPlayerSettings(settings)
    copied.equipment.head = 'hat-sun'
    copied.equipment.melee.handR = 'sword'
    assert.equal(settings.equipment.head, 'hat-ranger')
    assert.equal(settings.equipment.melee.handR, 'staff-lantern')

    const world = createGameWorld()
    world.playerSettings = settings
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings })
    const root = world.object3DByEid.get(eid)!
    assert.ok(findObjectByName(root, 'equip:hat-ranger'))
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
    world.playerSettings.equipment.melee = { handR: 'staff-crystal', handL: null }
    syncPlayerVisuals(world)

    assert.equal(findObjectByName(root, 'equip:hat'), null)
    assert.ok(findObjectByName(root, 'equip:hat-sun'))
    assert.equal(findObjectByName(root, 'equip:sword'), null)
    assert.ok(findObjectByName(root, 'equip:staff-crystal'))
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

    system.update(world, 1 / 60)
    controller.setParams(idleParams)
    controller.update(0.05)
    assert.equal(controller.machine.currentStateId, 'attack')

    for (let i = 0; i < 12; i++) {
        controller.setParams(idleParams)
        controller.update(0.05)
    }
    assert.equal(controller.machine.currentStateId, 'idle')

    system.update(world, 0.6)
    controller.setParams(idleParams)
    controller.update(0.05)
    assert.equal(controller.machine.currentStateId, 'attackWide')
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

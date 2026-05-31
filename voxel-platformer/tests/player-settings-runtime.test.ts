import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, query } from 'bitecs'
import { Euler, Mesh, MeshBasicMaterial, PointLight, Vector3, type Object3D } from 'three'
import { Grounded, MovingObject } from '../src/engine/ecs/components'
import { computeLocomotionParams } from '../src/engine/anim/core'
import { createMeleeAttackSystem } from '../src/engine/ecs/systems/melee-attack-system'
import { createProjectileLaunchSystem } from '../src/engine/ecs/systems/projectile-launch-system'
import { createGameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { PLAYER_TORCH_FLAME, PLAYER_TORCH_LIGHT } from '../src/game/assets'
import { MovingObjectKind } from '../src/game/moving-objects'
import { createPlayerTorchSystem } from '../src/game/player-torch-system'
import { equipmentSocketFrame } from '../src/game/anim/equipment'
import { PLAYER_MODEL_KIND_USER_DATA, applyWeaponStance, spawnPlayer, syncPlayerVisuals } from '../src/game/player'
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
            melee: { handR: 'staff', handL: 'book' },
            ranged: { handR: 'bogus', handL: 'bow' },
        },
    } as never)

    assert.deepEqual(settings.equipment.melee, { handR: 'staff', handL: 'book' })
    assert.deepEqual(settings.equipment.ranged, { handR: 'arrow', handL: 'bow' })

    const copied = copyPlayerSettings(settings)
    copied.equipment.melee.handR = 'sword'
    assert.equal(settings.equipment.melee.handR, 'staff')

    const world = createGameWorld()
    world.playerSettings = settings
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings })
    const root = world.object3DByEid.get(eid)!
    assert.ok(findObjectByName(root, 'equip:staff'))
    assert.ok(findObjectByName(root, 'equip:book'))

    world.weaponStance = 'ranged'
    applyWeaponStance(world, eid, 'ranged')
    assert.equal(findObjectByName(root, 'equip:staff'), null)
    assert.ok(findObjectByName(root, 'equip:bow'))
    assert.ok(findObjectByName(root, 'equip:arrow'))
})

test('syncPlayerVisuals applies live equipment changes without model swaps', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    const eid = spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })
    const root = world.object3DByEid.get(eid)!

    assert.ok(findObjectByName(root, 'equip:sword'))
    world.playerSettings.equipment.melee = { handR: 'staff', handL: null }
    syncPlayerVisuals(world)

    assert.equal(findObjectByName(root, 'equip:sword'), null)
    assert.ok(findObjectByName(root, 'equip:staff'))
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

test('default hand equipment frames point sword forward, nock arrow, and keep shield on the hand', () => {
    const sword = equipmentSocketFrame('sword', 'handR')
    const shield = equipmentSocketFrame('shield', 'handL')
    const arrow = equipmentSocketFrame('arrow', 'handR')

    const bladeDir = new Vector3(0, 1, 0).applyEuler(toEuler(sword.orient))
    assert.ok(bladeDir.z > 0.9, 'right-hand sword should point toward the character front')
    assert.ok(bladeDir.y > 0.03, 'right-hand sword should keep a slight upward lift')

    const drawArmPose = new Euler(-1.26, 1.02, -0.08, 'XYZ')
    const arrowDirAtDraw = new Vector3(0, 1, 0).applyEuler(toEuler(arrow.orient)).applyEuler(drawArmPose)
    assert.ok(arrowDirAtDraw.x > 0.96, 'right-hand arrow should line up across the bow at full draw')
    assert.ok(Math.abs(arrowDirAtDraw.y) < 0.08, 'right-hand arrow should stay level at full draw')
    assert.ok(Math.abs(arrow.offset?.[0] ?? 1) < 0.04, 'right-hand arrow nock should stay close to the fingers')

    const shieldNormal = new Vector3(0, 0, 1).applyEuler(toEuler(shield.orient))
    assert.ok(shieldNormal.x < -0.85, 'left-hand shield should guard the left side')
    assert.ok(shieldNormal.z > 0.1, 'left-hand shield should stay slightly readable from the front')
    assert.ok(Math.abs((shield.offset?.[0] ?? 0)) < 0.16, 'shield grip should stay close enough to touch the hand')
})

function toEuler(value: readonly [number, number, number] | undefined): Euler {
    return new Euler(value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0, 'XYZ')
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

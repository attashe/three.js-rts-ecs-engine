import test from 'node:test'
import assert from 'node:assert/strict'
import { query } from 'bitecs'
import { Euler, Mesh, MeshBasicMaterial, PointLight, Vector3, type Object3D } from 'three'
import { MovingObject } from '../src/engine/ecs/components'
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

test('projectile launch consumes starting arrow inventory and spawns an arrow', () => {
    const world = createGameWorld()
    world.playerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    world.inventory.arrows = 2
    spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })

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
    spawnPlayer(world, { spawn: { x: 0, y: 1, z: 0 }, settings: world.playerSettings })

    createProjectileLaunchSystem(onePressAction()).update(world, 1 / 60)

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
    assert.deepEqual(settings.equipment.ranged, { handR: null, handL: 'bow' })

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

test('default melee equipment frames point sword forward and shield to the left side', () => {
    const sword = equipmentSocketFrame('sword', 'handR')
    const shield = equipmentSocketFrame('shield', 'handL')

    const bladeDir = new Vector3(0, 1, 0).applyEuler(toEuler(sword.orient))
    assert.ok(bladeDir.z > 0.2, 'right-hand sword should lean toward the character front')
    assert.ok(bladeDir.y > 0.8, 'right-hand sword should stay mostly upright')

    const shieldNormal = new Vector3(0, 0, 1).applyEuler(toEuler(shield.orient))
    assert.ok(shieldNormal.x < -0.85, 'left-hand shield should guard the left side')
    assert.ok(shieldNormal.z > 0.1, 'left-hand shield should stay slightly readable from the front')
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

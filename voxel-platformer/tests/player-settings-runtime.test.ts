import test from 'node:test'
import assert from 'node:assert/strict'
import { query } from 'bitecs'
import { Mesh, MeshBasicMaterial, PointLight, type Object3D } from 'three'
import { MovingObject } from '../src/engine/ecs/components'
import { createProjectileLaunchSystem } from '../src/engine/ecs/systems/projectile-launch-system'
import { createGameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { PLAYER_TORCH_FLAME, PLAYER_TORCH_LIGHT } from '../src/game/assets'
import { MovingObjectKind } from '../src/game/moving-objects'
import { createPlayerTorchSystem } from '../src/game/player-torch-system'
import { PLAYER_MODEL_KIND_USER_DATA, spawnPlayer, syncPlayerVisuals } from '../src/game/player'
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

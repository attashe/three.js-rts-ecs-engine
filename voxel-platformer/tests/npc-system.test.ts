import test from 'node:test'
import assert from 'node:assert/strict'
import { Group, LineSegments, Scene, type Object3D } from 'three'
import { createGameWorld } from '../src/engine/ecs/world'
import { createNpcModel } from '../src/game/npcs/npc-models'
import { createNpcRenderSystem } from '../src/game/npcs/npc-render-system'
import { registerRuntimeNpcs } from '../src/game/npcs/npc-runtime'
import {
    NPC_MODEL_KINDS,
    NPC_MODEL_LABELS,
    defaultNpcEquipment,
    normalizeNpcConfig,
    npcInteractionZoneId,
    npcObstacleId,
    type NpcConfig,
} from '../src/game/npcs/npc-types'

function npc(id: string): NpcConfig {
    return normalizeNpcConfig({
        id,
        name: 'Keeper Arlen',
        model: 'keeper',
        position: { x: 2, y: 3, z: 4 },
        yaw: 0.25,
        scale: 1.1,
        interactionPrompt: 'Talk',
        scriptSource: `on('level-start', () => log(NPC_NAME))`,
    })
}

test('NPC model registry exposes keeper and player models', () => {
    assert.deepEqual([...NPC_MODEL_KINDS], ['keeper', 'player', 'large-troll'])
    for (const kind of NPC_MODEL_KINDS) {
        assert.ok(NPC_MODEL_LABELS[kind].length > 0)
        const model = createNpcModel(kind)
        assert.ok(model instanceof Group)
        assert.equal(model.name, `NpcModel:${kind}`)
        assert.ok(model.children.length > 0, `${kind} model should contain visible parts`)
    }
})

test('NPC equipment normalizes from model defaults and custom hand choices', () => {
    const keeper = normalizeNpcConfig({
        id: 'keeper',
        model: 'keeper',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.deepEqual(keeper.equipment, defaultNpcEquipment('keeper'))

    const troll = normalizeNpcConfig({
        id: 'troll',
        model: 'large-troll',
        position: { x: 0, y: 0, z: 0 },
    })
    assert.deepEqual(troll.equipment, { handR: null, handL: 'book' })

    const custom = normalizeNpcConfig({
        id: 'custom',
        model: 'keeper',
        position: { x: 0, y: 0, z: 0 },
        equipment: { handR: 'sword', handL: 'bogus' } as never,
    })
    assert.deepEqual(custom.equipment, { handR: 'sword', handL: null })
})

test('registerRuntimeNpcs adds interaction zones, collision obstacles, and scripts', () => {
    const world = createGameWorld()
    const config = npc('arlen')
    const runtime = registerRuntimeNpcs(world, [config])

    const zoneId = npcInteractionZoneId(config)
    const zone = world.zones.get(zoneId)
    assert.ok(zone, 'interaction zone should be defined')
    assert.equal(zone!.kind, 'interact')
    assert.equal(zone!.interaction?.prompt, 'Talk')

    const obstacleId = npcObstacleId(config, 0)
    assert.equal(world.obstacles.has(obstacleId), true)
    assert.equal(world.obstacles.intersects({
        minX: 1.9,
        minY: 3.1,
        minZ: 3.9,
        maxX: 2.1,
        maxY: 3.5,
        maxZ: 4.1,
    }), true)

    assert.equal(runtime.scripts.length, 1)
    assert.equal(runtime.scripts[0]?.id, 'npc-script:arlen')
    assert.match(runtime.scripts[0]!.source, /const NPC_NAME = "Keeper Arlen"/)
    assert.match(runtime.scripts[0]!.source, /npc\.arlen\.interact/)

    runtime.dispose()
    assert.equal(world.zones.has(zoneId), false)
    assert.equal(world.obstacles.has(obstacleId), false)
})

test('NPC renderer tracks add, move, and remove changes', () => {
    const scene = new Scene()
    const npcs = [npc('arlen')]
    const system = createNpcRenderSystem(scene, { getNpcs: () => npcs })

    system.init?.(createGameWorld())
    const group = scene.children.find((child) => child.name === 'NPCs') as Group | undefined
    assert.ok(group, 'renderer should add an NPC root group')
    assert.equal(group!.children.length, 1)
    assert.equal(group!.children[0]!.name, 'NPC:arlen')

    const firstRoot = group!.children[0]!
    npcs[0]!.position.x = 5
    system.update(createGameWorld(), 1 / 60)
    assert.equal(group!.children[0], firstRoot, 'moving an NPC should not rebuild its model')
    assert.equal(group!.children[0]!.position.x, 5)

    npcs.length = 0
    system.update(createGameWorld(), 1 / 60)
    assert.equal(group!.children.length, 0)

    system.dispose?.()
    assert.equal(scene.children.includes(group!), false)
})

test('NPC renderer rebuilds visuals when hand equipment changes', () => {
    const scene = new Scene()
    const config = npc('equipped')
    const npcs = [config]
    const system = createNpcRenderSystem(scene, { getNpcs: () => npcs })
    const world = createGameWorld()

    system.init?.(world)
    const group = scene.children.find((child) => child.name === 'NPCs') as Group | undefined
    assert.ok(group)
    assert.ok(findByName(group!, 'equip:staff'), 'keeper starts with staff equipment')
    const firstRoot = group!.children[0]!

    config.equipment = { handR: null, handL: 'book' }
    system.update(world, 1 / 60)

    assert.notEqual(group!.children[0], firstRoot, 'equipment change rebuilds socket attachments')
    assert.equal(findByName(group!, 'equip:staff'), null)
    assert.ok(findByName(group!, 'equip:book'))

    system.dispose?.()
})

test('NPC renderer draws debug collider boxes for collidable NPCs only', () => {
    const scene = new Scene()
    const collidable = npc('solid')
    const passable = { ...npc('passable'), id: 'passable', collisionEnabled: false }
    const system = createNpcRenderSystem(scene, { getNpcs: () => [collidable, passable] })
    const world = createGameWorld()

    system.init?.(world)
    system.update(world, 1 / 60)

    const lines = scene.children.find((child) => child.name === 'NPCColliderDebug') as LineSegments | undefined
    assert.ok(lines, 'renderer should add an NPC collider debug batch')
    assert.equal(lines!.visible, true)
    assert.equal(lines!.geometry.drawRange.count, 24, 'one collidable NPC emits one wire box')

    system.dispose?.()
    assert.equal(scene.children.includes(lines!), false)
})

function findByName(root: Object3D, name: string): Object3D | null {
    let found: Object3D | null = null
    root.traverse((obj) => {
        if (!found && obj.name === name) found = obj
    })
    return found
}

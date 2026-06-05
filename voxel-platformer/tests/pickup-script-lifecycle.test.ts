import test from 'node:test'
import assert from 'node:assert/strict'
import { hasComponent, removeComponent } from 'bitecs'
import { Pickup } from '../src/engine/ecs/components'
import { createGameWorld } from '../src/engine/ecs/world'
import {
    despawnScriptPickup,
    scriptPickupExists,
    spawnScriptPickup,
} from '../src/game/pickups'
import {
    HIGH_JUMP_BOOTS_ITEM_ID,
    HIGH_JUMP_BOOTS_ITEM_OPTIONS,
    HIGH_JUMP_BOOTS_NAME,
    HIGH_SPEED_BOOTS_ITEM_ID,
    HIGH_SPEED_BOOTS_ITEM_OPTIONS,
} from '../src/game/high-jump-boots'
import { createNpcLootSystem } from '../src/game/npc-loot-system'
import { DYNAMITE_ITEM_ID, FOOD_MEAT_ITEM_ID, FOOD_PIE_ITEM_ID } from '../src/game/consumables'
import { normalizeNpcConfig } from '../src/game/npcs/npc-types'
import { registerRuntimeNpcs } from '../src/game/npcs/npc-runtime'

test('spawnScriptPickup + scriptPickupExists round-trip a stable id', () => {
    const world = createGameWorld()
    const id = spawnScriptPickup(world, {
        kind: 'sun-shard',
        position: { x: 1, y: 2, z: 3 },
        id: 'shard.A',
    })
    assert.equal(id, 'shard.A')
    assert.equal(scriptPickupExists(world, 'shard.A'), true)
    assert.equal(scriptPickupExists(world, 'shard.B'), false)
})

test('spawnScriptPickup stores durable inventory metadata for custom pickups', () => {
    const world = createGameWorld()
    spawnScriptPickup(world, {
        kind: 'sun-shard',
        position: { x: 1, y: 2, z: 3 },
        id: 'shard.meta',
        amount: 2,
        label: 'Bright Shard',
        inventoryItem: {
            id: 'bright-shard',
            description: 'A warm splinter of light.',
            category: 'quest',
            icon: 'quest-shard',
        },
    })
    const eid = world.pickupEntityByScriptId.get('shard.meta')!
    assert.deepEqual(world.pickupMetaByEid.get(eid)?.inventoryItem, {
        id: 'bright-shard',
        quantity: 2,
        options: {
            name: 'Bright Shard',
            description: 'A warm splinter of light.',
            category: 'quest',
            icon: 'quest-shard',
        },
    })
})

test('spawnScriptPickup renders high jump boots with the boots pickup prop', () => {
    const world = createGameWorld()
    spawnScriptPickup(world, {
        kind: HIGH_JUMP_BOOTS_ITEM_ID,
        position: { x: 1, y: 2, z: 3 },
        id: 'boots.meta',
        label: HIGH_JUMP_BOOTS_NAME,
        inventoryItem: {
            id: HIGH_JUMP_BOOTS_ITEM_ID,
            ...HIGH_JUMP_BOOTS_ITEM_OPTIONS,
        },
    })

    const eid = world.pickupEntityByScriptId.get('boots.meta')!
    assert.equal(world.object3DByEid.get(eid)?.name, 'HighJumpBootsProp')
    assert.deepEqual(world.pickupMetaByEid.get(eid)?.inventoryItem, {
        id: HIGH_JUMP_BOOTS_ITEM_ID,
        quantity: 1,
        options: HIGH_JUMP_BOOTS_ITEM_OPTIONS,
    })
})

test('spawnScriptPickup defaults boot pickup metadata to accessory options', () => {
    const world = createGameWorld()
    spawnScriptPickup(world, {
        kind: HIGH_SPEED_BOOTS_ITEM_ID,
        position: { x: 1, y: 2, z: 3 },
        id: 'speed-boots.meta',
    })

    const eid = world.pickupEntityByScriptId.get('speed-boots.meta')!
    assert.equal(world.object3DByEid.get(eid)?.name, 'HighJumpBootsProp')
    assert.deepEqual(world.pickupMetaByEid.get(eid)?.inventoryItem, {
        id: HIGH_SPEED_BOOTS_ITEM_ID,
        quantity: 1,
        options: HIGH_SPEED_BOOTS_ITEM_OPTIONS,
    })
})

test('spawnScriptPickup renders known consumables with consumable props', () => {
    const world = createGameWorld()
    spawnScriptPickup(world, {
        kind: DYNAMITE_ITEM_ID,
        position: { x: 1, y: 2, z: 3 },
        id: 'dynamite.meta',
    })
    spawnScriptPickup(world, {
        kind: FOOD_PIE_ITEM_ID,
        position: { x: 2, y: 2, z: 3 },
        id: 'pie.meta',
    })

    const dynamite = world.pickupEntityByScriptId.get('dynamite.meta')!
    const pie = world.pickupEntityByScriptId.get('pie.meta')!
    assert.equal(world.object3DByEid.get(dynamite)?.name, 'DynamiteBundle')
    assert.equal(world.object3DByEid.get(pie)?.name, 'FoodPickup:pie')
})

test('rabbit death drops rabbit meat once', () => {
    const world = createGameWorld()
    registerRuntimeNpcs(world, [
        normalizeNpcConfig({ id: 'bunny', model: 'rabbit', position: { x: 4, y: 1, z: 5 } }),
    ])
    const bunny = world.npcRuntimeById.get('bunny')!
    bunny.dying = true
    const system = createNpcLootSystem()

    system.update(world, 1 / 60)
    system.update(world, 1 / 60)

    const pickup = world.pickupEntityByScriptId.get('loot:bunny:rabbit-meat')!
    assert.ok(pickup !== undefined)
    assert.equal(world.object3DByEid.get(pickup)?.name, 'FoodPickup:meat')
    assert.deepEqual(world.pickupMetaByEid.get(pickup)?.inventoryItem, {
        id: FOOD_MEAT_ITEM_ID,
        quantity: 1,
        options: {
            name: 'Rabbit Meat',
            description: 'Restores a small amount of health after digestion.',
            category: 'consumables',
            icon: 'food-meat',
        },
    })
    assert.equal([...world.pickupEntityByScriptId.keys()].filter((id) => id === 'loot:bunny:rabbit-meat').length, 1)
})

test('despawnScriptPickup removes the live entity, clears both maps, and is idempotent', () => {
    const world = createGameWorld()
    spawnScriptPickup(world, { kind: 'coin', position: { x: 0, y: 0, z: 0 }, id: 'coin.A' })
    const eid = world.pickupEntityByScriptId.get('coin.A')!
    assert.ok(hasComponent(world, eid, Pickup))

    assert.equal(despawnScriptPickup(world, 'coin.A'), true)
    assert.equal(scriptPickupExists(world, 'coin.A'), false)
    assert.equal(world.pickupEntityByScriptId.has('coin.A'), false)
    assert.equal(world.pickupMetaByEid.has(eid), false)

    assert.equal(despawnScriptPickup(world, 'coin.A'), false, 'second despawn of the same id is a clean no-op')
    assert.equal(despawnScriptPickup(world, 'never.spawned'), false)
})

test('despawnScriptPickup does not emit pickup-taken — that event is reserved for player collection', () => {
    const world = createGameWorld()
    spawnScriptPickup(world, { kind: 'sun-shard', position: { x: 5, y: 5, z: 5 }, id: 'shard.E' })
    const eventsBefore = [...world.scriptTriggerEvents]
    despawnScriptPickup(world, 'shard.E')
    assert.deepEqual(world.scriptTriggerEvents, eventsBefore)
})

test('despawnScriptPickup detects a stale map entry, clears it, and returns false', () => {
    // Reproduces the race the defensive `hasComponent` check guards
    // against: a third party (e.g. the pickup-system mid-collection)
    // removed the Pickup component from the entity but the
    // pickupEntityByScriptId map still holds the stale eid.
    const world = createGameWorld()
    spawnScriptPickup(world, { kind: 'sun-shard', position: { x: 0, y: 0, z: 0 }, id: 'shard.stale' })
    const eid = world.pickupEntityByScriptId.get('shard.stale')!
    removeComponent(world, eid, Pickup)
    assert.equal(hasComponent(world, eid, Pickup), false, 'precondition: entity no longer carries Pickup')

    const result = despawnScriptPickup(world, 'shard.stale')
    assert.equal(result, false, 'a stale entry is reported as "nothing live to remove"')
    assert.equal(world.pickupEntityByScriptId.has('shard.stale'), false, 'stale map entry is cleaned up')
    assert.equal(world.pickupMetaByEid.has(eid), false, 'stale meta entry is cleaned up')
    assert.equal(scriptPickupExists(world, 'shard.stale'), false)
})

test('spawn after despawn re-claims the same id without idempotent-spawn collision', () => {
    const world = createGameWorld()
    spawnScriptPickup(world, { kind: 'coin', position: { x: 0, y: 0, z: 0 }, id: 'gold.X' })
    despawnScriptPickup(world, 'gold.X')
    assert.equal(scriptPickupExists(world, 'gold.X'), false)

    const reclaimed = spawnScriptPickup(world, { kind: 'coin', position: { x: 1, y: 1, z: 1 }, id: 'gold.X' })
    assert.equal(reclaimed, 'gold.X')
    assert.equal(scriptPickupExists(world, 'gold.X'), true)
})

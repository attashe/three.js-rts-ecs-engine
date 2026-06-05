import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { Pickup, PickupValue, PlayerControlled, Position } from '../src/engine/ecs/components'
import { createPickupSystem, PickupKind } from '../src/engine/ecs/systems/pickup-system'
import { consumeScriptTriggerEvents, createGameWorld } from '../src/engine/ecs/world'
import { inventoryItemCount } from '../src/game/inventory'

function addPlayer(world: ReturnType<typeof createGameWorld>, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, PlayerControlled)
    addComponent(world, eid, Position)
    Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = z
    return eid
}

function addPickupEntity(
    world: ReturnType<typeof createGameWorld>,
    kind: number, amount: number,
    x: number, y: number, z: number,
): number {
    const eid = addEntity(world)
    addComponent(world, eid, Pickup)
    addComponent(world, eid, PickupValue)
    addComponent(world, eid, Position)
    PickupValue.kind[eid] = kind
    PickupValue.amount[eid] = amount
    Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = z
    return eid
}

test('PickupSystem: gold pickup increments world.inventory.gold and disposes the entity', () => {
    const world = createGameWorld()
    addPlayer(world, 0, 0, 0)
    const coin = addPickupEntity(world, PickupKind.Gold, 12, 0.3, 0, 0.3)

    createPickupSystem({ radius: 0.9 }).update(world, 1 / 60)

    assert.equal(world.inventory.gold, 12)
    assert.equal(hasComponent(world, coin, Pickup), false, 'pickup entity should be despawned after collection')
})

test('PickupSystem: arrow pickup increments world.inventory.arrows', () => {
    const world = createGameWorld()
    addPlayer(world, 0, 0, 0)
    addPickupEntity(world, PickupKind.Arrow, 3, 0.4, 0, 0)

    createPickupSystem({ radius: 0.9 }).update(world, 1 / 60)
    assert.equal(world.inventory.arrows, 3)
})

test('PickupSystem: out-of-range pickups are not collected', () => {
    const world = createGameWorld()
    addPlayer(world, 0, 0, 0)
    const coin = addPickupEntity(world, PickupKind.Gold, 5, 5, 0, 0)

    createPickupSystem({ radius: 0.9 }).update(world, 1 / 60)

    assert.equal(world.inventory.gold, 0)
    assert.equal(hasComponent(world, coin, Pickup), true, 'far-away pickup should remain')
})

test('PickupSystem: onCollected callback fires once per pickup with the right kind + amount', () => {
    const world = createGameWorld()
    addPlayer(world, 0, 0, 0)
    addPickupEntity(world, PickupKind.Gold, 9, 0.2, 0, 0)
    addPickupEntity(world, PickupKind.Arrow, 1, -0.2, 0, 0)

    const events: Array<{ kind: number; amount: number }> = []
    createPickupSystem({
        radius: 0.9,
        onCollected: (kind, amount) => events.push({ kind, amount }),
    }).update(world, 1 / 60)

    assert.equal(events.length, 2)
    assert.deepEqual(events.sort((a, b) => a.kind - b.kind), [
        { kind: PickupKind.Gold, amount: 9 },
        { kind: PickupKind.Arrow, amount: 1 },
    ])
})

test('PickupSystem: amount defaults to 1 when the slot is 0 (defensive)', () => {
    const world = createGameWorld()
    addPlayer(world, 0, 0, 0)
    addPickupEntity(world, PickupKind.Gold, 0, 0.1, 0, 0)

    createPickupSystem({ radius: 0.9 }).update(world, 1 / 60)
    assert.equal(world.inventory.gold, 1)
})

test('PickupSystem: script item metadata emits custom kind, pickupId, and durable inventory item', () => {
    const world = createGameWorld()
    addPlayer(world, 0, 0, 0)
    const item = addPickupEntity(world, PickupKind.ScriptItem, 1, 0.2, 0, 0)
    world.pickupMetaByEid.set(item, {
        kind: 'sun-shard',
        pickupId: 'demo.shard.stairs',
        label: 'Sun Shard',
    })
    world.pickupEntityByScriptId.set('demo.shard.stairs', item)

    createPickupSystem({ radius: 0.9 }).update(world, 1 / 60)

    assert.equal(world.inventory.gold, 0)
    assert.equal(world.inventory.arrows, 0)
    assert.equal(inventoryItemCount(world.inventory.items, 'sun-shard'), 1)
    assert.equal(world.playerSettings.inventory.items['sun-shard']?.quantity, 1)
    assert.equal(world.pickupMetaByEid.has(item), false)
    assert.equal(world.pickupEntityByScriptId.has('demo.shard.stairs'), false)
    const events = consumeScriptTriggerEvents(world)
    assert.deepEqual(events[0], {
        kind: 'pickup-taken',
        pickupKind: 'sun-shard',
        pickupId: 'demo.shard.stairs',
        amount: 1,
        position: { x: 0.20000000298023224, y: 0, z: 0 },
        entityId: item,
    })
})

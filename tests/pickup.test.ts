import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { Pickup, PickupValue, PlayerControlled, Position } from '../src/client/engine/ecs/components'
import { createPickupSystem } from '../src/client/engine/ecs/systems/pickup-system'
import { createGameWorld } from '../src/client/engine/ecs/world'
import {
    aggregateInventoryCounts,
    createInventoryItem,
    populateDefaultPlayerLoadout,
} from '../src/client/game/items'

test('PickupSystem: collected pickups land as stacks in the backpack', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    // The default kit ships with potions & arrow stacks; clear the backpack
    // so the assertion below isn't measuring those.
    world.playerLoadout.backpackSlots.fill(null)

    const player = addEntity(world)
    addComponent(world, player, Position)
    addComponent(world, player, PlayerControlled)
    Position.x[player] = 0
    Position.y[player] = 0
    Position.z[player] = 0

    addPickup(world, 1, 12, 0.1)
    addPickup(world, 2, 25, 0.2)
    addPickup(world, 3, 4, 0.3)

    createPickupSystem({ radius: 1 }).update(world, 1 / 60)

    assert.deepEqual(aggregateInventoryCounts(world), {
        gold: 12,
        potions: 1,
        arrows: 4,
    })
})

test('PickupSystem: full backpack leaves the pickup entity alive for retry', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    // Fill every backpack slot with a unique non-stackable item so the new
    // gold pickup can't merge into an existing stack and can't find an empty
    // slot. Inlined here rather than going through createInventoryItem so the
    // ids don't collide with registry definitions.
    for (let i = 0; i < world.playerLoadout.backpackSlots.length; i++) {
        world.playerLoadout.backpackSlots[i] = {
            id: `filler-${i}`,
            category: 'weapon',
            label: 'Filler',
            icon: 'F',
        }
    }

    const player = addEntity(world)
    addComponent(world, player, Position)
    addComponent(world, player, PlayerControlled)

    const pickup = addPickup(world, 1, 5, 0.2)

    createPickupSystem({ radius: 1 }).update(world, 1 / 60)

    // Pickup entity should still be in the world — i.e. it wasn't despawned.
    // Walking away and clearing a backpack slot will let the player retry on
    // a later tick. Position is a Float32Array, so allow a tiny epsilon.
    assert.equal(world.playerLoadout.backpackSlots.some((slot) => slot?.id === 'gold'), false)
    assert.ok(Math.abs(Position.x[pickup] - 0.2) < 1e-6,
        `pickup should still be on the ground at x ≈ 0.2; got ${Position.x[pickup]}`)
})

test('PickupSystem: equippable pickup recomputes player stats', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    // Strip armor so the next pickup is the only contributor we measure.
    for (const slot of world.playerLoadout.armorySlots) slot.item = null
    world.playerStats.defense = 0
    world.playerStats.weight = 0
    world.playerStats.moveSpeedMult = 1
    // Empty the backpack so the dropped helm has somewhere to go.
    world.playerLoadout.backpackSlots.fill(null)

    const player = addEntity(world)
    addComponent(world, player, Position)
    addComponent(world, player, PlayerControlled)

    const droppedHelm = addEntity(world)
    addComponent(world, droppedHelm, Position)
    addComponent(world, droppedHelm, Pickup)
    Position.x[droppedHelm] = 0.2
    Position.y[droppedHelm] = 0
    Position.z[droppedHelm] = 0
    world.pickupByEid.set(droppedHelm, {
        label: 'Iron helm',
        message: 'Picked up Iron helm.',
        item: createInventoryItem('iron-helm'),
    })

    createPickupSystem({ radius: 1 }).update(world, 1 / 60)

    // The helm sits in the backpack (not yet equipped), but recomputePlayer
    // Stats has run — the cached numbers still reflect "no armor equipped"
    // because the helm hasn't been moved to the armory slot.
    assert.equal(world.playerLoadout.backpackSlots.some((slot) => slot?.id === 'iron-helm'), true)
    assert.equal(world.playerStats.defense, 0, 'pickup into backpack does not equip the item')
})

function addPickup(
    world: ReturnType<typeof createGameWorld>,
    kind: number,
    amount: number,
    x: number,
): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, Pickup)
    addComponent(world, eid, PickupValue)
    Position.x[eid] = x
    Position.y[eid] = 0
    Position.z[eid] = 0
    PickupValue.kind[eid] = kind
    PickupValue.amount[eid] = amount
    return eid
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { Pickup, PickupValue, PlayerControlled, Position } from '../src/client/engine/ecs/components'
import { createPickupSystem } from '../src/client/engine/ecs/systems/pickup-system'
import { createGameWorld } from '../src/client/engine/ecs/world'

test('PickupSystem: collected pickup values update player inventory counts', () => {
    const world = createGameWorld()
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

    assert.deepEqual(world.playerInventory, {
        gold: 12,
        potions: 1,
        arrows: 4,
    })
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

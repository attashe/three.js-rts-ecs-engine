import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents, hasComponent, query } from 'bitecs'
import { BoxCollider, ClimbingLadder, Health, Mana, MovingObject, PlayerControlled, Position, Rotation } from '../src/engine/ecs/components'
import { createEntity } from '../src/engine/ecs/entity'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { createConsumableUseSystem } from '../src/game/consumable-use-system'
import { DYNAMITE_ITEM_ID, HEAL_POTION_ITEM_ID } from '../src/game/consumables'
import { normalizeInventoryItems, copyInventoryItems } from '../src/game/inventory'
import { MovingObjectKind } from '../src/game/moving-objects'
import { PLAYER_DEFAULT_MAX_MANA } from '../src/game/mana'

function onePressAction(): ActionMap {
    let pressed = true
    return {
        consumePressed() {
            if (!pressed) return null
            pressed = false
            return { actionId: 'consumable.use' }
        },
    } as unknown as ActionMap
}

function spawnPlayer(world: GameWorld, hp = 1): number {
    const eid = createEntity(world)
    addComponents(world, eid, [PlayerControlled, Position, Rotation, BoxCollider, Health, Mana])
    Position.x[eid] = 0
    Position.y[eid] = 0
    Position.z[eid] = 0
    Rotation.y[eid] = 0
    BoxCollider.x[eid] = 0.35
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.35
    Health.current[eid] = hp
    Health.max[eid] = 4
    Mana.current[eid] = PLAYER_DEFAULT_MAX_MANA
    Mana.max[eid] = PLAYER_DEFAULT_MAX_MANA
    return eid
}

test('Z uses the selected direct consumable', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, 1)
    world.selectedConsumable = HEAL_POTION_ITEM_ID
    world.inventory.items = normalizeInventoryItems({
        [HEAL_POTION_ITEM_ID]: { quantity: 1 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    createConsumableUseSystem(onePressAction()).update(world, 1 / 60)

    assert.equal(Health.current[player], 3)
    assert.equal(world.inventory.items[HEAL_POTION_ITEM_ID], undefined)
})

test('Z throws selected dynamite and consumes one stack item', () => {
    const world = createGameWorld()
    spawnPlayer(world)
    world.selectedConsumable = DYNAMITE_ITEM_ID
    world.inventory.items = normalizeInventoryItems({
        [DYNAMITE_ITEM_ID]: { quantity: 2 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    createConsumableUseSystem(onePressAction()).update(world, 1 / 60)

    assert.equal(world.inventory.items[DYNAMITE_ITEM_ID]?.quantity, 1)
    const dynamites = query(world, [MovingObject]).filter((eid) => MovingObject.kind[eid] === MovingObjectKind.Dynamite)
    assert.equal(dynamites.length, 1)
})

test('Z does not throw dynamite while climbing', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    addComponents(world, player, [ClimbingLadder])
    world.selectedConsumable = DYNAMITE_ITEM_ID
    world.inventory.items = normalizeInventoryItems({
        [DYNAMITE_ITEM_ID]: { quantity: 1 },
    })

    createConsumableUseSystem(onePressAction()).update(world, 1 / 60)

    assert.equal(world.inventory.items[DYNAMITE_ITEM_ID]?.quantity, 1)
    assert.equal(query(world, [MovingObject]).length, 0)
    assert.equal(hasComponent(world, player, ClimbingLadder), true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents } from 'bitecs'
import { Health, PlayerControlled } from '../src/engine/ecs/components'
import { HP_PER_HEART } from '../src/engine/ecs/combat'
import { createEntity } from '../src/engine/ecs/entity'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import {
    addInventoryItem,
    copyInventoryItems,
    defaultInventoryIcon,
    inventoryItemCount,
    listInventoryItems,
    normalizeInventoryItems,
    removeInventoryItem,
} from '../src/game/inventory'
import { consumeHealPotion, setBootsEquipped, setHighJumpBootsEquipped } from '../src/game/inventory-system'
import { applyPlayerSettingsPatch, copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, normalizePlayerSettings } from '../src/game/player-settings'
import { HIGH_JUMP_BOOTS_ITEM_ID, HIGH_SPEED_BOOTS_ITEM_ID } from '../src/game/high-jump-boots'

function spawnInventoryPlayer(world: GameWorld, current: number, max: number): number {
    const eid = createEntity(world)
    addComponents(world, eid, [PlayerControlled, Health])
    Health.current[eid] = current
    Health.max[eid] = max
    return eid
}

test('inventory helpers normalize, stack, list, and remove durable items', () => {
    const items = normalizeInventoryItems({
        'Sun Shard': { quantity: 2, name: 'Sun Shard', category: 'quest', icon: 'quest-shard' },
        junk: { quantity: 0 },
    })

    assert.equal(inventoryItemCount(items, 'sun-shard'), 2)
    assert.equal(addInventoryItem(items, 'sun-shard', 1, { description: 'Warm to the touch.' }), true)
    assert.equal(addInventoryItem(items, 'moon key', 1, { name: 'Moon Key', category: 'tools' }), true)
    assert.equal(inventoryItemCount(items, 'sun-shard'), 3)
    assert.deepEqual(listInventoryItems(items, 'tools').map((item) => item.id), ['moon-key'])
    assert.equal(removeInventoryItem(items, 'sun-shard', 2), true)
    assert.equal(inventoryItemCount(items, 'sun-shard'), 1)
    assert.equal(addInventoryItem(items, 'heal-potion', 3), true)
    assert.equal(addInventoryItem(items, HIGH_JUMP_BOOTS_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, HIGH_SPEED_BOOTS_ITEM_ID, 1), true)
    assert.equal(defaultInventoryIcon('heal-potion'), 'heal-potion')
    assert.equal(defaultInventoryIcon(HIGH_JUMP_BOOTS_ITEM_ID), 'boots')
    assert.equal(defaultInventoryIcon(HIGH_SPEED_BOOTS_ITEM_ID), 'boots')
    assert.deepEqual(listInventoryItems(items, 'consumables').map((item) => [item.id, item.quantity, item.icon]), [
        ['heal-potion', 3, 'heal-potion'],
    ])
    assert.deepEqual(listInventoryItems(items, 'accessories').map((item) => [item.id, item.quantity, item.icon]), [
        [HIGH_JUMP_BOOTS_ITEM_ID, 1, 'boots'],
        [HIGH_SPEED_BOOTS_ITEM_ID, 1, 'boots'],
    ])
})

test('player settings deep-copy durable inventory and tolerate old saves', () => {
    assert.equal(DEFAULT_PLAYER_SETTINGS.inventory.items['heal-potion']?.quantity, 2)
    assert.equal(DEFAULT_PLAYER_SETTINGS.equipment.boots, null)
    assert.equal(normalizePlayerSettings().inventory.items['heal-potion']?.quantity, 2)
    const oldSave = normalizePlayerSettings({ inventory: { gold: 4, arrows: 2 } })
    assert.deepEqual(oldSave.inventory.items, {})

    const settings = applyPlayerSettingsPatch(copyPlayerSettings(DEFAULT_PLAYER_SETTINGS), {
        inventory: {
            gold: 7,
            arrows: 3,
            items: {
                'sun-shard': { quantity: 1, name: 'Sun Shard' },
            },
        },
    })
    const copied = copyPlayerSettings(settings)
    copied.inventory.items['sun-shard']!.quantity = 9

    assert.equal(settings.inventory.gold, 7)
    assert.equal(settings.inventory.arrows, 3)
    assert.equal(settings.inventory.items['sun-shard']?.quantity, 1)
    assert.equal(copyInventoryItems(settings.inventory.items)['sun-shard']?.quantity, 1)
})

test('high jump boots equip from durable accessory inventory without being consumed', () => {
    const world = createGameWorld()
    world.inventory.items = normalizeInventoryItems({
        [HIGH_JUMP_BOOTS_ITEM_ID]: { quantity: 1 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(setHighJumpBootsEquipped(world, true), true)
    assert.equal(world.playerSettings.equipment.boots, HIGH_JUMP_BOOTS_ITEM_ID)
    assert.equal(world.inventory.items[HIGH_JUMP_BOOTS_ITEM_ID]?.quantity, 1)

    assert.equal(setHighJumpBootsEquipped(world, false), true)
    assert.equal(world.playerSettings.equipment.boots, null)

    world.inventory.items = {}
    assert.equal(setHighJumpBootsEquipped(world, true), false)
    assert.equal(world.playerSettings.equipment.boots, null)
})

test('boots accessories share one equipment slot and require owned inventory', () => {
    const world = createGameWorld()
    world.inventory.items = normalizeInventoryItems({
        [HIGH_JUMP_BOOTS_ITEM_ID]: { quantity: 1 },
        [HIGH_SPEED_BOOTS_ITEM_ID]: { quantity: 1 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(setBootsEquipped(world, HIGH_JUMP_BOOTS_ITEM_ID, true), true)
    assert.equal(world.playerSettings.equipment.boots, HIGH_JUMP_BOOTS_ITEM_ID)

    assert.equal(setBootsEquipped(world, HIGH_SPEED_BOOTS_ITEM_ID, true), true)
    assert.equal(world.playerSettings.equipment.boots, HIGH_SPEED_BOOTS_ITEM_ID)
    assert.equal(world.inventory.items[HIGH_SPEED_BOOTS_ITEM_ID]?.quantity, 1)

    assert.equal(setBootsEquipped(world, HIGH_SPEED_BOOTS_ITEM_ID, false), true)
    assert.equal(world.playerSettings.equipment.boots, null)

    world.inventory.items = {}
    assert.equal(setBootsEquipped(world, HIGH_SPEED_BOOTS_ITEM_ID, true), false)
})

test('heal potion consumption restores one heart and updates inventory settings', () => {
    const world = createGameWorld()
    const player = spawnInventoryPlayer(world, 1, 4)
    world.inventory.items = normalizeInventoryItems({
        'heal-potion': { quantity: 2 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(consumeHealPotion(world), true)
    assert.equal(Health.current[player], 1 + HP_PER_HEART)
    assert.equal(world.inventory.items['heal-potion']?.quantity, 1)
    assert.equal(world.playerSettings.inventory.items['heal-potion']?.quantity, 1)

    Health.current[player] = Health.max[player]!
    assert.equal(consumeHealPotion(world), false)
    assert.equal(world.inventory.items['heal-potion']?.quantity, 1)
    assert.equal(world.playerSettings.inventory.items['heal-potion']?.quantity, 1)
})

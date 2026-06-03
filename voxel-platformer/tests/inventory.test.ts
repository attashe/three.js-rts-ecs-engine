import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents } from 'bitecs'
import { Health, Mana, PlayerControlled } from '../src/engine/ecs/components'
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
import { consumeHealPotion, consumeManaPotion, setBootsEquipped, setHeadEquipment, setHighJumpBootsEquipped, setMeleeHandEquipment } from '../src/game/inventory-system'
import { applyPlayerSettingsPatch, copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, normalizePlayerSettings } from '../src/game/player-settings'
import { HIGH_JUMP_BOOTS_ITEM_ID, HIGH_SPEED_BOOTS_ITEM_ID } from '../src/game/high-jump-boots'
import { METAL_HELMET_ITEM_ID, SNIPER_HAT_ITEM_ID, SPEAR_ITEM_ID } from '../src/game/equipment-items'
import { MANA_POTION_ITEM_ID, MANA_POTION_RESTORE, PLAYER_DEFAULT_MAX_MANA } from '../src/game/mana'
import {
    DYNAMITE_ITEM_ID,
    FOOD_APPLE_ITEM_ID,
    FOOD_DELAY_SECONDS,
    FOOD_FISH_ITEM_ID,
    FOOD_MEAT_ITEM_ID,
    FOOD_PIE_ITEM_ID,
    consumeDirectConsumable,
    updateDelayedConsumables,
} from '../src/game/consumables'

function spawnInventoryPlayer(world: GameWorld, current: number, max: number): number {
    const eid = createEntity(world)
    addComponents(world, eid, [PlayerControlled, Health, Mana])
    Health.current[eid] = current
    Health.max[eid] = max
    Mana.current[eid] = PLAYER_DEFAULT_MAX_MANA
    Mana.max[eid] = PLAYER_DEFAULT_MAX_MANA
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
    assert.equal(addInventoryItem(items, MANA_POTION_ITEM_ID, 2), true)
    assert.equal(addInventoryItem(items, FOOD_APPLE_ITEM_ID, 2), true)
    assert.equal(addInventoryItem(items, FOOD_FISH_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, FOOD_MEAT_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, FOOD_PIE_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, DYNAMITE_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, HIGH_JUMP_BOOTS_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, HIGH_SPEED_BOOTS_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, SNIPER_HAT_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, METAL_HELMET_ITEM_ID, 1), true)
    assert.equal(addInventoryItem(items, SPEAR_ITEM_ID, 1), true)
    assert.equal(defaultInventoryIcon('heal-potion'), 'heal-potion')
    assert.equal(defaultInventoryIcon(MANA_POTION_ITEM_ID), 'mana-potion')
    assert.equal(defaultInventoryIcon(FOOD_APPLE_ITEM_ID), 'food-apple')
    assert.equal(defaultInventoryIcon(FOOD_FISH_ITEM_ID), 'food-fish')
    assert.equal(defaultInventoryIcon(FOOD_MEAT_ITEM_ID), 'food-meat')
    assert.equal(defaultInventoryIcon(FOOD_PIE_ITEM_ID), 'food-pie')
    assert.equal(defaultInventoryIcon(DYNAMITE_ITEM_ID), 'dynamite')
    assert.equal(defaultInventoryIcon(HIGH_JUMP_BOOTS_ITEM_ID), 'boots')
    assert.equal(defaultInventoryIcon(HIGH_SPEED_BOOTS_ITEM_ID), 'boots')
    assert.equal(defaultInventoryIcon(SNIPER_HAT_ITEM_ID), 'hat-sniper')
    assert.equal(defaultInventoryIcon(METAL_HELMET_ITEM_ID), 'metal-helmet')
    assert.equal(defaultInventoryIcon(SPEAR_ITEM_ID), 'spear')
    assert.deepEqual(listInventoryItems(items, 'consumables').map((item) => [item.id, item.quantity, item.icon]), [
        [DYNAMITE_ITEM_ID, 1, 'dynamite'],
        [FOOD_APPLE_ITEM_ID, 2, 'food-apple'],
        [FOOD_FISH_ITEM_ID, 1, 'food-fish'],
        [FOOD_MEAT_ITEM_ID, 1, 'food-meat'],
        [FOOD_PIE_ITEM_ID, 1, 'food-pie'],
        ['heal-potion', 3, 'heal-potion'],
        [MANA_POTION_ITEM_ID, 2, 'mana-potion'],
    ])
    assert.deepEqual(listInventoryItems(items, 'accessories').map((item) => [item.id, item.quantity, item.icon]), [
        [SNIPER_HAT_ITEM_ID, 1, 'hat-sniper'],
        [HIGH_JUMP_BOOTS_ITEM_ID, 1, 'boots'],
        [HIGH_SPEED_BOOTS_ITEM_ID, 1, 'boots'],
        [METAL_HELMET_ITEM_ID, 1, 'metal-helmet'],
    ])
    assert.deepEqual(listInventoryItems(items, 'tools').map((item) => [item.id, item.quantity, item.icon]), [
        ['moon-key', 1, 'tool'],
        [SPEAR_ITEM_ID, 1, 'spear'],
    ])
})

test('delayed food restores health after its digestion timer', () => {
    const world = createGameWorld()
    const player = spawnInventoryPlayer(world, 1, 4)
    world.inventory.items = normalizeInventoryItems({
        [FOOD_APPLE_ITEM_ID]: { quantity: 1 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(consumeDirectConsumable(world, FOOD_APPLE_ITEM_ID), true)
    assert.equal(world.inventory.items[FOOD_APPLE_ITEM_ID], undefined)
    assert.equal(world.delayedConsumableEffects.length, 1)
    assert.equal(Health.current[player], 1)

    updateDelayedConsumables(world, FOOD_DELAY_SECONDS - 0.1)
    assert.equal(Health.current[player], 1)
    updateDelayedConsumables(world, 0.2)
    assert.equal(Health.current[player], 2)
    assert.equal(world.delayedConsumableEffects.length, 0)
})

test('pie restores a little health and half-orb mana after delay', () => {
    const world = createGameWorld()
    const player = spawnInventoryPlayer(world, 1, 4)
    Mana.current[player] = 1
    world.inventory.items = normalizeInventoryItems({
        [FOOD_PIE_ITEM_ID]: { quantity: 1 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(consumeDirectConsumable(world, FOOD_PIE_ITEM_ID), true)
    updateDelayedConsumables(world, FOOD_DELAY_SECONDS)

    assert.equal(Health.current[player], 2)
    assert.equal(Mana.current[player], 2)
})

test('dynamite cannot be consumed directly from inventory', () => {
    const world = createGameWorld()
    spawnInventoryPlayer(world, 1, 4)
    world.inventory.items = normalizeInventoryItems({
        [DYNAMITE_ITEM_ID]: { quantity: 1 },
    })

    assert.equal(consumeDirectConsumable(world, DYNAMITE_ITEM_ID), false)
    assert.equal(world.inventory.items[DYNAMITE_ITEM_ID]?.quantity, 1)
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

test('purchased head gear and spear equip only when owned', () => {
    const world = createGameWorld()
    world.inventory.items = {}
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(setHeadEquipment(world, METAL_HELMET_ITEM_ID), false)
    assert.equal(setMeleeHandEquipment(world, SPEAR_ITEM_ID), false)

    world.inventory.items = normalizeInventoryItems({
        [METAL_HELMET_ITEM_ID]: { quantity: 1 },
        [SNIPER_HAT_ITEM_ID]: { quantity: 1 },
        [SPEAR_ITEM_ID]: { quantity: 1 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(setHeadEquipment(world, METAL_HELMET_ITEM_ID), true)
    assert.equal(world.playerSettings.equipment.head, METAL_HELMET_ITEM_ID)
    assert.equal(setHeadEquipment(world, SNIPER_HAT_ITEM_ID), true)
    assert.equal(world.playerSettings.equipment.head, SNIPER_HAT_ITEM_ID)
    assert.equal(setMeleeHandEquipment(world, SPEAR_ITEM_ID), true)
    assert.equal(world.playerSettings.equipment.melee.handR, SPEAR_ITEM_ID)
    assert.equal(world.playerSettings.equipment.melee.handL, 'shield')

    world.inventory.items = {}
    assert.equal(setMeleeHandEquipment(world, 'sword'), true)
    assert.equal(setMeleeHandEquipment(world, SPEAR_ITEM_ID), false)
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

test('mana potion consumption restores two orbs and updates inventory settings', () => {
    const world = createGameWorld()
    const player = spawnInventoryPlayer(world, 4, 4)
    Mana.current[player] = 2
    world.inventory.items = normalizeInventoryItems({
        [MANA_POTION_ITEM_ID]: { quantity: 2 },
    })
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)

    assert.equal(consumeManaPotion(world), true)
    assert.equal(Mana.current[player], 2 + MANA_POTION_RESTORE)
    assert.equal(world.inventory.items[MANA_POTION_ITEM_ID]?.quantity, 1)
    assert.equal(world.playerSettings.inventory.items[MANA_POTION_ITEM_ID]?.quantity, 1)

    Mana.current[player] = Mana.max[player]!
    assert.equal(consumeManaPotion(world), false)
    assert.equal(world.inventory.items[MANA_POTION_ITEM_ID]?.quantity, 1)
    assert.equal(world.playerSettings.inventory.items[MANA_POTION_ITEM_ID]?.quantity, 1)
})

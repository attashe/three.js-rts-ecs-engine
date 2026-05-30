import test from 'node:test'
import assert from 'node:assert/strict'
import {
    addInventoryItem,
    copyInventoryItems,
    inventoryItemCount,
    listInventoryItems,
    normalizeInventoryItems,
    removeInventoryItem,
} from '../src/game/inventory'
import { applyPlayerSettingsPatch, copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, normalizePlayerSettings } from '../src/game/player-settings'

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
})

test('player settings deep-copy durable inventory and tolerate old saves', () => {
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

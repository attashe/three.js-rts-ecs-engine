import test from 'node:test'
import assert from 'node:assert/strict'
import {
    applyTradeSelection,
    normalizeTradeRequest,
    tradeAvailability,
} from '../src/game/trade'
import { HIGH_JUMP_BOOTS_ITEM_ID, HIGH_SPEED_BOOTS_ITEM_ID } from '../src/game/high-jump-boots'
import { METAL_HELMET_ITEM_ID, SNIPER_HAT_ITEM_ID, SPEAR_ITEM_ID } from '../src/game/equipment-items'
import { MANA_POTION_ITEM_ID } from '../src/game/mana'
import { DYNAMITE_ITEM_ID, FOOD_APPLE_ITEM_ID, FOOD_PIE_ITEM_ID } from '../src/game/consumables'

const SHOP = normalizeTradeRequest({
    title: 'Field Supplies',
    items: [{
        id: 'arrows.bundle',
        name: 'Arrow bundle',
        resource: 'arrows',
        unitSize: 5,
        buyPrice: 3,
        sellPrice: 1,
        stock: 4,
    }],
})

test('trade buy subtracts gold and grants bundled arrows', () => {
    const result = applyTradeSelection(SHOP, { gold: 10, arrows: 2 }, {
        action: 'buy',
        itemId: 'arrows.bundle',
        quantity: 2,
    })

    assert.deepEqual(result, {
        status: 'bought',
        itemId: 'arrows.bundle',
        itemName: 'Arrow bundle',
        quantity: 2,
        unitSize: 5,
        spent: { gold: 6 },
        gained: { arrows: 10 },
        inventory: { gold: 4, arrows: 12 },
    })
})

test('trade sell removes bundled arrows and grants gold', () => {
    const result = applyTradeSelection(SHOP, { gold: 2, arrows: 12 }, {
        action: 'sell',
        itemId: 'arrows.bundle',
        quantity: 2,
    })

    assert.deepEqual(result, {
        status: 'sold',
        itemId: 'arrows.bundle',
        itemName: 'Arrow bundle',
        quantity: 2,
        unitSize: 5,
        gained: { gold: 2 },
        removed: { arrows: 10 },
        inventory: { gold: 4, arrows: 2 },
    })
})

test('trade rejects unaffordable buys without mutating inventory', () => {
    const result = applyTradeSelection(SHOP, { gold: 2, arrows: 0 }, {
        action: 'buy',
        itemId: 'arrows.bundle',
        quantity: 1,
    })

    assert.equal(result.status, 'unavailable')
    assert.deepEqual(result.inventory, { gold: 2, arrows: 0 })
})

test('trade rejects selling more bundles than the player owns', () => {
    const result = applyTradeSelection(SHOP, { gold: 0, arrows: 4 }, {
        action: 'sell',
        itemId: 'arrows.bundle',
        quantity: 1,
    })

    assert.equal(result.status, 'unavailable')
    assert.deepEqual(result.inventory, { gold: 0, arrows: 4 })
})

test('trade availability respects stock, gold, and inventory capacity', () => {
    const item = SHOP.items[0]!
    assert.equal(tradeAvailability(item, 'buy', { gold: 99, arrows: 0 }).maxQuantity, 4)
    assert.equal(tradeAvailability(item, 'buy', { gold: 5, arrows: 0 }).maxQuantity, 1)
    assert.equal(tradeAvailability(item, 'sell', { gold: 0, arrows: 14 }).maxQuantity, 2)
    assert.equal(tradeAvailability(item, 'sell', { gold: 999999, arrows: 14 }).maxQuantity, 0)
})

test('trade buy and sell can mutate durable healing potions', () => {
    const shop = normalizeTradeRequest({
        title: 'Field Supplies',
        items: [{
            id: 'heal-potion',
            name: 'Healing Potion',
            resource: 'heal-potion',
            unitSize: 1,
            buyPrice: 5,
            sellPrice: 2,
        }],
    })

    const bought = applyTradeSelection(shop, { gold: 12, arrows: 0, items: {} }, {
        action: 'buy',
        itemId: 'heal-potion',
        quantity: 2,
    })

    if (bought.status !== 'bought') throw new Error(`expected bought, got ${bought.status}`)
    assert.equal(bought.inventory.items?.['heal-potion']?.quantity, 2)
    assert.deepEqual(bought.gained, { 'heal-potion': 2 })

    const sold = applyTradeSelection(shop, bought.inventory, {
        action: 'sell',
        itemId: 'heal-potion',
        quantity: 1,
    })

    if (sold.status !== 'sold') throw new Error(`expected sold, got ${sold.status}`)
    assert.equal(sold.inventory.items?.['heal-potion']?.quantity, 1)
    assert.deepEqual(sold.removed, { 'heal-potion': 1 })
})

test('trade buy and sell can mutate durable mana potions', () => {
    const shop = normalizeTradeRequest({
        title: 'Field Supplies',
        items: [{
            id: MANA_POTION_ITEM_ID,
            name: 'Mana Potion',
            resource: MANA_POTION_ITEM_ID,
            unitSize: 1,
            buyPrice: 6,
            sellPrice: 3,
        }],
    })

    const bought = applyTradeSelection(shop, { gold: 12, arrows: 0, items: {} }, {
        action: 'buy',
        itemId: MANA_POTION_ITEM_ID,
        quantity: 2,
    })

    if (bought.status !== 'bought') throw new Error(`expected bought, got ${bought.status}`)
    assert.equal(bought.inventory.items?.[MANA_POTION_ITEM_ID]?.quantity, 2)
    assert.equal(bought.inventory.items?.[MANA_POTION_ITEM_ID]?.icon, 'mana-potion')
    assert.deepEqual(bought.gained, { [MANA_POTION_ITEM_ID]: 2 })

    const sold = applyTradeSelection(shop, bought.inventory, {
        action: 'sell',
        itemId: MANA_POTION_ITEM_ID,
        quantity: 1,
    })

    if (sold.status !== 'sold') throw new Error(`expected sold, got ${sold.status}`)
    assert.equal(sold.inventory.items?.[MANA_POTION_ITEM_ID]?.quantity, 1)
    assert.deepEqual(sold.removed, { [MANA_POTION_ITEM_ID]: 1 })
})

test('trade buy and sell can mutate food and dynamite consumables', () => {
    const shop = normalizeTradeRequest({
        title: 'Consumables',
        items: [{
            id: FOOD_APPLE_ITEM_ID,
            name: 'Apple',
            resource: FOOD_APPLE_ITEM_ID,
            unitSize: 1,
            buyPrice: 2,
            sellPrice: 1,
        }, {
            id: FOOD_PIE_ITEM_ID,
            name: 'Meat Pie',
            resource: FOOD_PIE_ITEM_ID,
            unitSize: 1,
            buyPrice: 5,
            sellPrice: 2,
        }, {
            id: DYNAMITE_ITEM_ID,
            name: 'Dynamite',
            resource: DYNAMITE_ITEM_ID,
            unitSize: 1,
            buyPrice: 12,
            sellPrice: 5,
        }],
    })

    const apple = applyTradeSelection(shop, { gold: 30, arrows: 0, items: {} }, {
        action: 'buy',
        itemId: FOOD_APPLE_ITEM_ID,
        quantity: 2,
    })
    if (apple.status !== 'bought') throw new Error(`expected bought, got ${apple.status}`)
    assert.equal(apple.inventory.items?.[FOOD_APPLE_ITEM_ID]?.quantity, 2)
    assert.equal(apple.inventory.items?.[FOOD_APPLE_ITEM_ID]?.category, 'consumables')
    assert.equal(apple.inventory.items?.[FOOD_APPLE_ITEM_ID]?.icon, 'food-apple')

    const dynamite = applyTradeSelection(shop, apple.inventory, {
        action: 'buy',
        itemId: DYNAMITE_ITEM_ID,
        quantity: 1,
    })
    if (dynamite.status !== 'bought') throw new Error(`expected bought, got ${dynamite.status}`)
    assert.equal(dynamite.inventory.items?.[DYNAMITE_ITEM_ID]?.quantity, 1)
    assert.equal(dynamite.inventory.items?.[DYNAMITE_ITEM_ID]?.icon, 'dynamite')

    const sold = applyTradeSelection(shop, dynamite.inventory, {
        action: 'sell',
        itemId: FOOD_APPLE_ITEM_ID,
        quantity: 1,
    })
    if (sold.status !== 'sold') throw new Error(`expected sold, got ${sold.status}`)
    assert.equal(sold.inventory.items?.[FOOD_APPLE_ITEM_ID]?.quantity, 1)
    assert.deepEqual(sold.removed, { [FOOD_APPLE_ITEM_ID]: 1 })
})

test('trade buy and sell can mutate unique high jump boots', () => {
    const shop = normalizeTradeRequest({
        title: 'Field Supplies',
        items: [{
            id: HIGH_JUMP_BOOTS_ITEM_ID,
            name: 'High Jump Boots',
            resource: HIGH_JUMP_BOOTS_ITEM_ID,
            unitSize: 1,
            buyPrice: 10,
            sellPrice: 5,
        }],
    })
    const item = shop.items[0]!

    const bought = applyTradeSelection(shop, { gold: 12, arrows: 0, items: {} }, {
        action: 'buy',
        itemId: HIGH_JUMP_BOOTS_ITEM_ID,
        quantity: 1,
    })

    if (bought.status !== 'bought') throw new Error(`expected bought, got ${bought.status}`)
    assert.equal(bought.inventory.items?.[HIGH_JUMP_BOOTS_ITEM_ID]?.quantity, 1)
    assert.deepEqual(bought.gained, { [HIGH_JUMP_BOOTS_ITEM_ID]: 1 })
    assert.equal(tradeAvailability(item, 'buy', bought.inventory).maxQuantity, 0)

    const sold = applyTradeSelection(shop, bought.inventory, {
        action: 'sell',
        itemId: HIGH_JUMP_BOOTS_ITEM_ID,
        quantity: 1,
    })

    if (sold.status !== 'sold') throw new Error(`expected sold, got ${sold.status}`)
    assert.equal(sold.inventory.items?.[HIGH_JUMP_BOOTS_ITEM_ID], undefined)
    assert.deepEqual(sold.removed, { [HIGH_JUMP_BOOTS_ITEM_ID]: 1 })
})

test('trade buy and sell can mutate unique high speed boots', () => {
    const shop = normalizeTradeRequest({
        title: 'Field Supplies',
        items: [{
            id: HIGH_SPEED_BOOTS_ITEM_ID,
            name: 'Boots of High Speed',
            resource: HIGH_SPEED_BOOTS_ITEM_ID,
            unitSize: 1,
            buyPrice: 12,
            sellPrice: 6,
        }],
    })
    const item = shop.items[0]!

    const bought = applyTradeSelection(shop, { gold: 12, arrows: 0, items: {} }, {
        action: 'buy',
        itemId: HIGH_SPEED_BOOTS_ITEM_ID,
        quantity: 1,
    })

    if (bought.status !== 'bought') throw new Error(`expected bought, got ${bought.status}`)
    assert.equal(bought.inventory.items?.[HIGH_SPEED_BOOTS_ITEM_ID]?.quantity, 1)
    assert.deepEqual(bought.gained, { [HIGH_SPEED_BOOTS_ITEM_ID]: 1 })
    assert.equal(tradeAvailability(item, 'buy', bought.inventory).maxQuantity, 0)

    const sold = applyTradeSelection(shop, bought.inventory, {
        action: 'sell',
        itemId: HIGH_SPEED_BOOTS_ITEM_ID,
        quantity: 1,
    })

    if (sold.status !== 'sold') throw new Error(`expected sold, got ${sold.status}`)
    assert.equal(sold.inventory.items?.[HIGH_SPEED_BOOTS_ITEM_ID], undefined)
    assert.deepEqual(sold.removed, { [HIGH_SPEED_BOOTS_ITEM_ID]: 1 })
})

test('trade buy and sell can mutate unique shop equipment', () => {
    const shop = normalizeTradeRequest({
        title: 'Forge',
        items: [{
            id: SPEAR_ITEM_ID,
            name: 'Spear',
            resource: SPEAR_ITEM_ID,
            unitSize: 1,
            buyPrice: 18,
            sellPrice: 8,
        }, {
            id: SNIPER_HAT_ITEM_ID,
            name: 'Sniper Hat',
            resource: SNIPER_HAT_ITEM_ID,
            unitSize: 1,
            buyPrice: 18,
            sellPrice: 8,
        }, {
            id: METAL_HELMET_ITEM_ID,
            name: 'Metal Helmet',
            resource: METAL_HELMET_ITEM_ID,
            unitSize: 1,
            buyPrice: 14,
            sellPrice: 6,
        }],
    })

    const spear = applyTradeSelection(shop, { gold: 60, arrows: 0, items: {} }, {
        action: 'buy',
        itemId: SPEAR_ITEM_ID,
        quantity: 1,
    })

    if (spear.status !== 'bought') throw new Error(`expected bought, got ${spear.status}`)
    assert.equal(spear.inventory.items?.[SPEAR_ITEM_ID]?.quantity, 1)
    assert.equal(spear.inventory.items?.[SPEAR_ITEM_ID]?.category, 'tools')
    assert.equal(spear.inventory.items?.[SPEAR_ITEM_ID]?.icon, 'spear')
    assert.equal(tradeAvailability(shop.items[0]!, 'buy', spear.inventory).maxQuantity, 0)

    const sniper = applyTradeSelection(shop, spear.inventory, {
        action: 'buy',
        itemId: SNIPER_HAT_ITEM_ID,
        quantity: 1,
    })

    if (sniper.status !== 'bought') throw new Error(`expected bought, got ${sniper.status}`)
    assert.equal(sniper.inventory.items?.[SNIPER_HAT_ITEM_ID]?.quantity, 1)
    assert.equal(sniper.inventory.items?.[SNIPER_HAT_ITEM_ID]?.category, 'accessories')
    assert.equal(sniper.inventory.items?.[SNIPER_HAT_ITEM_ID]?.icon, 'hat-sniper')

    const helmet = applyTradeSelection(shop, sniper.inventory, {
        action: 'buy',
        itemId: METAL_HELMET_ITEM_ID,
        quantity: 1,
    })

    if (helmet.status !== 'bought') throw new Error(`expected bought, got ${helmet.status}`)
    assert.equal(helmet.inventory.items?.[METAL_HELMET_ITEM_ID]?.quantity, 1)
    assert.equal(helmet.inventory.items?.[METAL_HELMET_ITEM_ID]?.category, 'accessories')
    assert.equal(helmet.inventory.items?.[METAL_HELMET_ITEM_ID]?.icon, 'metal-helmet')

    const sold = applyTradeSelection(shop, helmet.inventory, {
        action: 'sell',
        itemId: SPEAR_ITEM_ID,
        quantity: 1,
    })

    if (sold.status !== 'sold') throw new Error(`expected sold, got ${sold.status}`)
    assert.equal(sold.inventory.items?.[SPEAR_ITEM_ID], undefined)
    assert.deepEqual(sold.removed, { [SPEAR_ITEM_ID]: 1 })
})

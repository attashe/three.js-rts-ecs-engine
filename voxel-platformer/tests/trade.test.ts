import test from 'node:test'
import assert from 'node:assert/strict'
import {
    applyTradeSelection,
    normalizeTradeRequest,
    tradeAvailability,
} from '../src/game/trade'
import { HIGH_JUMP_BOOTS_ITEM_ID } from '../src/game/high-jump-boots'

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

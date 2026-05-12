import test from 'node:test'
import assert from 'node:assert/strict'
import {
    activePlayerWeaponDef,
    createInventoryItem,
    getAllItemDefs,
    getItemDef,
    populateDefaultPlayerLoadout,
    recomputePlayerStats,
} from '../src/client/game/items'
import { createGameWorld, loadoutSlot } from '../src/client/engine/ecs/world'

test('item registry exposes the authored catalog and rejects unknown ids', () => {
    assert.ok(getAllItemDefs().length >= 10, 'registry should be populated at module load')
    assert.equal(getItemDef('training-sword')?.weapon?.damage, 25)
    assert.equal(getItemDef('hunter-bow')?.weapon?.damage, 18)
    assert.equal(getItemDef('hunter-bow')?.weapon?.speedBonus, 6)
    assert.equal(getItemDef('tunic')?.armor?.defense, 3)
    assert.equal(getItemDef('round-shield')?.armor?.defense, 2)
    assert.equal(getItemDef('air-push')?.spell?.cost, 20)
    assert.equal(getItemDef('does-not-exist'), null)
})

test('createInventoryItem snapshots the registry def, honouring count when given', () => {
    const sword = createInventoryItem('training-sword')
    assert.equal(sword.id, 'training-sword')
    assert.equal(sword.label, 'Sword')
    assert.equal(sword.category, 'weapon')
    assert.equal(sword.equipSlot, 'weapon')
    assert.equal(sword.loadoutKind, 'sword')
    assert.equal(sword.count, undefined)

    const potions = createInventoryItem('health-potion', 4)
    assert.equal(potions.count, 4)
    assert.equal(potions.equipSlot, undefined, 'consumables have no equip slot')
})

test('createInventoryItem throws for unknown ids so typos surface at the call site', () => {
    assert.throws(() => createInventoryItem('imaginary-axe'), /Unknown item id/)
})

test('populateDefaultPlayerLoadout fills weapon, armor, and backpack slots from the registry', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    const loadout = world.playerLoadout

    assert.equal(loadout.activeSlot, 0)
    assert.equal(loadout.weaponSlots.length, 4)
    assert.equal(loadout.weaponSlots[0]?.kind, 'sword')
    assert.equal(loadout.weaponSlots[1]?.kind, 'bow')
    assert.equal(loadout.weaponSlots[2]?.kind, 'airPush')
    assert.equal(loadout.weaponSlots[3]?.kind, 'highJump')

    const chest = loadout.armorySlots.find((slot) => slot.slot === 'chest')
    assert.equal(chest?.item?.id, 'tunic')

    const head = loadout.armorySlots.find((slot) => slot.slot === 'head')
    assert.equal(head?.item, null, 'helm is in the backpack, not equipped by default')

    const potion = loadout.backpackSlots.find((slot) => slot?.id === 'health-potion')
    assert.equal(potion?.count, 2)
})

test('recomputePlayerStats sums defense and weight from equipped armor', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)

    // Default kit: tunic (3) + gloves (1) + boots (1) + shield (2) = 7 defense
    assert.equal(world.playerStats.defense, 7)
    // weight = 2 + 0.5 + 0.8 + 1.5 = 4.8 → multiplier = 1 - 0.025 * 4.8 = 0.88
    assert.ok(Math.abs(world.playerStats.moveSpeedMult - 0.88) < 1e-6,
        `expected mult ≈ 0.88, got ${world.playerStats.moveSpeedMult}`)

    // Pop the chest piece.
    const chest = world.playerLoadout.armorySlots.find((slot) => slot.slot === 'chest')!
    chest.item = null
    recomputePlayerStats(world)
    assert.equal(world.playerStats.defense, 4)
    assert.ok(Math.abs(world.playerStats.weight - 2.8) < 1e-6)
})

test('recomputePlayerStats clamps the speed multiplier at 0.6 so heavy loadouts still move', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    // Force a comically heavy charm so the multiplier wants to go negative.
    const charm = world.playerLoadout.armorySlots.find((slot) => slot.slot === 'charm')!
    charm.item = { id: 'wind-charm', category: 'armor', label: 'Wind charm', icon: 'CR', equipSlot: 'charm' }
    world.playerStats.weight = 100 // simulate runaway weight
    recomputePlayerStats(world)
    assert.ok(world.playerStats.moveSpeedMult >= 0.6 - 1e-9,
        `multiplier should not drop below 0.6 floor; got ${world.playerStats.moveSpeedMult}`)
})

test('activePlayerWeaponDef returns the def for the slot pointed at by activeSlot', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    assert.equal(activePlayerWeaponDef(world)?.id, 'training-sword')

    world.playerLoadout.activeSlot = 1
    assert.equal(activePlayerWeaponDef(world)?.id, 'hunter-bow')

    // Empty slot — no def.
    world.playerLoadout.weaponSlots[1] = loadoutSlot(null)
    assert.equal(activePlayerWeaponDef(world), null)
})

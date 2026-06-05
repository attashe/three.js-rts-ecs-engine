import test from 'node:test'
import assert from 'node:assert/strict'
import { actionKeyLabel, consumableUseLabel } from '../src/game/consumable-prompts'

test('consumable prompt uses the active action binding label', () => {
    assert.equal(consumableUseLabel(['F'], 'Healing Potion'), 'F to use Healing Potion')
    assert.equal(consumableUseLabel(['Q', 'Mouse4'], 'Dynamite'), 'Q / Mouse4 to use Dynamite')
})

test('consumable prompt falls back when the action has no display binding', () => {
    assert.equal(actionKeyLabel([]), 'Use button')
    assert.equal(consumableUseLabel([], 'Mana Potion'), 'Use button to use Mana Potion')
})

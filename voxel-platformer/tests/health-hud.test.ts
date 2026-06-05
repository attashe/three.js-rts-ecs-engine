import test from 'node:test'
import assert from 'node:assert/strict'
import { heartFractions } from '../src/game/health-hud-system'
import { manaFractions } from '../src/game/mana-hud-system'
import { HP_PER_HEART } from '../src/engine/ecs/combat'
import { PLAYER_DEFAULT_MAX_HEALTH } from '../src/game/player'
import { MANA_PER_ORB, PLAYER_DEFAULT_MAX_MANA } from '../src/game/mana'

test('player starts with two full hearts', () => {
    assert.equal(HP_PER_HEART, 2)
    assert.equal(PLAYER_DEFAULT_MAX_HEALTH, 4)
    assert.deepEqual(heartFractions(4, 4), [1, 1])
})

test('player mana starts as four full blue orbs', () => {
    assert.equal(MANA_PER_ORB, 2)
    assert.equal(PLAYER_DEFAULT_MAX_MANA, 8)
    assert.deepEqual(manaFractions(8, 8), [1, 1, 1, 1])
})

test('mana orbs deplete in half-orb steps', () => {
    assert.deepEqual(manaFractions(7, 8), [1, 1, 1, 0.5])
    assert.deepEqual(manaFractions(5, 8), [1, 1, 0.5, 0])
    assert.deepEqual(manaFractions(1, 8), [0.5, 0, 0, 0])
    assert.deepEqual(manaFractions(0, 8), [0, 0, 0, 0])
})

test('hearts deplete in half-heart steps', () => {
    assert.deepEqual(heartFractions(3, 4), [1, 0.5], 'one hit = half a heart off')
    assert.deepEqual(heartFractions(2, 4), [1, 0], 'two hits = one full heart gone')
    assert.deepEqual(heartFractions(1, 4), [0.5, 0])
    assert.deepEqual(heartFractions(0, 4), [0, 0], 'four half-heart hits empties the pool')
})

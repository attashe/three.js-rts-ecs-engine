import test from 'node:test'
import assert from 'node:assert/strict'
import { heartFractions } from '../src/game/health-hud-system'
import { HP_PER_HEART } from '../src/engine/ecs/combat'
import { PLAYER_DEFAULT_MAX_HEALTH } from '../src/game/player'

test('player starts with two full hearts', () => {
    assert.equal(HP_PER_HEART, 2)
    assert.equal(PLAYER_DEFAULT_MAX_HEALTH, 4)
    assert.deepEqual(heartFractions(4, 4), [1, 1])
})

test('hearts deplete in half-heart steps', () => {
    assert.deepEqual(heartFractions(3, 4), [1, 0.5], 'one hit = half a heart off')
    assert.deepEqual(heartFractions(2, 4), [1, 0], 'two hits = one full heart gone')
    assert.deepEqual(heartFractions(1, 4), [0.5, 0])
    assert.deepEqual(heartFractions(0, 4), [0, 0], 'four half-heart hits empties the pool')
})

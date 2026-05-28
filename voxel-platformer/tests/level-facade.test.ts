import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLevelFacade, type LevelInfo } from '../src/game/script-level-facade'

function info(): LevelInfo {
    return { name: 'demo', size: 24, spawn: { x: 5, y: 6, z: 7 } }
}

test('buildLevelFacade.getSpawn returns a fresh object on every call', () => {
    const source = info()
    const facade = buildLevelFacade(source)
    const a = facade.getSpawn()
    const b = facade.getSpawn()
    assert.notEqual(a, b, 'each read should be a fresh allocation')
    assert.deepEqual(a, source.spawn)
})

test('buildLevelFacade.getSpawn shields the underlying LevelInfo from mutation', () => {
    const source = info()
    const facade = buildLevelFacade(source)
    const snapshot = facade.getSpawn()
    snapshot.x = 999
    assert.equal(source.spawn.x, 5, 'mutating the returned object must not leak into the source')
    assert.equal(facade.getSpawn().x, 5, 'next read still reflects the underlying source')
})

test('buildLevelFacade forwards size and name without copying primitive values', () => {
    const source = info()
    const facade = buildLevelFacade(source)
    assert.equal(facade.getSize(), 24)
    assert.equal(facade.getName(), 'demo')
})

test('buildLevelFacade is a live view: later writes to LevelInfo are reflected', () => {
    const source = info()
    const facade = buildLevelFacade(source)
    source.spawn.y = 42
    assert.equal(facade.getSpawn().y, 42, 'facade reads through to the source — it is not a snapshot')
})

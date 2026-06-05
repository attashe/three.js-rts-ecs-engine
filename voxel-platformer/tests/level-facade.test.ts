import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLevelFacade, type LevelInfo } from '../src/game/script-level-facade'
import { levelMetaWithSpawn, type LevelMeta } from '../src/game/level'
import { DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'

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

test('levelMetaWithSpawn overrides runtime spawn without mutating authored metadata', () => {
    const source = minimalLevelMeta({ x: 1, y: 2, z: 3 })
    const runtime = levelMetaWithSpawn(source, { x: 9, y: 8, z: 7 })
    assert.deepEqual(runtime.spawn, { x: 9, y: 8, z: 7 })
    assert.deepEqual(source.spawn, { x: 1, y: 2, z: 3 })
    assert.equal(runtime.zones, source.zones, 'large immutable level arrays should stay shared')
})

function minimalLevelMeta(spawn: LevelMeta['spawn']): LevelMeta {
    return {
        name: 'test',
        spawn,
        player: DEFAULT_PLAYER_SETTINGS,
        stoneSpawners: [],
        stones: [],
        coinPiles: [],
        pistons: [],
        zones: [],
        soundSources: [],
        railCarts: [],
        chests: [],
        soundZones: [],
        weatherZones: [],
        props: [],
        npcs: [],
        scripts: [],
        size: 16,
    }
}

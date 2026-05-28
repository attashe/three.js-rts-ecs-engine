import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE, BLOCK } from '../src/engine/voxel/palette'
import { terrain } from '../src/game/level-builder/terrain'
import { defineLevel, outdoorDay, zoneBox, interactZone } from '../src/game/level-builder/meta'
import { anyMask, circle, fbmNoise2D, pathMask, rect, subtractMask, valueNoise2D } from '../src/game/level-builder/masks'
import { DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'
import { DEFAULT_OUTDOOR_FOG_DENSITY_MUL } from '../src/game/weather-config'

function freshTerrain(size = 8, groundY = 4) {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    return { chunks, t: terrain(chunks, { size, groundY }) }
}

test('ground lays base / soil / surface layers and nothing above', () => {
    const { chunks, t } = freshTerrain(4, 4)
    t.ground({ top: BLOCK.grass, soil: BLOCK.dirt, base: BLOCK.stone })

    for (let x = 0; x < 4; x++) {
        for (let z = 0; z < 4; z++) {
            assert.equal(chunks.getVoxel(x, 0, z), BLOCK.stone, 'base')
            assert.equal(chunks.getVoxel(x, 2, z), BLOCK.stone, 'base below soil')
            assert.equal(chunks.getVoxel(x, 3, z), BLOCK.dirt, 'soil at groundY-1')
            assert.equal(chunks.getVoxel(x, 4, z), BLOCK.grass, 'surface at groundY')
            assert.equal(chunks.getVoxel(x, 5, z), BLOCK.air, 'air above surface')
        }
    }
})

test('ground accepts a per-cell surface function', () => {
    const { chunks, t } = freshTerrain(4, 4)
    t.ground({ top: (x, z) => ((x + z) % 2 === 0 ? BLOCK.sand : BLOCK.grass) })
    assert.equal(chunks.getVoxel(0, 4, 0), BLOCK.sand)
    assert.equal(chunks.getVoxel(1, 4, 0), BLOCK.grass)
    assert.equal(chunks.getVoxel(2, 4, 0), BLOCK.sand)
})

test('fill is inclusive on both ends and order-independent', () => {
    const { chunks, t } = freshTerrain()
    t.fill([2, 0], [1, 1], [0, 2], BLOCK.brick) // reversed x span
    for (let x = 0; x <= 2; x++) {
        for (let z = 0; z <= 2; z++) {
            assert.equal(chunks.getVoxel(x, 1, z), BLOCK.brick)
        }
    }
    assert.equal(chunks.getVoxel(3, 1, 0), BLOCK.air, 'outside the span stays air')
})

test('clear writes air', () => {
    const { chunks, t } = freshTerrain()
    t.set(1, 1, 1, BLOCK.stone)
    assert.equal(chunks.getVoxel(1, 1, 1), BLOCK.stone)
    t.clear(1, 1, 1)
    assert.equal(chunks.getVoxel(1, 1, 1), BLOCK.air)
})

test('stairs cap each tread and fill the riser underneath', () => {
    const { chunks, t } = freshTerrain(16, 4)
    // 3 steps, depth 2, width x in [6,8], starting at z=2, baseY = groundY+1 = 5
    t.stairs({ x: [6, 8], startZ: 2, steps: 3, depth: 2, block: BLOCK.plank, fillUnder: BLOCK.stone })

    // Step 0: tread at y=5, z in [2,3]; no riser (stepY == baseY).
    assert.equal(chunks.getVoxel(7, 5, 2), BLOCK.plank)
    assert.equal(chunks.getVoxel(7, 5, 3), BLOCK.plank)
    // Step 1: tread at y=6, z in [4,5]; riser stone at y=5.
    assert.equal(chunks.getVoxel(7, 6, 4), BLOCK.plank)
    assert.equal(chunks.getVoxel(7, 5, 4), BLOCK.stone, 'riser under step 1')
    // Step 2: tread at y=7, z in [6,7]; risers at y=5,6.
    assert.equal(chunks.getVoxel(7, 7, 6), BLOCK.plank)
    assert.equal(chunks.getVoxel(7, 5, 6), BLOCK.stone)
    assert.equal(chunks.getVoxel(7, 6, 6), BLOCK.stone)
})

test('platform fills a solid body and caps it with a surface', () => {
    const { chunks, t } = freshTerrain(16, 4)
    // body y in [5,7], cap at y=8
    t.platform({ x: [10, 12], z: [10, 12], topY: 8, top: BLOCK.grass, fill: BLOCK.stone })
    assert.equal(chunks.getVoxel(11, 5, 11), BLOCK.stone)
    assert.equal(chunks.getVoxel(11, 7, 11), BLOCK.stone)
    assert.equal(chunks.getVoxel(11, 8, 11), BLOCK.grass, 'cap')
    assert.equal(chunks.getVoxel(11, 9, 11), BLOCK.air)
})

test('stand and surface resolve frame-relative coordinates', () => {
    const { t } = freshTerrain(24, 4)
    assert.deepEqual(t.stand(12, 12), { x: 12, y: 5, z: 12 })
    assert.deepEqual(t.surface(8, 21), { x: 8, y: 4, z: 21 })
    assert.deepEqual(t.surface(8, 21, 4), { x: 8, y: 8, z: 21 })
    assert.equal(t.size, 24)
    assert.equal(t.groundY, 4)
})

test('heightfield writes variable columns and exposes height-aware coordinates', () => {
    const { chunks, t } = freshTerrain(5, 4)
    t.heightfield({
        heightAt: (x, z) => 3 + ((x + z) % 3),
        top: BLOCK.grass,
        soil: BLOCK.dirt,
        base: BLOCK.stone,
    })

    assert.equal(t.heightAt(1, 1), 5)
    assert.equal(chunks.getVoxel(1, 5, 1), BLOCK.grass)
    assert.equal(chunks.getVoxel(1, 4, 1), BLOCK.dirt)
    assert.equal(chunks.getVoxel(1, 0, 1), BLOCK.stone)
    assert.equal(chunks.getVoxel(1, 6, 1), BLOCK.air)
    assert.deepEqual(t.standAt(1.6, 1.2), { x: 1.6, y: 6, z: 1.2 })
    assert.deepEqual(t.surfaceAt(1.6, 1.2, -1), { x: 1.6, y: 4, z: 1.2 })
})

test('mask helpers compose deterministic terrain selections', () => {
    const c = circle({ x: 2, z: 2 }, 1.5)
    const r = rect([1, 3], [2, 2])
    const p = pathMask([{ x: 0, z: 0 }, { x: 4, z: 0 }], 3)
    const combined = subtractMask(anyMask(c, r), rect([2, 2], [2, 2]))

    assert.equal(c(2, 2), true)
    assert.equal(c(4, 2), false)
    assert.equal(r(3, 2), true)
    assert.equal(p(2, 1), true)
    assert.equal(p(2, 2), false)
    assert.equal(combined(1, 2), true)
    assert.equal(combined(2, 2), false)

    const valueNoise = valueNoise2D(123, 0.2)
    const fbm = fbmNoise2D({ seed: 123, frequency: 0.2, octaves: 3 })
    assert.equal(valueNoise(4, 7), valueNoise(4, 7))
    assert.equal(fbm(4, 7), fbm(4, 7))
})

test('mask edits raise, lower, paint paths, and carve ponds', () => {
    const { chunks, t } = freshTerrain(8, 4)
    t.ground({ top: BLOCK.grass })
    t.raise(rect([1, 1], [1, 1]), 2, { fill: BLOCK.dirt, top: BLOCK.grass })
    assert.equal(t.heightAt(1, 1), 6)
    assert.equal(chunks.getVoxel(1, 6, 1), BLOCK.grass)
    assert.equal(chunks.getVoxel(1, 4, 1), BLOCK.dirt, 'old surface is converted to fill when raised')

    t.lower(rect([1, 1], [1, 1]), 1, { top: BLOCK.sand })
    assert.equal(t.heightAt(1, 1), 5)
    assert.equal(chunks.getVoxel(1, 5, 1), BLOCK.sand)
    assert.equal(chunks.getVoxel(1, 6, 1), BLOCK.air)

    t.path({ points: [{ x: 0, z: 3 }, { x: 7, z: 3 }], width: 3, block: BLOCK.sand })
    assert.equal(chunks.getVoxel(4, 4, 3), BLOCK.sand)
    assert.equal(chunks.getVoxel(4, 4, 5), BLOCK.grass)

    t.pond({ center: { x: 4, z: 4 }, radius: 1.5, waterY: 4, shoreWidth: 1, shoreBlock: BLOCK.sand })
    assert.equal(chunks.getVoxel(4, 3, 4), BLOCK.sand)
    assert.equal(chunks.getVoxel(4, 4, 4), BLOCK.water)
    assert.equal(chunks.getVoxel(4, 5, 4), BLOCK.air)
    assert.equal(chunks.getVoxel(2, 4, 4), BLOCK.sand, 'shore')
})

test('fillWater skips bed writes below the world floor', () => {
    const { chunks, t } = freshTerrain(4, 0)
    t.ground({ top: BLOCK.grass })
    t.fillWater(rect([1, 1], [1, 1]), 0)

    assert.equal(chunks.getVoxel(1, -1, 1), BLOCK.air)
    assert.equal(chunks.getVoxel(1, 0, 1), BLOCK.water)
})

test('defineLevel fills empty defaults and keeps required fields', () => {
    const meta = defineLevel({ name: 'x', size: 24, spawn: { x: 1, y: 2, z: 3 } })
    assert.equal(meta.name, 'x')
    assert.equal(meta.size, 24)
    assert.deepEqual(meta.spawn, { x: 1, y: 2, z: 3 })
    assert.equal(meta.player, DEFAULT_PLAYER_SETTINGS)
    for (const field of ['stoneSpawners', 'stones', 'coinPiles', 'pistons', 'zones', 'soundSources', 'soundZones', 'weatherZones', 'props', 'npcs', 'scripts'] as const) {
        assert.deepEqual(meta[field], [], `${field} defaults to []`)
    }
    assert.equal(meta.environment, undefined)
    assert.equal(meta.ambientWeather, undefined)
})

test('defineLevel accepts `ambient` as an alias for ambientWeather', () => {
    const meta = defineLevel({ name: 'x', size: 1, spawn: { x: 0, y: 0, z: 0 }, ambient: outdoorDay({ timeOfDay: 16 }) })
    assert.equal(meta.ambientWeather?.state.timeOfDay, 16)
})

test('outdoorDay returns a clear animated outdoor day with overrides applied', () => {
    const day = outdoorDay()
    assert.equal(day.presetId, 'clear')
    assert.equal(day.state.mode, 'outdoor')
    assert.equal(day.state.timeOfDay, 8)
    assert.equal(day.state.cycleEnabled, true)
    assert.equal(day.state.cycleSeconds, 420)
    assert.equal(day.state.fogDensityMul, DEFAULT_OUTDOOR_FOG_DENSITY_MUL)
    assert.equal(day.state.rainOn, false)

    const dusk = outdoorDay({ timeOfDay: 16, sunIntensityMul: 0.95, cloudCoverage: 0.2 })
    assert.equal(dusk.state.timeOfDay, 16)
    assert.equal(dusk.state.sunIntensityMul, 0.95)
    assert.equal(dusk.state.cloudCoverage, 0.2)
    assert.equal(dusk.state.cycleSeconds, 420, 'untouched fields keep their defaults')
})

test('zoneBox derives min/max from a center and half-extents', () => {
    const box = zoneBox({ x: 10.5, z: 9.5 }, { x: 1.25, z: 1.25 }, 5, 7)
    assert.deepEqual(box.min, { x: 9.25, y: 5, z: 8.25 })
    assert.deepEqual(box.max, { x: 11.75, y: 7, z: 10.75 })
})

test('interactZone derives the AABB and anchor from one center', () => {
    const zone = interactZone({
        id: 'zone.demo.keeper',
        label: 'Keeper Arlen',
        center: { x: 10.5, z: 9.5 },
        half: { x: 1.25, z: 1.25 },
        yLo: 5,
        yHi: 7,
        prompt: 'Interaction',
        anchorDy: 1.16,
        radius: 2.45,
    })
    assert.equal(zone.kind, 'interact')
    assert.deepEqual(zone.min, { x: 9.25, y: 5, z: 8.25 })
    assert.deepEqual(zone.max, { x: 11.75, y: 7, z: 10.75 })
    assert.deepEqual(zone.interaction?.anchor, { x: 10.5, y: 6.16, z: 9.5 })
    assert.equal(zone.interaction?.prompt, 'Interaction')
    assert.equal(zone.interaction?.radius, 2.45)
})

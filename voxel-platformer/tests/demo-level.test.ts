import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { generatePlatformerLevel } from '../src/game/level'

test('demo level starts with an animated outdoor day cycle', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))

    assert.equal(meta.ambientWeather?.presetId, 'clear')
    assert.equal(meta.ambientWeather?.state.mode, 'outdoor')
    assert.equal(meta.ambientWeather?.state.cycleEnabled, true)
    assert.equal(meta.ambientWeather?.state.timeOfDay, 8)
    assert.equal(meta.ambientWeather?.state.fogDensityMul, 0.45)
    assert.equal(meta.ambientWeather?.state.rainOn, false)
    assert.equal(meta.ambientWeather?.state.lightningOn, false)
})

test('generatePlatformerLevel exposes a stable level name for the script engine', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    assert.equal(meta.name, 'demo')
    assert.equal(meta.size, 24)
})

test('demo sundial interaction prompt names the object and action clearly', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const sundial = meta.zones.find((zone) => zone.id === 'zone.demo.sundial')

    assert.equal(sundial?.label, 'Floating Sundial')
    assert.equal(sundial?.interaction?.prompt, 'Read Sundial')
    assert.ok(meta.props.some((prop) => prop.id === 'demo:sundial' && prop.kind === 'sundial'))
})

test('demo haste shrine is an interactable prop near the spawn plaza', () => {
    const meta = generatePlatformerLevel(new ChunkManager(DEFAULT_PALETTE))
    const shrine = meta.zones.find((zone) => zone.id === 'zone.demo.haste-shrine')

    assert.equal(shrine?.label, 'Shrine of Haste')
    assert.equal(shrine?.kind, 'interact')
    assert.equal(shrine?.interaction?.prompt, 'Invoke Haste')
    assert.ok(meta.props.some((prop) => prop.id === 'demo:haste-shrine' && prop.kind === 'haste-shrine'))
})

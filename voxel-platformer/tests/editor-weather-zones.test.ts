import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_AMBIENT_WEATHER, createEditorState, toLevelMeta, type EditorLevelMeta } from '../src/editor/editor-state'
import { GameAudio } from '../src/game/audio'
import { defaultSoundForPreset } from '../src/game/weather-config'
import { levelMetaFromEditor } from '../src/game/level-from-meta'

test('toLevelMeta serialises weather zones by value', () => {
    const state = createEditorState({ x: 1, y: 2, z: 3 })
    state.weatherZones.push({
        id: 'wz-1',
        label: 'campfire',
        presetId: 'fire',
        position: { x: 6, y: 5, z: 7 },
        size: { x: 3, y: 3, z: 3 },
        addSound: true,
        soundVolume: 0.55,
    })

    const meta = toLevelMeta(state, 'wz-test')
    assert.deepEqual(meta.weatherZones, [{
        id: 'wz-1',
        label: 'campfire',
        presetId: 'fire',
        position: { x: 6, y: 5, z: 7 },
        size: { x: 3, y: 3, z: 3 },
        addSound: true,
        soundId: undefined,
        soundVolume: 0.55,
    }])
    // Mutating the meta must not bleed into editor state.
    meta.weatherZones![0]!.position.x = 999
    assert.equal(state.weatherZones[0]!.position.x, 6)
})

test('toLevelMeta omits ambient weather when disabled', () => {
    const state = createEditorState({ x: 1, y: 2, z: 3 })
    const meta = toLevelMeta(state, 'ambient-test')
    assert.equal(meta.ambientWeather, undefined)
})

test('toLevelMeta serialises ambient weather snapshot when enabled', () => {
    const state = createEditorState({ x: 1, y: 2, z: 3 })
    state.ambientWeather = {
        enabled: true,
        presetId: 'storm',
        state: { ...DEFAULT_AMBIENT_WEATHER, fogDensity: 0.044, lightningOn: true },
    }
    const meta = toLevelMeta(state, 'ambient-test')
    assert.equal(meta.ambientWeather?.enabled, true)
    assert.equal(meta.ambientWeather?.presetId, 'storm')
    assert.equal(meta.ambientWeather?.state.fogDensity, 0.044)
    assert.equal(meta.ambientWeather?.state.lightningOn, true)
})

test('levelMetaFromEditor translates weather zones with default sound mapping', () => {
    const meta: EditorLevelMeta = {
        name: 'fx',
        spawn: { x: 0, y: 0, z: 0 },
        pickups: [],
        pistons: [],
        zones: [],
        weatherZones: [
            { id: 'a', presetId: 'rain', position: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 6, z: 10 }, addSound: true, soundVolume: 0.5 },
            { id: 'b', presetId: 'fire', position: { x: 5, y: 0, z: 5 }, size: { x: 3, y: 3, z: 3 }, addSound: false, soundVolume: 0.5 },
            { id: 'c', presetId: 'magic', position: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 }, addSound: true, soundVolume: 3, soundId: GameAudio.AmbWater },
        ],
    }
    const runtime = levelMetaFromEditor(meta, 32)
    assert.equal(runtime.weatherZones.length, 3)
    assert.equal(runtime.weatherZones[0]!.addSound, true)
    assert.equal(runtime.weatherZones[1]!.addSound, false)
    // Volume is clamped to [0, 1].
    assert.equal(runtime.weatherZones[2]!.soundVolume, 1)
    // soundId override is preserved.
    assert.equal(runtime.weatherZones[2]!.soundId, GameAudio.AmbWater)
})

test('defaultSoundForPreset maps presets to ambient bed assets', () => {
    assert.equal(defaultSoundForPreset('rain'), GameAudio.AmbRain)
    assert.equal(defaultSoundForPreset('storm'), GameAudio.AmbStorm)
    assert.equal(defaultSoundForPreset('fire'), GameAudio.AmbFire)
    assert.equal(defaultSoundForPreset('magic'), GameAudio.AmbMagic)
    assert.equal(defaultSoundForPreset('water'), GameAudio.AmbWater)
    assert.equal(defaultSoundForPreset('lava'), GameAudio.AmbLava)
    // Explosion is intentionally unmapped — caller skips the loop.
    assert.equal(defaultSoundForPreset('explosion'), null)
    // Unknown preset falls through to null so the caller skips audio.
    assert.equal(defaultSoundForPreset('nope'), null)
})

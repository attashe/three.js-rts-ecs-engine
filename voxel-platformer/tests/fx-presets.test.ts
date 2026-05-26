import test from 'node:test'
import assert from 'node:assert/strict'
import { ZONE_PRESETS, applyZonePreset } from '../src/engine/fx/presets/zone-presets'
import { WEATHER_PRESETS } from '../src/engine/fx/presets/weather-presets'

test('every zone preset round-trips through applyZonePreset with no missing fields', () => {
    for (const key of Object.keys(ZONE_PRESETS)) {
        const params = applyZonePreset(key as keyof typeof ZONE_PRESETS)
        // The merged params must have a full schema — these are the
        // fields the WeatherSystem relies on.
        for (const field of ['type', 'name', 'color', 'position', 'size', 'count', 'particleSize', 'opacity', 'speed', 'turbulence', 'windX', 'windZ', 'gravity', 'lifetime', 'streaks', 'streakLength', 'lightEnabled', 'lightColor', 'lightIntensity', 'lightDistance', 'lightning']) {
            assert.ok((field in params), `${key} missing ${field}`)
        }
        // Particle-less effects (darkness, future ambient-only zones)
        // are valid; only the schema needs to be complete.
        assert.ok(params.count >= 0, `${key} count must be non-negative`)
        assert.ok(params.size.x > 0 && params.size.y > 0 && params.size.z > 0, `${key} size must be positive`)
    }
})

test('applyZonePreset honors overrides without mutating the preset object', () => {
    const before = JSON.stringify(ZONE_PRESETS.fire!.params)
    const merged = applyZonePreset('fire', { position: { x: 10, y: 2, z: -4 }, opacity: 0.5 })
    assert.equal(merged.position.x, 10)
    assert.equal(merged.opacity, 0.5)
    assert.equal(merged.type, 'fire')
    assert.equal(before, JSON.stringify(ZONE_PRESETS.fire!.params), 'preset object unchanged')
})

test('applyZonePreset throws on unknown id', () => {
    assert.throws(() => applyZonePreset('not-a-preset' as keyof typeof ZONE_PRESETS), /Unknown zone preset/)
})

test('weather presets exist for every label the demo expected', () => {
    for (const expected of ['clear', 'cloudy', 'rain', 'storm', 'snow', 'dawn']) {
        assert.ok(WEATHER_PRESETS[expected], `missing weather preset: ${expected}`)
    }
})

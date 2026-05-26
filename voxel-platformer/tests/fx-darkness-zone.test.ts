import test from 'node:test'
import assert from 'node:assert/strict'
import { Color, PointLight } from 'three'
import { ZONE_PRESETS, applyZonePreset } from '../src/engine/fx/presets/zone-presets'
import { modulateZoneLight } from '../src/engine/fx/lights/fx-light-controller'
import type { WeatherZoneParams, WeatherZoneRuntime } from '../src/engine/fx/core/types'

/** Minimal runtime stub — only the fields `modulateZoneLight` reads. */
function makeRuntime(params: WeatherZoneParams): WeatherZoneRuntime {
    const light = new PointLight(new Color(params.lightColor), params.lightIntensity, params.lightDistance, 2)
    light.userData = { wanted: params.lightIntensity }
    return {
        params,
        elapsed: 0,
        particles: { count: 0, capacity: 0, positions: new Float32Array(), velocities: new Float32Array(), phases: new Float32Array(), ages: new Float32Array(), lifetimes: new Float32Array(), seeds: new Float32Array(), sizes: new Float32Array() },
        primary: null,
        extras: [],
        light,
        surface: null,
        surfaceOverlay: null,
        events: [],
        seed: 1,
        visible: true,
        dirty: false,
        findExtra: () => undefined,
    } as WeatherZoneRuntime
}

test('darkness preset is registered with magnitude (positive) lightIntensity', () => {
    const preset = ZONE_PRESETS.darkness
    assert.ok(preset, 'darkness preset must exist')
    const params = preset!.params as WeatherZoneParams
    assert.equal(params.type, 'darkness')
    // Authoring contract: the preset publishes a positive magnitude;
    // the controller flips the sign at runtime.
    assert.ok(params.lightIntensity > 0, 'darkness preset lightIntensity must be a positive magnitude')
    assert.equal(params.lightEnabled, true)
    assert.equal(params.count, 0, 'darkness has no particles')
})

test('applyZonePreset("darkness") merges position/size overrides', () => {
    const params = applyZonePreset('darkness', {
        position: { x: 4, y: 2, z: -7 },
        size: { x: 6, y: 4, z: 6 },
    })
    assert.equal(params.type, 'darkness')
    assert.equal(params.position.x, 4)
    assert.equal(params.position.y, 2)
    assert.equal(params.position.z, -7)
    assert.equal(params.size.x, 6)
    assert.equal(params.size.y, 4)
    assert.equal(params.size.z, 6)
})

test('modulateZoneLight renders darkness as negative intensity (the "anti-light")', () => {
    const params = applyZonePreset('darkness')
    const runtime = makeRuntime(params)

    modulateZoneLight(runtime, 0)
    assert.ok(runtime.light.intensity < 0,
        'darkness zone light intensity must be negative — that is the whole effect')

    // The base magnitude is positive on the params, but the controller
    // negates + applies a gentle breathing modulator. Confirm the
    // absolute value sits within a sensible band of the authored magnitude.
    const magnitude = Math.abs(runtime.light.intensity)
    const authored = params.lightIntensity
    assert.ok(magnitude > authored * 0.7 && magnitude < authored * 1.1,
        `darkness magnitude ${magnitude} should hover near authored ${authored}`)

    // Stays negative across the breathing cycle.
    for (let t = 0; t < 12; t += 0.5) {
        modulateZoneLight(runtime, t)
        assert.ok(runtime.light.intensity < 0, `intensity should stay negative at t=${t}`)
    }
})

test('modulateZoneLight returns 0 intensity for darkness with lightEnabled=false', () => {
    const params = applyZonePreset('darkness', { lightEnabled: false })
    const runtime = makeRuntime(params)
    modulateZoneLight(runtime, 1.5)
    assert.equal(runtime.light.intensity, 0)
})

test('modulateZoneLight does not turn other zone types negative', () => {
    // Sanity: the sign-flip only applies to darkness. A fire zone with
    // the same authored magnitude must still report positive intensity.
    const params = applyZonePreset('fire')
    const runtime = makeRuntime(params)
    modulateZoneLight(runtime, 0.4)
    assert.ok(runtime.light.intensity > 0)
})

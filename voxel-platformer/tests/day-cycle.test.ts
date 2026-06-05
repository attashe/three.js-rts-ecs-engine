import test from 'node:test'
import assert from 'node:assert/strict'
import {
    DAY_CYCLE_PRESET_HOURS,
    DAY_CYCLE_STOPS,
    formatHourLabel,
    sampleDayCycle,
} from '../src/engine/fx/core/day-cycle'

test('sampleDayCycle returns the exact stop palette at every canonical hour', () => {
    for (const stop of DAY_CYCLE_STOPS) {
        const out = sampleDayCycle(stop.hour)
        assert.deepEqual(out.skyTop, stop.skyTop, `sky top mismatch at ${stop.hour}`)
        assert.deepEqual(out.skyBottom, stop.skyBottom, `sky bottom mismatch at ${stop.hour}`)
        assert.deepEqual(out.fogColor, stop.fogColor, `fog mismatch at ${stop.hour}`)
        assert.equal(out.fogDensity, stop.fogDensity, `fog density at ${stop.hour}`)
        assert.deepEqual(out.sunColor, stop.sunColor, `sun colour at ${stop.hour}`)
        assert.equal(out.sunIntensity, stop.sunIntensity, `sun intensity at ${stop.hour}`)
        assert.equal(out.ambientIntensity, stop.ambientIntensity, `ambient intensity at ${stop.hour}`)
        assert.equal(out.hemiIntensity, stop.hemiIntensity, `hemi intensity at ${stop.hour}`)
    }
})

test('sampleDayCycle lerps midway between adjacent stops', () => {
    // Between noon (12) and dusk (17.5) — midpoint hour 14.75
    const noon = DAY_CYCLE_STOPS.find((s) => s.hour === 12)!
    const dusk = DAY_CYCLE_STOPS.find((s) => s.hour === 17.5)!
    const mid = sampleDayCycle((noon.hour + dusk.hour) / 2)
    const expected = (a: number, b: number) => (a + b) / 2
    assert.ok(Math.abs(mid.sunIntensity - expected(noon.sunIntensity, dusk.sunIntensity)) < 1e-6)
    assert.ok(Math.abs(mid.fogDensity - expected(noon.fogDensity, dusk.fogDensity)) < 1e-6)
    for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(mid.sunColor[i]! - expected(noon.sunColor[i]!, dusk.sunColor[i]!)) < 1e-6, `sunColor[${i}]`)
    }
})

test('sampleDayCycle wraps around midnight (22 → 0 → 5)', () => {
    // Stops bracketing 0:00 are 22:00 and 5:00 (next day). Sample 23:00,
    // 0:00 (== 22 stop direct via 22→0+24 span? actually 0 IS a stop), and
    // 2:30 which is between 0 and 5 going forward.
    const midnight = sampleDayCycle(0)
    const stopMidnight = DAY_CYCLE_STOPS.find((s) => s.hour === 0)!
    assert.deepEqual(midnight.skyTop, stopMidnight.skyTop)
    // 23:00 sits between stops 22 and 0 (wrap span = 2h). Should be 50%
    // toward stop 0.
    const between = sampleDayCycle(23)
    const stop22 = DAY_CYCLE_STOPS.find((s) => s.hour === 22)!
    const expected = (a: number, b: number) => (a + b) / 2
    assert.ok(Math.abs(between.sunIntensity - expected(stop22.sunIntensity, stopMidnight.sunIntensity)) < 1e-6)
})

test('sampleDayCycle wraps negative and >24 inputs', () => {
    const a = sampleDayCycle(12)
    const b = sampleDayCycle(36)         // 36 % 24 = 12
    const c = sampleDayCycle(-12)        // (-12 % 24 + 24) % 24 = 12
    assert.deepEqual(a.skyTop, b.skyTop)
    assert.deepEqual(a.skyTop, c.skyTop)
})

test('sampleDayCycle returns a sane default for non-finite input', () => {
    const nanResult = sampleDayCycle(Number.NaN)
    assert.ok(Number.isFinite(nanResult.sunIntensity))
    assert.ok(Array.isArray(nanResult.skyTop))
    assert.equal(nanResult.skyTop.length, 3)
})

test('formatHourLabel renders HH:MM with zero-padding', () => {
    assert.equal(formatHourLabel(0), '00:00')
    assert.equal(formatHourLabel(6.5), '06:30')
    assert.equal(formatHourLabel(13.25), '13:15')
    assert.equal(formatHourLabel(23.999), '23:59')
    assert.equal(formatHourLabel(-1), '23:00')   // wraps
    assert.equal(formatHourLabel(Number.NaN), '--:--')
})

test('DAY_CYCLE_PRESET_HOURS cover the expected preset chips', () => {
    const ids = DAY_CYCLE_PRESET_HOURS.map((p) => p.id)
    for (const expected of ['dawn', 'morning', 'noon', 'dusk', 'night', 'midnight']) {
        assert.ok(ids.includes(expected), `missing preset chip: ${expected}`)
    }
})

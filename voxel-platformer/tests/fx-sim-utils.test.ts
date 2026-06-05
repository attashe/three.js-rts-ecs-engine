import test from 'node:test'
import assert from 'node:assert/strict'
import { clamp, curlNoise3, damping, hexToInt, lerp, makeRng, rand, smoothstep, wrap } from '../src/engine/fx/core/sim-utils'

test('clamp / lerp / smoothstep behave like the textbook definitions', () => {
    assert.equal(clamp(5, 0, 3), 3)
    assert.equal(clamp(-1, 0, 3), 0)
    assert.equal(clamp(1.5, 0, 3), 1.5)

    assert.equal(lerp(10, 20, 0), 10)
    assert.equal(lerp(10, 20, 1), 20)
    assert.equal(lerp(10, 20, 0.5), 15)

    assert.equal(smoothstep(0, 0, 1), 0)
    assert.equal(smoothstep(1, 0, 1), 1)
    assert.equal(smoothstep(-1, 0, 1), 0)
    // smoothstep(0.5) for unit interval is 0.5
    assert.ok(Math.abs(smoothstep(0.5, 0, 1) - 0.5) < 1e-6)
})

test('damping is frame-rate independent: pow(c, dt1+dt2) == pow(c, dt1) * pow(c, dt2)', () => {
    const c = 0.7
    const a = damping(c, 0.016) * damping(c, 0.034)
    const b = damping(c, 0.05)
    assert.ok(Math.abs(a - b) < 1e-9, `expected ${b}, got ${a}`)
})

test('makeRng is deterministic for a given seed', () => {
    const a = makeRng(1234)
    const b = makeRng(1234)
    for (let i = 0; i < 10; i++) assert.equal(a(), b())
})

test('rand stays in [a, b)', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 200; i++) {
        const v = rand(rng, -3, 7)
        assert.ok(v >= -3 && v < 7, `out of bounds: ${v}`)
    }
})

test('wrap teleports to the opposite side at boundaries', () => {
    assert.equal(wrap(6, 5), -4)
    assert.equal(wrap(-7, 5), 3)
    assert.equal(wrap(2, 5), 2)
})

test('curlNoise3 returns finite numbers everywhere on a grid', () => {
    for (let x = -3; x <= 3; x++) {
        for (let y = -3; y <= 3; y++) {
            for (let z = -3; z <= 3; z++) {
                const v = curlNoise3(x, y, z, 1.5)
                assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z))
            }
        }
    }
})

test('hexToInt parses 3- and 6-digit CSS hex', () => {
    assert.equal(hexToInt('#fff'), 0xffffff)
    assert.equal(hexToInt('#336699'), 0x336699)
    assert.equal(hexToInt('336699'), 0x336699)
})

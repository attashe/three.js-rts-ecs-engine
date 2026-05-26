import test from 'node:test'
import assert from 'node:assert/strict'
import { SphericalHarmonics3 } from 'three'
import { addDirectionalSH } from '../src/game/torch-block-system-v2'

test('addDirectionalSH adds ambient L_00 + first-order directional terms', () => {
    const sh = new SphericalHarmonics3()
    sh.zero()
    // A unit-bright source straight overhead — +Y direction.
    addDirectionalSH(sh, 0, 1, 0, 1, 0, 0)

    const c = sh.coefficients
    // Band 0 should pick up the ambient term ~0.886227 in red.
    assert.ok(c[0]!.x > 0.7, 'band 0 red must be positive (ambient)')
    assert.equal(c[0]!.y, 0, 'no green should leak')
    assert.equal(c[0]!.z, 0, 'no blue should leak')
    // Band 1 layout in three.js: [L_1m1 (·y), L_10 (·z), L_11 (·x)].
    assert.ok(c[1]!.x > 0.9, 'L_1m1 red ≈ K1 * 1 with dir.y = 1')
    assert.equal(c[2]!.x, 0, 'L_10 should be zero — dir.z = 0')
    assert.equal(c[3]!.x, 0, 'L_11 should be zero — dir.x = 0')
})

test('addDirectionalSH is linear — two calls accumulate', () => {
    const a = new SphericalHarmonics3()
    a.zero()
    addDirectionalSH(a, 1, 0, 0, 0.4, 0.5, 0.6)

    const b = new SphericalHarmonics3()
    b.zero()
    addDirectionalSH(b, 1, 0, 0, 0.4, 0.5, 0.6)
    addDirectionalSH(b, 1, 0, 0, 0.4, 0.5, 0.6)

    // Two identical calls should produce exactly 2× the first one.
    for (let i = 0; i < 4; i++) {
        const ca = a.coefficients[i]!
        const cb = b.coefficients[i]!
        assert.ok(Math.abs(cb.x - ca.x * 2) < 1e-6, `band ${i} red: 2× linearity`)
        assert.ok(Math.abs(cb.y - ca.y * 2) < 1e-6, `band ${i} green: 2× linearity`)
        assert.ok(Math.abs(cb.z - ca.z * 2) < 1e-6, `band ${i} blue: 2× linearity`)
    }
})

test('addDirectionalSH with opposite directions cancels first-order terms', () => {
    const sh = new SphericalHarmonics3()
    sh.zero()
    // Equal contributions from +Y and -Y. Ambient (band 0) accumulates,
    // but the first-order Y component cancels — that's the property of
    // SH projection: a uniformly-lit dome has no directional bias.
    addDirectionalSH(sh, 0, 1, 0, 1, 1, 1)
    addDirectionalSH(sh, 0, -1, 0, 1, 1, 1)

    const c = sh.coefficients
    assert.ok(c[0]!.x > 1.5, 'band 0 ambient adds')
    assert.ok(Math.abs(c[1]!.x) < 1e-6, 'L_1m1 cancels for symmetric +Y / -Y sources')
})

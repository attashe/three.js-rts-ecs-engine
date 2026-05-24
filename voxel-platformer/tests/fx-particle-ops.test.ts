import test from 'node:test'
import assert from 'node:assert/strict'
import { createParticlePool } from '../src/engine/fx/core/particle-field'
import {
    ageLayer,
    diskInZone,
    integrate,
    lifeT,
    lifeTClamped,
    recycleOldestSlot,
    wrapHorizontal,
} from '../src/engine/fx/core/particle-ops'
import type { ExtraLayer, WeatherZoneRuntime } from '../src/engine/fx/core/types'

test('integrate advances positions by velocity*dt and ages by dt', () => {
    const pool = createParticlePool(2)
    pool.positions.set([1, 2, 3, 0, 0, 0])
    pool.velocities.set([10, 20, 30, 0, 0, 0])
    pool.ages.set([0, 0])

    integrate(pool, 0, 0.5)
    assert.equal(pool.positions[0], 6)
    assert.equal(pool.positions[1], 12)
    assert.equal(pool.positions[2], 18)
    assert.equal(pool.ages[0], 0.5)
    // Particle 1 is untouched.
    assert.equal(pool.positions[3], 0)
    assert.equal(pool.ages[1], 0)
})

test('lifeT clamps lifetimes that are nearly zero so we never divide by 0', () => {
    const ages = new Float32Array([0.5, 1.0])
    const lifetimes = new Float32Array([0, 2.0])
    // Lifetime 0 → guarded by Math.max(0.001, ...) → very large value but finite.
    assert.ok(Number.isFinite(lifeT(ages, lifetimes, 0)))
    assert.equal(lifeT(ages, lifetimes, 1), 0.5)
    // Clamped variant caps at 1.
    assert.equal(lifeTClamped(ages, lifetimes, 0), 1)
})

test('wrapHorizontal teleports X/Z when out of the AABB but leaves Y alone', () => {
    const pool = createParticlePool(1)
    pool.positions.set([6, 99, -8])
    wrapHorizontal(pool, 0, 5, 5)
    assert.equal(pool.positions[0], -5, 'X wrapped to opposite side')
    assert.equal(pool.positions[1], 99, 'Y untouched')
    assert.equal(pool.positions[2], 5, 'Z wrapped to opposite side')
})

test('wrapHorizontal is a no-op when the particle is inside the box', () => {
    const pool = createParticlePool(1)
    pool.positions.set([1, 99, -2])
    wrapHorizontal(pool, 0, 5, 5)
    assert.equal(pool.positions[0], 1)
    assert.equal(pool.positions[2], -2)
})

function makeLayer(count: number): ExtraLayer {
    return {
        type: 'test',
        count,
        mesh: null as never,
        geometry: null as never,
        material: null as never,
        data: {
            positions: new Float32Array(count * 3),
            velocities: new Float32Array(count * 3),
            ages: new Float32Array(count),
            lifetimes: new Float32Array(count),
            seeds: new Float32Array(count),
        },
    }
}

test('recycleOldestSlot returns the first expired slot if any', () => {
    const layer = makeLayer(4)
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    ages.set([0.1, 1.5, 0.5, 0.0])
    lifetimes.set([1.0, 1.0, 1.0, 0])   // slot 1 is expired (age > lifetime), 3 hasn't been seeded yet
    // Slot 1's `remaining = -0.5` is <= 0, so it should be picked first.
    assert.equal(recycleOldestSlot(layer), 1)
})

test('recycleOldestSlot picks the slot with the least remaining life when all are alive', () => {
    const layer = makeLayer(3)
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    ages.set([0.1, 0.9, 0.4])
    lifetimes.set([1.0, 1.0, 1.0])
    // remaining: 0.9, 0.1, 0.6 → slot 1 has the least left.
    assert.equal(recycleOldestSlot(layer), 1)
})

test('ageLayer increments every slot by dt', () => {
    const layer = makeLayer(3)
    const ages = layer.data.ages as Float32Array
    ages.set([0, 0.5, 1.0])
    ageLayer(layer, 0.2)
    // Float32 storage loses precision; check with tolerance.
    assert.ok(Math.abs(ages[0]! - 0.2) < 1e-5)
    assert.ok(Math.abs(ages[1]! - 0.7) < 1e-5)
    assert.ok(Math.abs(ages[2]! - 1.2) < 1e-5)
})

test('diskInZone produces points inside the requested radius and at the given Y', () => {
    // Mock runtime — diskInZone only reads `rng`, not the params.
    const runtime = { params: { size: { x: 10, y: 5, z: 10 } } } as unknown as WeatherZoneRuntime
    const out = { x: 0, y: 0, z: 0 }
    const rng = () => 0.5
    for (let i = 0; i < 30; i++) {
        diskInZone(runtime, rng, 4, out, 1.5)
        const d = Math.sqrt(out.x * out.x + out.z * out.z)
        assert.ok(d <= 4 + 1e-6, `radius bound violated: ${d}`)
        assert.equal(out.y, 1.5)
    }
})

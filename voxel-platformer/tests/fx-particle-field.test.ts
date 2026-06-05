import test from 'node:test'
import assert from 'node:assert/strict'
import { createParticlePool, hideTail, resetParticle, setParticleCount } from '../src/engine/fx/core/particle-field'

test('createParticlePool allocates typed arrays sized to the capacity', () => {
    const pool = createParticlePool(8)
    assert.equal(pool.count, 8)
    assert.equal(pool.capacity, 8)
    assert.equal(pool.positions.length, 24)
    assert.equal(pool.velocities.length, 24)
    assert.equal(pool.phases.length, 8)
    assert.equal(pool.ages.length, 8)
    assert.equal(pool.lifetimes.length, 8)
    assert.equal(pool.seeds.length, 8)
    assert.equal(pool.sizes.length, 8)
})

test('setParticleCount clamps to capacity and floors negatives', () => {
    const pool = createParticlePool(4)
    setParticleCount(pool, 100)
    assert.equal(pool.count, 4, 'cannot grow past capacity')
    setParticleCount(pool, -3)
    assert.equal(pool.count, 0)
    setParticleCount(pool, 2.9)
    assert.equal(pool.count, 2)
})

test('resetParticle zeros every slot at the requested index', () => {
    const pool = createParticlePool(2)
    pool.positions.fill(7)
    pool.velocities.fill(7)
    pool.phases.fill(7)
    pool.ages.fill(7)
    pool.lifetimes.fill(7)
    pool.seeds.fill(7)
    pool.sizes.fill(7)
    resetParticle(pool, 1)
    assert.equal(pool.positions[3], 0)
    assert.equal(pool.positions[4], 0)
    assert.equal(pool.positions[5], 0)
    assert.equal(pool.velocities[3], 0)
    assert.equal(pool.phases[1], 0)
    assert.equal(pool.ages[1], 0)
    assert.equal(pool.lifetimes[1], 0)
    assert.equal(pool.seeds[1], 0)
    assert.equal(pool.sizes[1], 1, 'sizes default back to 1')
    // Untouched slot 0 keeps its values.
    assert.equal(pool.positions[0], 7)
})

test('hideTail writes zero-scale matrices for inactive instances', () => {
    // Stub the InstancedMesh interface — we only need `count`,
    // `setMatrixAt`, and `instanceMatrix.needsUpdate`.
    const matrices: number[][] = []
    const mesh = {
        count: 5,
        setMatrixAt(i: number, m: { elements: number[] }) { matrices[i] = [...m.elements] },
        instanceMatrix: { needsUpdate: false },
    }
    const dummy = {
        position: { set() {} },
        rotation: { set() {} },
        scale: { set() {} },
        updateMatrix() {},
        matrix: { elements: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    }
    // Cast through unknown for the structural-typed stubs.
    hideTail(mesh as unknown as import('three').InstancedMesh, dummy as unknown as import('three').Object3D, 2)
    // We expect indices 2..4 to have been written with the zero matrix.
    assert.deepEqual(matrices[2], dummy.matrix.elements)
    assert.deepEqual(matrices[3], dummy.matrix.elements)
    assert.deepEqual(matrices[4], dummy.matrix.elements)
})

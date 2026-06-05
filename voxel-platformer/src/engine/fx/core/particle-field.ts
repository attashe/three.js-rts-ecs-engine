import { InstancedMesh, Object3D } from 'three'
import type { ParticlePool } from './types'

/**
 * Typed-array particle pool. The emitter strategies treat this as a
 * dense, fixed-capacity arena: every numeric index in `[0, count)` is
 * a live particle whose data lives at the same offset in every typed
 * array (positions are 3-wide, the rest 1-wide).
 *
 * Building a pool with `capacity` ≥ the largest count you'll ever set
 * lets you change `count` at runtime without reallocating — the
 * emitter just clamps its loops to the new count. To grow past
 * `capacity`, rebuild.
 */
export function createParticlePool(capacity: number): ParticlePool {
    const cap = Math.max(0, Math.floor(capacity))
    return {
        count: cap,
        capacity: cap,
        positions: new Float32Array(cap * 3),
        velocities: new Float32Array(cap * 3),
        phases: new Float32Array(cap),
        ages: new Float32Array(cap),
        lifetimes: new Float32Array(cap),
        seeds: new Float32Array(cap),
        sizes: new Float32Array(cap),
    }
}

/** Reset the pool's count without freeing memory. Use when an emitter
 *  shrinks its active particle count. */
export function setParticleCount(pool: ParticlePool, count: number): void {
    pool.count = Math.min(pool.capacity, Math.max(0, Math.floor(count)))
}

/**
 * Zero out a single particle slot — positions, velocities, age, etc.
 * Emitter `spawn` callbacks repopulate it afterwards.
 */
export function resetParticle(pool: ParticlePool, i: number): void {
    const p3 = i * 3
    pool.positions[p3] = 0
    pool.positions[p3 + 1] = 0
    pool.positions[p3 + 2] = 0
    pool.velocities[p3] = 0
    pool.velocities[p3 + 1] = 0
    pool.velocities[p3 + 2] = 0
    pool.phases[i] = 0
    pool.ages[i] = 0
    pool.lifetimes[i] = 0
    pool.seeds[i] = 0
    pool.sizes[i] = 1
}

/**
 * Hide every instance past `activeCount` by writing a zero-scale
 * matrix. The emitter calls this whenever it shrinks the count so the
 * unused tail doesn't render stale particles.
 */
export function hideTail(mesh: InstancedMesh, dummy: Object3D, activeCount: number): void {
    const cap = mesh.count
    if (activeCount >= cap) return
    dummy.position.set(0, 0, 0)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(0, 0, 0)
    dummy.updateMatrix()
    for (let i = activeCount; i < cap; i++) mesh.setMatrixAt(i, dummy.matrix)
    mesh.instanceMatrix.needsUpdate = true
}

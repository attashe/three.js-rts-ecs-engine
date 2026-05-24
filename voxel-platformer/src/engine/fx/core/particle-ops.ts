import type { ExtraLayer, ParticlePool, WeatherZoneRuntime } from './types'

/**
 * Pure operations on `ParticlePool` / `ExtraLayer` typed arrays.
 *
 * These exist to keep emitter `update` / `write` loops focused on
 * per-effect *physics*, not on the bookkeeping that every effect
 * shares (integrating velocities, normalising age into [0, 1], wrapping
 * the AABB, finding the next available slot in a recycling layer).
 *
 * All functions take pool / layer references and indices — no Three
 * dependency, no Three allocations.
 */

/** Apply `velocities * dt` to positions and increment `ages` by `dt`. */
export function integrate(pool: ParticlePool, i: number, dt: number): void {
    const p3 = i * 3
    pool.positions[p3]     += pool.velocities[p3]! * dt
    pool.positions[p3 + 1] += pool.velocities[p3 + 1]! * dt
    pool.positions[p3 + 2] += pool.velocities[p3 + 2]! * dt
    pool.ages[i]! += dt
}

/** Same as `integrate` but for an extra layer's parallel arrays. */
export function integrateLayer(layer: ExtraLayer, i: number, dt: number): void {
    const positions = layer.data.positions as Float32Array
    const velocities = layer.data.velocities as Float32Array
    const ages = layer.data.ages as Float32Array
    const p3 = i * 3
    positions[p3]     += velocities[p3]! * dt
    positions[p3 + 1] += velocities[p3 + 1]! * dt
    positions[p3 + 2] += velocities[p3 + 2]! * dt
    ages[i]! += dt
}

/** Normalised age in `[0, 1]`. The `max(0.001, ...)` floor prevents
 *  division by zero when a particle's lifetime hasn't been set yet
 *  (just after `spawn` for emitters that defer lifetime assignment). */
export function lifeT(ages: ArrayLike<number>, lifetimes: ArrayLike<number>, i: number): number {
    return ages[i]! / Math.max(0.001, lifetimes[i]!)
}

/** Clamped variant — useful for write-time visuals where you don't want
 *  the value to exceed 1 even if the integration overshot. */
export function lifeTClamped(ages: ArrayLike<number>, lifetimes: ArrayLike<number>, i: number): number {
    return Math.min(1, lifeT(ages, lifetimes, i))
}

/**
 * Reflective wrap on the X/Z axes for particles whose Y handling is
 * effect-specific (rain falls, snow falls, dust gusts horizontally).
 * Mutates the pool in place; cheap branch-only check, no Math calls.
 */
export function wrapHorizontal(pool: ParticlePool, i: number, halfX: number, halfZ: number): void {
    const p3 = i * 3
    const px = pool.positions[p3]!
    const pz = pool.positions[p3 + 2]!
    if (px > halfX) pool.positions[p3] = -halfX
    else if (px < -halfX) pool.positions[p3] = halfX
    if (pz > halfZ) pool.positions[p3 + 2] = -halfZ
    else if (pz < -halfZ) pool.positions[p3 + 2] = halfZ
}

/**
 * Pick the best slot in a recycling extra-layer (splash rings, ripples,
 * steam puffs…) to trigger next. Prefers any slot whose lifetime has
 * already expired; otherwise overwrites the slot with the *least*
 * remaining life. Returns the chosen index.
 *
 * The caller is expected to write fresh `position` / `velocity` /
 * `age` / `lifetime` / `seed` data to the returned slot.
 */
export function recycleOldestSlot(layer: ExtraLayer): number {
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    let target = 0
    let oldestRemaining = Infinity
    for (let i = 0; i < layer.count; i++) {
        const remaining = lifetimes[i]! - ages[i]!
        if (remaining <= 0) return i
        if (remaining < oldestRemaining) { oldestRemaining = remaining; target = i }
    }
    return target
}

/** Step every age in an extra layer's `ages` array. Convenience for
 *  emitters whose layer doesn't need any further physics (rain splash
 *  ripples, boiling ripples). */
export function ageLayer(layer: ExtraLayer, dt: number): void {
    const ages = layer.data.ages as Float32Array
    for (let i = 0; i < layer.count; i++) ages[i]! += dt
}

/** Random point in a disc of `radius`, written into `out`. The disc
 *  lies in the XZ plane at the cursor's Y. */
export function diskInZone(runtime: WeatherZoneRuntime, rng: () => number, radius: number, out: { x: number; y: number; z: number }, yLevel = 0): void {
    const r = Math.sqrt(rng()) * radius
    const ang = rng() * Math.PI * 2
    out.x = Math.cos(ang) * r
    out.y = yLevel
    out.z = Math.sin(ang) * r
}

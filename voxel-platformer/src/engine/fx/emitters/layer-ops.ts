import type { ExtraLayer, WeatherZoneRuntime, WriteContext } from '../core/types'
import { damping, rand, TAU } from '../core/sim-utils'
import { lifeTClamped } from '../core/particle-ops'
import { tintMaterial } from '../materials/material-tint'
import { billboardYaw } from './emitter-base'

/**
 * Higher-level helpers for the "extra layer" pattern shared by most
 * emitters (smoke, sparks, steam, splashes, halos…).
 *
 * Each layer keeps parallel typed arrays in `layer.data.{positions,
 * velocities, ages, lifetimes, seeds}`. These helpers operate on that
 * convention; an emitter with a custom layer shape is welcome to
 * bypass them and step its own arrays directly.
 */

export interface StepRespawningLayerOpts {
    /** Frame-rate independent drag coefficient. */
    drag: number
    /** Initial upward velocity at spawn. */
    upward: number
    /** XZ scatter radius at spawn (as a fraction of `size.x`). */
    spread: number
    /** Y at which the particle is reborn (relative to the zone centre). */
    baseY: number
    /** Y at which the particle is killed and respawned. If the particle
     *  is still inside this band, only drag is applied. Optional; if
     *  omitted, particles are only respawned when their age expires. */
    topY?: number
    /** Multiplier on the params lifetime range. Default 0.8–1.8. */
    lifetimeMinMul?: number
    lifetimeMaxMul?: number
    /** Per-tick horizontal force shape. Defaults to small sinusoidal
     *  noise that picks up the zone's wind + turbulence. */
    horizontalForce?: (i: number, seed: number, elapsed: number, runtime: WeatherZoneRuntime) => { x: number; z: number }
}

/**
 * Generic "upward-drifting puff" extra-layer stepper. Replaces the
 * `stepLayer` / `stepSimpleLayer` / `stepSpiralLayer` copies in fire,
 * fire-tornado, and explosion emitters.
 */
export function stepRespawningLayer(
    layer: ExtraLayer,
    runtime: WeatherZoneRuntime,
    dt: number,
    rng: () => number,
    elapsed: number,
    opts: StepRespawningLayerOpts,
): void {
    const positions = layer.data.positions as Float32Array
    const velocities = layer.data.velocities as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const seeds = layer.data.seeds as Float32Array
    const drag = damping(opts.drag, dt)
    const p = runtime.params
    const top = opts.topY !== undefined ? opts.topY : Infinity
    const horiz = opts.horizontalForce ?? defaultHorizontalForce

    for (let i = 0; i < layer.count; i++) {
        ages[i]! += dt
        const i3 = i * 3
        const expired = lifetimes[i] === 0 || ages[i]! > lifetimes[i]! || positions[i3 + 1]! > top
        if (expired) {
            const ang = rng() * TAU
            const r = rng() * p.size.x * opts.spread
            positions[i3]     = Math.cos(ang) * r
            positions[i3 + 1] = opts.baseY
            positions[i3 + 2] = Math.sin(ang) * r
            velocities[i3]     = rand(rng, -0.2, 0.2)
            velocities[i3 + 1] = opts.upward * rand(rng, 0.7, 1.2)
            velocities[i3 + 2] = rand(rng, -0.2, 0.2)
            ages[i] = 0
            lifetimes[i] = p.lifetime * rand(rng, opts.lifetimeMinMul ?? 0.8, opts.lifetimeMaxMul ?? 1.8)
            seeds[i] = rng()
            continue
        }
        const seed = seeds[i]!
        const force = horiz(i, seed, elapsed, runtime)
        velocities[i3]     = velocities[i3]!     * drag + force.x * dt
        velocities[i3 + 1] *= drag
        velocities[i3 + 2] = velocities[i3 + 2]! * drag + force.z * dt
        positions[i3]     += velocities[i3]!     * dt
        positions[i3 + 1] += velocities[i3 + 1]! * dt
        positions[i3 + 2] += velocities[i3 + 2]! * dt
    }
}

function defaultHorizontalForce(_i: number, seed: number, elapsed: number, runtime: WeatherZoneRuntime): { x: number; z: number } {
    const p = runtime.params
    return {
        x: p.windX * 0.055 + Math.sin(elapsed * 2.8 + seed * TAU) * p.turbulence * 0.045,
        z: p.windZ * 0.055 + Math.cos(elapsed * 2.4 + seed * TAU) * p.turbulence * 0.045,
    }
}

export interface WriteBillboardLayerOpts {
    /** Size multiplier on top of `params.particleSize`. */
    sizeMul: number
    /** Opacity multiplier on top of `params.opacity`. */
    opacity: number
    /** Hex / packed colour the layer should be tinted with. */
    color: string | number
    /** Whether the billboard should spin on the Z axis. */
    spin?: boolean
    /** Per-particle scale curve. `lifeT` is in `[0, 1]`. Default:
     *  smooth grow + fade `(0.7 + lifeT * 1.55) * (1 - lifeT * 0.82)`. */
    sizeCurve?: (lifeT: number) => number
    /** Optional Y offset added to every particle position. */
    yOffset?: number
}

const defaultSizeCurve = (t: number): number => (0.7 + t * 1.55) * Math.max(0.16, 1 - t * 0.82)

/**
 * Generic billboard write loop. Replaces `writeLayer` /
 * `writeSimpleLayer` copies. Reads `positions`, `ages`, `lifetimes`,
 * `seeds` from `layer.data` and writes camera-facing instance
 * matrices.
 */
export function writeBillboardLayer(
    layer: ExtraLayer | undefined,
    runtime: WeatherZoneRuntime,
    ctx: WriteContext,
    opts: WriteBillboardLayerOpts,
): void {
    if (!layer) return
    const positions = layer.data.positions as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const seeds = layer.data.seeds as Float32Array
    const dummy = ctx.dummy
    const base = runtime.params.particleSize * opts.sizeMul
    const sizeCurve = opts.sizeCurve ?? defaultSizeCurve
    const yOffset = opts.yOffset ?? 0
    const spin = opts.spin ?? false

    for (let i = 0; i < layer.count; i++) {
        const t = lifeTClamped(ages, lifetimes, i)
        const px = positions[i * 3]!
        const py = positions[i * 3 + 1]! + yOffset
        const pz = positions[i * 3 + 2]!
        const yaw = billboardYaw(ctx, px, pz)
        const s = base * sizeCurve(t)
        dummy.position.set(px, py, pz)
        dummy.rotation.set(0, yaw, spin ? runtime.elapsed * 4 + seeds[i]! * TAU : 0)
        dummy.scale.set(s, s, 1)
        dummy.updateMatrix()
        layer.mesh.setMatrixAt(i, dummy.matrix)
    }
    layer.mesh.instanceMatrix.needsUpdate = true
    tintMaterial(layer.material, opts.color, runtime.params.opacity * opts.opacity)
}

/**
 * Mark every instance in `[count, mesh.count)` invisible by writing a
 * zero-scale matrix. Cheaper than re-allocating the mesh when a
 * recycling layer has fewer live particles than its capacity.
 */
export function hideInactiveTail(layer: ExtraLayer, activeCount: number, dummy: import('three').Object3D): void {
    if (activeCount >= layer.count) return
    dummy.position.set(0, 0, 0)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(0, 0, 0)
    dummy.updateMatrix()
    for (let i = activeCount; i < layer.count; i++) layer.mesh.setMatrixAt(i, dummy.matrix)
    layer.mesh.instanceMatrix.needsUpdate = true
}

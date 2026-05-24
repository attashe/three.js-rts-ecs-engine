import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildPrimaryBillboard } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { animateWaterSurface, buildWaterSurface } from '../materials/liquid-surfaces'
import { tintMaterial } from '../materials/material-tint'

/**
 * Water zone: animated surface plane + caustic projector overlay + a
 * handful of "glint" sprites that twinkle just above the surface. The
 * surface is what makes this read as water — the particles are
 * decoration.
 */
export class WaterEmitter implements EmitterStrategy {
    readonly type = 'water' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { surface, overlay, base } = buildWaterSurface(runtime.params.color, { x: runtime.params.size.x, z: runtime.params.size.z }, deps.textures)
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'glint', { additive: true })
        runtime.particles.count = runtime.params.count
        ;(runtime as { _surfaceBase?: Float32Array })._surfaceBase = base
        return { primary: mesh, extras: runtime.extras, surface, surfaceOverlay: overlay }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        pool.positions[p3] = rand(rng, -runtime.params.size.x / 2, runtime.params.size.x / 2)
        pool.positions[p3 + 1] = rand(rng, 0.05, 0.4)
        pool.positions[p3 + 2] = rand(rng, -runtime.params.size.z / 2, runtime.params.size.z / 2)
        pool.velocities[p3] = 0
        pool.velocities[p3 + 1] = 0
        pool.velocities[p3 + 2] = 0
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.3)
        pool.ages[i] = rand(rng, 0, runtime.params.lifetime)
        pool.lifetimes[i] = runtime.params.lifetime
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, _rng: () => number): void {
        const pool = runtime.particles
        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const ph = pool.phases[i]!
            // Glints orbit gently on the surface.
            pool.positions[p3]     += Math.sin(elapsed * 0.6 + ph) * 0.1 * dt
            pool.positions[p3 + 2] += Math.cos(elapsed * 0.5 + ph * 1.4) * 0.1 * dt
        }

        if (runtime.surface) {
            const base = (runtime as { _surfaceBase?: Float32Array })._surfaceBase
            if (base) animateWaterSurface(runtime.surface, base, runtime.surfaceOverlay, runtime.params, elapsed)
        }
    }

    write(runtime: WeatherZoneRuntime, elapsed: number, ctx: WriteContext): void {
        const primary = runtime.primary
        if (!primary) return
        const p = runtime.params
        const pool = runtime.particles
        const dummy = ctx.dummy
        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const px = pool.positions[p3]!
            const py = pool.positions[p3 + 1]! + 0.05
            const pz = pool.positions[p3 + 2]!
            const twinkle = 0.4 + Math.abs(Math.sin(elapsed * 2 + pool.phases[i]!)) * 0.6
            const s = p.particleSize * pool.sizes[i]! * 1.4 * twinkle
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, elapsed * 0.5 + pool.seeds[i]! * TAU)
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, '#e7f8ff', p.opacity * 0.6)
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

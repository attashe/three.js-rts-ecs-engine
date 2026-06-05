import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildPrimaryBillboard } from './emitter-base'
import { damping, rand, TAU } from '../core/sim-utils'
import { buildLavaSurface, type LavaSurface } from '../materials/liquid-surfaces'
import { tintMaterial } from '../materials/material-tint'

/**
 * Lava zone: GPU-driven emissive crust+core surface + upward embers.
 * The shader handles the rolling displacement, crust mask, and HDR
 * emissive bands; the emitter owns the ember particle layer and the
 * per-frame light modulation (which lives in fx-light-controller).
 */
export class LavaEmitter implements EmitterStrategy {
    readonly type = 'lava' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const surface = buildLavaSurface({
            size: { x: runtime.params.size.x, z: runtime.params.size.z },
            hotColor: runtime.params.color,
        })
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'ember', { additive: true })
        runtime.particles.count = runtime.params.count
        ;(runtime as { _lavaSurface?: LavaSurface })._lavaSurface = surface
        return { primary: mesh, extras: runtime.extras, surface: surface.mesh }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        pool.positions[p3] = rand(rng, -runtime.params.size.x / 2, runtime.params.size.x / 2)
        pool.positions[p3 + 1] = 0.05
        pool.positions[p3 + 2] = rand(rng, -runtime.params.size.z / 2, runtime.params.size.z / 2)
        pool.velocities[p3] = rand(rng, -0.2, 0.2)
        pool.velocities[p3 + 1] = rand(rng, 1.2, runtime.params.speed * 1.4)
        pool.velocities[p3 + 2] = rand(rng, -0.2, 0.2)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.6, 1.4)
        pool.ages[i] = 0
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.6, 1.2)
    }

    update(runtime: WeatherZoneRuntime, dt: number, _elapsed: number, rng: () => number): void {
        const pool = runtime.particles
        const drag = damping(0.82, dt)
        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            pool.velocities[p3]     *= drag
            pool.velocities[p3 + 1]  = pool.velocities[p3 + 1]! * drag - runtime.params.gravity * 0.55 * dt
            pool.velocities[p3 + 2] *= drag
            pool.positions[p3]     += pool.velocities[p3]! * dt
            pool.positions[p3 + 1] += pool.velocities[p3 + 1]! * dt
            pool.positions[p3 + 2] += pool.velocities[p3 + 2]! * dt
            pool.ages[i]! += dt
            if (pool.ages[i]! > pool.lifetimes[i]!) this.spawn(runtime, i, true, rng)
        }

        const surface = (runtime as { _lavaSurface?: LavaSurface })._lavaSurface
        if (surface) {
            surface.setColors({ hot: runtime.params.color })
            surface.setSize(runtime.params.size.x, runtime.params.size.z)
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
            const py = pool.positions[p3 + 1]!
            const pz = pool.positions[p3 + 2]!
            const flicker = 0.7 + Math.sin(elapsed * 6 + pool.phases[i]!) * 0.4
            const lifeT = pool.ages[i]! / Math.max(0.001, pool.lifetimes[i]!)
            const fade = Math.max(0, 1 - lifeT)
            const s = p.particleSize * pool.sizes[i]! * 1.75 * flicker * fade
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, elapsed * 3 + pool.seeds[i]! * TAU)
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, '#ffb259', p.opacity)
    }

    dispose(runtime: WeatherZoneRuntime): void {
        const surface = (runtime as { _lavaSurface?: LavaSurface })._lavaSurface
        if (surface) {
            surface.dispose()
            ;(runtime as { _lavaSurface?: LavaSurface })._lavaSurface = undefined
        }
    }
}

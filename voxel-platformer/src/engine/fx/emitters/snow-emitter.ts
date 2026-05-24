import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildPrimaryBillboard, pointAtTop, pointInZone } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { tintMaterial } from '../materials/material-tint'

/**
 * Slow flake drift with sinusoidal per-flake sway. Heavier wind shifts
 * the column; `turbulence` controls the sway amplitude. No splash
 * sublayer — snow doesn't impact-pop. Optional accumulation would be a
 * terrain-side concern.
 */
export class SnowEmitter implements EmitterStrategy {
    readonly type = 'snow' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'flake')
        runtime.particles.count = runtime.params.count
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const target = { x: 0, y: 0, z: 0 }
        if (recycle) pointAtTop(runtime, rng, target)
        else pointInZone(runtime, rng, target)
        pool.positions[p3] = target.x
        pool.positions[p3 + 1] = target.y
        pool.positions[p3 + 2] = target.z
        pool.velocities[p3] = 0
        pool.velocities[p3 + 1] = -rand(rng, 0.12, runtime.params.speed * 0.7)
        pool.velocities[p3 + 2] = 0
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.65, 1.45)
        pool.ages[i] = recycle ? 0 : rand(rng, 0, runtime.params.lifetime)
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.8, 1.4)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const bottomY = -p.size.y / 2 + 0.05
        const halfX = p.size.x / 2
        const halfZ = p.size.z / 2
        const sway = p.turbulence

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const ph = pool.phases[i]!
            pool.positions[p3]     += (p.windX * 0.4 + Math.sin(elapsed * 0.8 + ph) * sway) * dt
            pool.positions[p3 + 1] += pool.velocities[p3 + 1]! * dt - p.gravity * 0.18 * dt
            pool.positions[p3 + 2] += (p.windZ * 0.4 + Math.cos(elapsed * 0.6 + ph * 1.3) * sway * 0.7) * dt
            pool.ages[i]! += dt

            const py = pool.positions[p3 + 1]!
            if (py < bottomY || pool.ages[i]! > pool.lifetimes[i]!) {
                this.spawn(runtime, i, true, rng)
                continue
            }
            const px = pool.positions[p3]!
            const pz = pool.positions[p3 + 2]!
            if (px > halfX) pool.positions[p3] = -halfX
            else if (px < -halfX) pool.positions[p3] = halfX
            if (pz > halfZ) pool.positions[p3 + 2] = -halfZ
            else if (pz < -halfZ) pool.positions[p3 + 2] = halfZ
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
            // Random spin gives flakes their tumble.
            const spin = elapsed * 1.6 + pool.phases[i]!
            const yaw = billboardYaw(ctx, px, pz)
            const wobble = 1 + Math.sin(elapsed * 2 + pool.phases[i]! * 1.7) * 0.18
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, spin)
            const s = p.particleSize * pool.sizes[i]! * wobble
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

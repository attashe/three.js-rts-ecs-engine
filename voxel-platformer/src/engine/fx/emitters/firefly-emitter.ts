import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard, pointInZone } from './emitter-base'
import { rand, TAU, wrap } from '../core/sim-utils'
import { tintMaterial } from '../materials/material-tint'

/**
 * Drifting fireflies with a small soft-halo sublayer. The motion is
 * intentionally a slow random walk — boids would feel too uniform.
 */
export class FireflyEmitter implements EmitterStrategy {
    readonly type = 'firefly' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'soft', { additive: true })
        runtime.particles.count = runtime.params.count
        const halos = buildExtraLayer(runtime, deps, {
            type: 'fireflyHalos',
            textureKind: 'soft',
            count: Math.max(20, Math.floor(runtime.params.count * 0.65)),
            materialOpts: { additive: true },
        })
        runtime.extras.push(halos)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const target = { x: 0, y: 0, z: 0 }
        pointInZone(runtime, rng, target)
        pool.positions[p3] = target.x
        pool.positions[p3 + 1] = target.y
        pool.positions[p3 + 2] = target.z
        pool.velocities[p3] = rand(rng, -0.2, 0.2)
        pool.velocities[p3 + 1] = rand(rng, -0.1, 0.1)
        pool.velocities[p3 + 2] = rand(rng, -0.2, 0.2)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.3)
        pool.ages[i] = rand(rng, 0, runtime.params.lifetime)
        pool.lifetimes[i] = runtime.params.lifetime
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const halfX = p.size.x / 2
        const halfY = p.size.y / 2
        const halfZ = p.size.z / 2

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const ph = pool.phases[i]!
            // Random walk with slow restoring force.
            const drift = 0.55 + p.speed
            pool.velocities[p3]     += (Math.sin(elapsed * 0.8 + ph) - pool.positions[p3]!     / halfX * 0.4) * p.turbulence * 0.18 * drift * dt
            pool.velocities[p3 + 1] += (Math.sin(elapsed * 0.5 + ph * 1.4) - pool.positions[p3 + 1]! / halfY * 0.4) * p.turbulence * 0.12 * drift * dt
            pool.velocities[p3 + 2] += (Math.cos(elapsed * 0.6 + ph * 1.3) - pool.positions[p3 + 2]! / halfZ * 0.4) * p.turbulence * 0.18 * drift * dt

            pool.positions[p3]     = wrap(pool.positions[p3]!     + pool.velocities[p3]! * dt,     halfX)
            pool.positions[p3 + 1] = wrap(pool.positions[p3 + 1]! + pool.velocities[p3 + 1]! * dt, halfY)
            pool.positions[p3 + 2] = wrap(pool.positions[p3 + 2]! + pool.velocities[p3 + 2]! * dt, halfZ)
            pool.ages[i]! += dt
            if (pool.ages[i]! > pool.lifetimes[i]!) this.spawn(runtime, i, true, rng)
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
            const blinkRate = 0.8 + pool.seeds[i]! * 1.4
            const blink = Math.pow(Math.max(0, Math.sin(elapsed * blinkRate + pool.phases[i]!)), 3)
            const s = p.particleSize * pool.sizes[i]! * 1.8 * (0.3 + blink * 0.9)
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, elapsed + pool.seeds[i]! * TAU)
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        const halos = runtime.findExtra('fireflyHalos')
        if (halos) {
            const step = Math.max(1, Math.floor(pool.count / halos.count))
            for (let i = 0; i < halos.count; i++) {
                const src = Math.min(pool.count - 1, i * step)
                const s3 = src * 3
                const px = pool.positions[s3]!
                const py = pool.positions[s3 + 1]!
                const pz = pool.positions[s3 + 2]!
                const blinkRate = 0.8 + pool.seeds[src]! * 1.4
                const blink = Math.pow(Math.max(0, Math.sin(elapsed * blinkRate + pool.phases[src]!)), 3)
                const yaw = billboardYaw(ctx, px, pz)
                const s = p.particleSize * (3.4 + pool.seeds[src]! * 2.1) * blink
                dummy.position.set(px, py, pz)
                dummy.rotation.set(0, yaw, 0)
                dummy.scale.set(s, s, 1)
                dummy.updateMatrix()
                halos.mesh.setMatrixAt(i, dummy.matrix)
            }
            halos.mesh.instanceMatrix.needsUpdate = true
            tintMaterial(halos.material, p.color, p.opacity * 0.18)
        }
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

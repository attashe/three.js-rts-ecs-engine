import { SphereGeometry } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard, pointInZone } from './emitter-base'
import { damping, rand, TAU } from '../core/sim-utils'
import { tintMaterial } from '../materials/material-tint'

/**
 * Hot embers rising from a tight base radius. Secondary `emberCores`
 * layer renders small emissive spheres for the brightest particles so
 * the effect reads as "glowing", not just "bright sprite".
 */
export class EmbersEmitter implements EmitterStrategy {
    readonly type = 'embers' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'ember', { additive: true })
        runtime.particles.count = runtime.params.count
        const cores = buildExtraLayer(runtime, deps, {
            type: 'emberCores',
            textureKind: 'soft',
            count: Math.max(40, Math.floor(runtime.params.count * 0.22)),
            materialOpts: { additive: true },
            geometry: new SphereGeometry(0.5, 8, 6),
        })
        runtime.extras.push(cores)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const ang = rng() * TAU
        const r = rng() * runtime.params.size.x * 0.22
        pool.positions[p3] = Math.cos(ang) * r
        pool.positions[p3 + 1] = -runtime.params.size.y / 2 + 0.2
        pool.positions[p3 + 2] = Math.sin(ang) * r
        pool.velocities[p3] = rand(rng, -0.3, 0.3)
        pool.velocities[p3 + 1] = rand(rng, 1.2, runtime.params.speed)
        pool.velocities[p3 + 2] = rand(rng, -0.3, 0.3)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.5, 1.4)
        pool.ages[i] = 0
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.55, 1.1)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const drag = damping(0.86, dt)

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const phase = pool.phases[i]!
            pool.velocities[p3]     = pool.velocities[p3]!     * drag + Math.sin(elapsed * 1.4 + phase) * p.turbulence * 0.4 * dt
            pool.velocities[p3 + 1] = pool.velocities[p3 + 1]! * drag - p.gravity * 0.12 * dt
            pool.velocities[p3 + 2] = pool.velocities[p3 + 2]! * drag + Math.cos(elapsed * 1.2 + phase * 1.3) * p.turbulence * 0.4 * dt

            pool.positions[p3]     += pool.velocities[p3]! * dt
            pool.positions[p3 + 1] += pool.velocities[p3 + 1]! * dt
            pool.positions[p3 + 2] += pool.velocities[p3 + 2]! * dt
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
            const lifeT = pool.ages[i]! / Math.max(0.001, pool.lifetimes[i]!)
            const flicker = 0.62 + Math.sin(elapsed * 8.0 + pool.phases[i]!) * 0.4
            const size = p.particleSize * pool.sizes[i]! * (1 - lifeT * 0.4) * flicker
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, elapsed * 2 + pool.seeds[i]! * TAU)
            dummy.scale.set(size, size, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        // Hot cores: sample the brightest particles every Nth slot.
        const cores = runtime.findExtra('emberCores')
        if (cores) {
            const step = Math.max(1, Math.floor(pool.count / cores.count))
            for (let i = 0; i < cores.count; i++) {
                const src = Math.min(pool.count - 1, i * step)
                const s3 = src * 3
                const px = pool.positions[s3]!
                const py = pool.positions[s3 + 1]!
                const pz = pool.positions[s3 + 2]!
                const lifeT = pool.ages[src]! / Math.max(0.001, pool.lifetimes[src]!)
                const size = p.particleSize * 0.5 * (1 - lifeT)
                dummy.position.set(px, py, pz)
                dummy.rotation.set(0, 0, 0)
                dummy.scale.set(size, size, size)
                dummy.updateMatrix()
                cores.mesh.setMatrixAt(i, dummy.matrix)
            }
            cores.mesh.instanceMatrix.needsUpdate = true
            tintMaterial(cores.material, '#ffcb6a', p.opacity)
        }
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

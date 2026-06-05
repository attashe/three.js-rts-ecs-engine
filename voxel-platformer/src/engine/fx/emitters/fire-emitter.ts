import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard } from './emitter-base'
import { damping, rand, TAU } from '../core/sim-utils'
import { integrate, lifeT } from '../core/particle-ops'
import { stepRespawningLayer, writeBillboardLayer } from './layer-ops'
import { tintMaterial } from '../materials/material-tint'

/**
 * Low bonfire: flame billboards from a tight base, small smoke puffs,
 * and bright sparks. Keep the flame body close to the ground; the tall
 * rising column variant lives in `fire-tornado-emitter`.
 */
export class FireEmitter implements EmitterStrategy {
    readonly type = 'fire' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'flame', { additive: true })
        runtime.particles.count = runtime.params.count
        const smoke = buildExtraLayer(runtime, deps, {
            type: 'fireSmoke',
            textureKind: 'smoke',
            count: Math.max(24, Math.floor(runtime.params.count * 0.16)),
        })
        const sparks = buildExtraLayer(runtime, deps, {
            type: 'fireSparks',
            textureKind: 'spark',
            count: Math.max(18, Math.floor(runtime.params.count * 0.08)),
            materialOpts: { additive: true },
        })
        const soot = buildExtraLayer(runtime, deps, {
            type: 'fireSoot',
            textureKind: 'soft',
            count: Math.max(28, Math.floor(runtime.params.count * 0.12)),
        })
        runtime.extras.push(smoke, sparks, soot)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const ang = rng() * TAU
        const r = rng() * runtime.params.size.x * 0.11
        pool.positions[p3] = Math.cos(ang) * r
        pool.positions[p3 + 1] = -runtime.params.size.y / 2 + rand(rng, 0.05, 0.18)
        pool.positions[p3 + 2] = Math.sin(ang) * r
        pool.velocities[p3] = rand(rng, -0.08, 0.08)
        pool.velocities[p3 + 1] = rand(rng, 0.45, Math.max(0.55, runtime.params.speed * 0.75))
        pool.velocities[p3 + 2] = rand(rng, -0.08, 0.08)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.65, 1.15)
        pool.ages[i] = 0
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.42, 0.82)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const drag = damping(0.88, dt)
        const topY = -p.size.y / 2 + p.size.y * 0.62

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const t = lifeT(pool.ages, pool.lifetimes, i)
            const phase = pool.phases[i]!
            const heatBoost = (1 - t) * 0.18
            pool.velocities[p3]     = pool.velocities[p3]!     * drag + (p.windX * 0.06 + Math.sin(elapsed * 7 + phase) * p.turbulence * 0.12) * dt
            pool.velocities[p3 + 1] = pool.velocities[p3 + 1]! * drag + heatBoost - p.gravity * 0.14 * dt
            pool.velocities[p3 + 2] = pool.velocities[p3 + 2]! * drag + (p.windZ * 0.06 + Math.cos(elapsed * 6 + phase * 1.3) * p.turbulence * 0.12) * dt

            integrate(pool, i, dt)
            if (pool.positions[p3 + 1]! > topY || pool.ages[i]! > pool.lifetimes[i]!) this.spawn(runtime, i, true, rng)
        }

        const smoke = runtime.findExtra('fireSmoke')
        if (smoke) stepRespawningLayer(smoke, runtime, dt, rng, elapsed, { drag: 0.92, upward: 0.36, spread: 0.28, baseY: -p.size.y * 0.18, topY: -p.size.y / 2 + p.size.y * 0.62 })
        const sparks = runtime.findExtra('fireSparks')
        if (sparks) stepRespawningLayer(sparks, runtime, dt, rng, elapsed, { drag: 0.68, upward: 0.55, spread: 0.32, baseY: -p.size.y * 0.43, topY: -p.size.y / 2 + p.size.y * 0.48 })
        const soot = runtime.findExtra('fireSoot')
        if (soot) stepRespawningLayer(soot, runtime, dt, rng, elapsed, { drag: 0.95, upward: 0.28, spread: 0.34, baseY: -p.size.y * 0.22, topY: -p.size.y / 2 + p.size.y * 0.70 })
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
            const t = lifeT(pool.ages, pool.lifetimes, i)
            const flicker = 0.82 + Math.sin(elapsed * 24 + pool.phases[i]!) * 0.18 + Math.max(0, Math.sin(elapsed * 41 + pool.seeds[i]! * TAU)) * 0.16
            // Bloom the flame at the base so a bonfire reads as a low
            // ground fire, not a thin vertical column.
            const heightT = (py + p.size.y / 2) / Math.max(0.001, p.size.y)
            const baseBloom = Math.max(0, 1 - heightT)
            const w = p.particleSize * pool.sizes[i]! * (0.72 + baseBloom * 1.35 + (1 - t) * 0.25) * flicker
            const h = p.particleSize * pool.sizes[i]! * (0.85 + baseBloom * 0.24) * 1.18
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, billboardYaw(ctx, px, pz), 0)
            dummy.scale.set(w, h, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        writeBillboardLayer(runtime.findExtra('fireSmoke'),  runtime, ctx, { sizeMul: 1.35, opacity: 0.36, color: '#514a44', spin: true })
        writeBillboardLayer(runtime.findExtra('fireSparks'), runtime, ctx, { sizeMul: 0.22, opacity: 0.95, color: '#ffd270' })
        writeBillboardLayer(runtime.findExtra('fireSoot'),   runtime, ctx, { sizeMul: 0.26, opacity: 0.46, color: '#1d1915', spin: true })
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

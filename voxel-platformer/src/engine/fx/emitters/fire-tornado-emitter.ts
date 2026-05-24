import type { EmitterCreated, EmitterDeps, EmitterStrategy, ExtraLayer, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard } from './emitter-base'
import { damping, rand, TAU } from '../core/sim-utils'
import { integrate } from '../core/particle-ops'
import { writeBillboardLayer } from './layer-ops'
import { tintMaterial } from '../materials/material-tint'

/**
 * Tall rotating fire column. This preserves the dramatic upward fire
 * behavior that looked wrong for a bonfire, but makes it explicit by
 * adding spiral motion, a narrow core, smoke, and orbiting sparks.
 */
export class FireTornadoEmitter implements EmitterStrategy {
    readonly type = 'fireTornado' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'flame', { additive: true })
        runtime.particles.count = runtime.params.count
        const smoke = buildExtraLayer(runtime, deps, {
            type: 'fireTornadoSmoke',
            textureKind: 'smoke',
            count: Math.max(90, Math.floor(runtime.params.count * 0.40)),
        })
        const sparks = buildExtraLayer(runtime, deps, {
            type: 'fireTornadoSparks',
            textureKind: 'spark',
            count: Math.max(80, Math.floor(runtime.params.count * 0.30)),
            materialOpts: { additive: true },
        })
        runtime.extras.push(smoke, sparks)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, recycle: boolean, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const p3 = i * 3
        const y = recycle ? -p.size.y / 2 + rand(rng, 0.02, 0.2) : rand(rng, -p.size.y / 2, p.size.y * 0.35)
        const heightT = (y + p.size.y / 2) / Math.max(0.001, p.size.y)
        const radiusProfile = 0.18 + (1 - heightT) * 0.12 + heightT * heightT * 0.14
        const radius = p.size.x * radiusProfile * rand(rng, 0.45, 1.08)
        const angle = rng() * TAU
        pool.positions[p3] = Math.cos(angle) * radius
        pool.positions[p3 + 1] = y
        pool.positions[p3 + 2] = Math.sin(angle) * radius
        pool.velocities[p3] = -Math.sin(angle) * rand(rng, 1.15, 2.45)
        pool.velocities[p3 + 1] = rand(rng, p.speed * 0.60, p.speed * 1.24)
        pool.velocities[p3 + 2] = Math.cos(angle) * rand(rng, 1.15, 2.45)
        pool.phases[i] = angle
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.35)
        pool.ages[i] = recycle ? 0 : rand(rng, 0, p.lifetime)
        pool.lifetimes[i] = p.lifetime * rand(rng, 0.62, 1.18)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const drag = damping(0.985, dt)
        const topY = p.size.y / 2

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const x = pool.positions[p3]!
            const z = pool.positions[p3 + 2]!
            const radius = Math.max(0.08, Math.hypot(x, z))
            const tangentX = -z / radius
            const tangentZ = x / radius
            const heightT = (pool.positions[p3 + 1]! + p.size.y / 2) / Math.max(0.001, p.size.y)
            const phase = pool.phases[i]!
            const targetRadius = p.size.x * (0.20 + (1 - heightT) * 0.10 + heightT * heightT * 0.16 + Math.sin(elapsed * 2.1 + phase) * 0.018)
            const radialPull = (targetRadius - radius) * 2.25
            const swirl = p.turbulence * (2.0 + heightT * 1.85)

            pool.velocities[p3] = pool.velocities[p3]! * drag +
                (tangentX * swirl + (x / radius) * radialPull + p.windX * 0.12 + Math.sin(elapsed * 4 + phase) * 0.18) * dt
            pool.velocities[p3 + 1] = pool.velocities[p3 + 1]! * drag + (1 - heightT) * 0.55 - p.gravity * 0.18 * dt
            pool.velocities[p3 + 2] = pool.velocities[p3 + 2]! * drag +
                (tangentZ * swirl + (z / radius) * radialPull + p.windZ * 0.12 + Math.cos(elapsed * 3.7 + phase) * 0.18) * dt

            integrate(pool, i, dt)
            if (pool.positions[p3 + 1]! > topY || pool.ages[i]! > pool.lifetimes[i]!) this.spawn(runtime, i, true, rng)
        }

        const smoke = runtime.findExtra('fireTornadoSmoke')
        if (smoke) stepSpiralLayer(smoke, runtime, dt, rng, elapsed, 0.35, 0.98, 0.28)
        const sparks = runtime.findExtra('fireTornadoSparks')
        if (sparks) stepSpiralLayer(sparks, runtime, dt, rng, elapsed, 1.25, 0.86, 0.45)
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
            const heightT = (py + p.size.y / 2) / Math.max(0.001, p.size.y)
            const flicker = 0.86 + Math.sin(elapsed * 24 + pool.phases[i]!) * 0.22 + Math.max(0, Math.sin(elapsed * 39 + pool.seeds[i]! * TAU)) * 0.18
            const s = p.particleSize * pool.sizes[i]! * flicker * (1 - lifeT * 0.20)
            const lowerBody = 1 - Math.min(1, heightT * 1.35)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, billboardYaw(ctx, px, pz), pool.phases[i]! + elapsed * 2.5)
            dummy.scale.set(s * (1.05 + lowerBody * 0.75 + heightT * 0.28), s * (2.45 + lowerBody * 0.50 - heightT * 0.35), 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        writeBillboardLayer(runtime.findExtra('fireTornadoSmoke'),  runtime, ctx, { sizeMul: 2.35, opacity: 0.46, color: '#504640', spin: true })
        writeBillboardLayer(runtime.findExtra('fireTornadoSparks'), runtime, ctx, { sizeMul: 0.38, opacity: 1.0,  color: '#ffd270' })
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

function stepSpiralLayer(
    layer: ExtraLayer,
    runtime: WeatherZoneRuntime,
    dt: number,
    rng: () => number,
    elapsed: number,
    upward: number,
    dragCoef: number,
    spread: number,
): void {
    const positions = layer.data.positions as Float32Array
    const velocities = layer.data.velocities as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const seeds = layer.data.seeds as Float32Array
    const drag = damping(dragCoef, dt)
    const p = runtime.params
    for (let i = 0; i < layer.count; i++) {
        ages[i]! += dt
        const i3 = i * 3
        if (lifetimes[i] === 0 || ages[i]! > lifetimes[i]! || positions[i3 + 1]! > p.size.y / 2) {
            const angle = rng() * TAU
            const r = rng() * p.size.x * spread
            positions[i3] = Math.cos(angle) * r
            positions[i3 + 1] = -p.size.y / 2 + rng() * p.size.y * 0.2
            positions[i3 + 2] = Math.sin(angle) * r
            velocities[i3] = -Math.sin(angle) * upward * rand(rng, 0.5, 1.2)
            velocities[i3 + 1] = upward * rand(rng, 0.7, 1.3)
            velocities[i3 + 2] = Math.cos(angle) * upward * rand(rng, 0.5, 1.2)
            ages[i] = 0
            lifetimes[i] = p.lifetime * rand(rng, 0.75, 1.6)
            seeds[i] = rng()
            continue
        }
        const x = positions[i3]!
        const z = positions[i3 + 2]!
        const r = Math.max(0.08, Math.hypot(x, z))
        velocities[i3] = velocities[i3]! * drag + (-z / r * p.turbulence + Math.sin(elapsed + seeds[i]! * TAU) * 0.2) * dt
        velocities[i3 + 1] = velocities[i3 + 1]! * drag
        velocities[i3 + 2] = velocities[i3 + 2]! * drag + (x / r * p.turbulence + Math.cos(elapsed + seeds[i]! * TAU) * 0.2) * dt
        positions[i3] += velocities[i3]! * dt
        positions[i3 + 1] += velocities[i3 + 1]! * dt
        positions[i3 + 2] += velocities[i3 + 2]! * dt
    }
}


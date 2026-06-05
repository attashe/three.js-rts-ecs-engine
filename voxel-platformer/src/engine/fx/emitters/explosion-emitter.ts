import { BoxGeometry, PlaneGeometry } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, ExtraLayer, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard } from './emitter-base'
import { damping, rand, TAU } from '../core/sim-utils'
import { integrate, lifeTClamped } from '../core/particle-ops'
import { writeBillboardLayer } from './layer-ops'
import { tintMaterial } from '../materials/material-tint'

/**
 * Event-burst explosion: synchronised fireball + shockwave ring + smoke
 * plume + debris cubes + sparks + a brief light flash. The burst
 * triggers periodically based on `lifetime` (so a single zone keeps
 * "puffing"), but the recommended use is via
 * `WeatherSystem.triggerExplosion(position)` which spawns a runtimeOnly
 * zone whose burst fires exactly once before disposing.
 */
export class ExplosionEmitter implements EmitterStrategy {
    readonly type = 'explosion' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'ember', { additive: true })
        runtime.particles.count = runtime.params.count

        const shock = buildExtraLayer(runtime, deps, {
            type: 'explosionShockwave',
            textureKind: 'shockwave',
            count: 1,
            materialOpts: { additive: true },
        })
        ;(shock.geometry as PlaneGeometry).rotateX(-Math.PI / 2)

        const smoke = buildExtraLayer(runtime, deps, {
            type: 'explosionSmoke',
            textureKind: 'smoke',
            count: Math.max(40, Math.floor(runtime.params.count * 0.20)),
        })
        const debris = buildExtraLayer(runtime, deps, {
            type: 'explosionDebris',
            textureKind: 'soft',
            count: Math.max(18, Math.floor(runtime.params.count * 0.20)),
            arrays: { angularVel: 3 },
            geometry: new BoxGeometry(0.5, 0.5, 0.5),
        })
        const sparks = buildExtraLayer(runtime, deps, {
            type: 'explosionSparks',
            textureKind: 'spark',
            count: Math.max(50, Math.floor(runtime.params.count * 0.24)),
            materialOpts: { additive: true },
        })
        runtime.extras.push(shock, smoke, debris, sparks)

        ;(runtime as { _explosionBurstAt?: number })._explosionBurstAt = runtime.elapsed
        ;(runtime as { _explosionNext?: number })._explosionNext = runtime.elapsed + 0.05
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(_runtime: WeatherZoneRuntime, _i: number, _recycle: boolean, _rng: () => number): void {
        // Handled by resetBurst at burst time, not per-particle.
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const next = (runtime as { _explosionNext?: number })._explosionNext ?? 0
        if (elapsed >= next) {
            resetBurst(runtime, elapsed, rng)
            // One-shot zones (created via `WeatherSystem.triggerExplosion`)
            // mark the runtime so the next burst never schedules. Setting
            // `_explosionNext` to +Infinity keeps the comparison consistent
            // with the regular recurring path. Placed-zone explosions (no
            // flag) keep their recurring rhythm.
            const oneShot = (runtime as { _explosionOneShot?: boolean })._explosionOneShot === true
            ;(runtime as { _explosionNext?: number })._explosionNext =
                oneShot
                    ? Infinity
                    : elapsed + Math.max(1.0, p.lifetime) + 1.35
        }

        const pool = runtime.particles
        const drag = damping(0.70, dt)
        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            pool.velocities[p3]     *= drag
            pool.velocities[p3 + 1]  = pool.velocities[p3 + 1]! * drag - p.gravity * 5.4 * dt
            pool.velocities[p3 + 2] *= drag
            integrate(pool, i, dt)
        }

        const shock = runtime.findExtra('explosionShockwave')
        if (shock) (shock.data.ages as Float32Array)[0]! += dt
        const smoke = runtime.findExtra('explosionSmoke')
        if (smoke) stepSimpleLayer(smoke, runtime, dt, /*upward*/ 0.5, /*drag*/ 0.93)
        const debris = runtime.findExtra('explosionDebris')
        if (debris) stepDebris(debris, runtime, dt)
        const sparks = runtime.findExtra('explosionSparks')
        if (sparks) stepSimpleLayer(sparks, runtime, dt, /*upward*/ 2.4, /*drag*/ 0.74)
    }

    write(runtime: WeatherZoneRuntime, _elapsed: number, ctx: WriteContext): void {
        const primary = runtime.primary
        if (!primary) return
        const p = runtime.params
        const pool = runtime.particles
        const dummy = ctx.dummy
        const burstAt = (runtime as { _explosionBurstAt?: number })._explosionBurstAt ?? 0
        const burstAge = runtime.elapsed - burstAt

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const px = pool.positions[p3]!
            const py = pool.positions[p3 + 1]!
            const pz = pool.positions[p3 + 2]!
            const t = lifeTClamped(pool.ages, pool.lifetimes, i)
            const fade = Math.max(0, 1 - t)
            const expand = 1 + (1 - fade) * 4.2
            const s = p.particleSize * pool.sizes[i]! * expand
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, billboardYaw(ctx, px, pz), runtime.elapsed * 2 + pool.seeds[i]! * TAU)
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity * Math.pow(Math.max(0, 1 - burstAge / p.lifetime), 1.45))

        const shock = runtime.findExtra('explosionShockwave')
        if (shock) writeShock(shock, runtime, ctx)
        writeBillboardLayer(runtime.findExtra('explosionSmoke'),  runtime, ctx, { sizeMul: 2.6,  opacity: 0.7,  color: '#3a3a38', spin: true,
            sizeCurve: (t) => (0.6 + t * 1.7) * (1 - t) })
        writeDebris(runtime.findExtra('explosionDebris'), runtime, ctx)
        writeBillboardLayer(runtime.findExtra('explosionSparks'), runtime, ctx, { sizeMul: 0.45, opacity: 0.95, color: '#ffe88a',
            sizeCurve: (t) => (0.6 + t * 1.7) * (1 - t) })
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

function resetBurst(runtime: WeatherZoneRuntime, elapsed: number, rng: () => number): void {
    ;(runtime as { _explosionBurstAt?: number })._explosionBurstAt = elapsed
    const p = runtime.params
    const pool = runtime.particles
    for (let i = 0; i < pool.count; i++) {
        const theta = rng() * TAU
        const up = rand(rng, 0.1, 0.9)
        const r = Math.sqrt(1 - up * up)
        const sp = p.speed * rand(rng, 0.28, 0.92)
        pool.positions[i * 3] = 0
        pool.positions[i * 3 + 1] = 0
        pool.positions[i * 3 + 2] = 0
        pool.velocities[i * 3] = Math.cos(theta) * r * sp
        pool.velocities[i * 3 + 1] = up * sp
        pool.velocities[i * 3 + 2] = Math.sin(theta) * r * sp
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.5)
        pool.ages[i] = 0
        pool.lifetimes[i] = p.lifetime * rand(rng, 0.30, 0.68)
    }

    const shock = runtime.findExtra('explosionShockwave')
    if (shock) {
        ;(shock.data.ages as Float32Array)[0] = 0
        ;(shock.data.lifetimes as Float32Array)[0] = 0.82
    }
    const smoke = runtime.findExtra('explosionSmoke')
    if (smoke) seedBurstLayer(smoke, runtime, rng, /*upward*/ 0.5, /*lifetimeMul*/ 1.5, /*scatter*/ 0.6)
    const debris = runtime.findExtra('explosionDebris')
    if (debris) {
        seedBurstLayer(debris, runtime, rng, /*upward*/ 1.2, /*lifetimeMul*/ 1.6, /*scatter*/ 1.1)
        const angVel = debris.data.angularVel as Float32Array
        for (let i = 0; i < debris.count; i++) {
            angVel[i * 3]     = rand(rng, -4, 4)
            angVel[i * 3 + 1] = rand(rng, -4, 4)
            angVel[i * 3 + 2] = rand(rng, -4, 4)
        }
    }
    const sparks = runtime.findExtra('explosionSparks')
    if (sparks) seedBurstLayer(sparks, runtime, rng, /*upward*/ 2.2, /*lifetimeMul*/ 0.6, /*scatter*/ 0.9)
}

function seedBurstLayer(layer: ExtraLayer, runtime: WeatherZoneRuntime, rng: () => number, upward: number, lifetimeMul: number, scatter: number): void {
    const positions = layer.data.positions as Float32Array
    const velocities = layer.data.velocities as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const seeds = layer.data.seeds as Float32Array
    const p = runtime.params
    for (let i = 0; i < layer.count; i++) {
        const theta = rng() * TAU
        const up = rand(rng, 0, 1) * upward
        const sp = p.speed * rand(rng, 0.25, 0.85) * scatter
        positions[i * 3] = 0
        positions[i * 3 + 1] = 0
        positions[i * 3 + 2] = 0
        velocities[i * 3] = Math.cos(theta) * sp
        velocities[i * 3 + 1] = up * sp
        velocities[i * 3 + 2] = Math.sin(theta) * sp
        ages[i] = 0
        lifetimes[i] = p.lifetime * rand(rng, 0.55, 1.4) * lifetimeMul
        seeds[i] = rng()
    }
}

function stepSimpleLayer(layer: ExtraLayer, runtime: WeatherZoneRuntime, dt: number, upward: number, dragCoef: number): void {
    // No respawn — explosion debris/smoke/sparks fly free from the
    // initial seedBurst until they expire. Plain drag + gravity + age.
    const positions = layer.data.positions as Float32Array
    const velocities = layer.data.velocities as Float32Array
    const ages = layer.data.ages as Float32Array
    const drag = damping(dragCoef, dt)
    for (let i = 0; i < layer.count; i++) {
        velocities[i * 3]     *= drag
        velocities[i * 3 + 1]  = velocities[i * 3 + 1]! * drag - runtime.params.gravity * 0.6 * dt + upward * 0.04 * dt
        velocities[i * 3 + 2] *= drag
        positions[i * 3]     += velocities[i * 3]! * dt
        positions[i * 3 + 1] += velocities[i * 3 + 1]! * dt
        positions[i * 3 + 2] += velocities[i * 3 + 2]! * dt
        ages[i]! += dt
    }
}

function stepDebris(layer: ExtraLayer, runtime: WeatherZoneRuntime, dt: number): void {
    const positions = layer.data.positions as Float32Array
    const velocities = layer.data.velocities as Float32Array
    const ages = layer.data.ages as Float32Array
    const drag = damping(0.82, dt)
    const groundY = -runtime.params.size.y / 2 + 0.05
    for (let i = 0; i < layer.count; i++) {
        velocities[i * 3]     *= drag
        velocities[i * 3 + 1]  = velocities[i * 3 + 1]! * drag - runtime.params.gravity * 8 * dt
        velocities[i * 3 + 2] *= drag
        positions[i * 3]     += velocities[i * 3]! * dt
        positions[i * 3 + 1] += velocities[i * 3 + 1]! * dt
        positions[i * 3 + 2] += velocities[i * 3 + 2]! * dt
        ages[i]! += dt
        if (positions[i * 3 + 1]! < groundY) {
            positions[i * 3 + 1] = groundY
            velocities[i * 3 + 1] *= -0.25
            velocities[i * 3]     *= 0.7
            velocities[i * 3 + 2] *= 0.7
        }
    }
}

function writeShock(shock: ExtraLayer, runtime: WeatherZoneRuntime, ctx: WriteContext): void {
    const age = (shock.data.ages as Float32Array)[0]!
    const life = (shock.data.lifetimes as Float32Array)[0]!
    const dummy = ctx.dummy
    if (life === 0 || age >= life) {
        dummy.position.set(0, 0, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix()
        shock.mesh.setMatrixAt(0, dummy.matrix)
        shock.mesh.instanceMatrix.needsUpdate = true
        return
    }
    const t = age / life
    const radius = runtime.params.size.x * (0.18 + t * 1.4)
    const y = -runtime.params.size.y / 2 + 0.08
    dummy.position.set(0, y, 0)
    dummy.rotation.set(0, 0, 0)
    dummy.scale.set(radius, radius, radius)
    dummy.updateMatrix()
    shock.mesh.setMatrixAt(0, dummy.matrix)
    shock.mesh.instanceMatrix.needsUpdate = true
    tintMaterial(shock.material, '#ffd58a', runtime.params.opacity * Math.pow(1 - t, 1.35))
}

function writeDebris(layer: ExtraLayer | undefined, runtime: WeatherZoneRuntime, ctx: WriteContext): void {
    if (!layer) return
    const positions = layer.data.positions as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const seeds = layer.data.seeds as Float32Array
    const angVel = layer.data.angularVel as Float32Array
    const dummy = ctx.dummy
    const base = runtime.params.particleSize * 0.7
    for (let i = 0; i < layer.count; i++) {
        const lifeT = Math.min(1, ages[i]! / Math.max(0.001, lifetimes[i]!))
        const fade = 1 - lifeT
        const px = positions[i * 3]!
        const py = positions[i * 3 + 1]!
        const pz = positions[i * 3 + 2]!
        dummy.position.set(px, py, pz)
        dummy.rotation.set(angVel[i * 3]! * ages[i]!, angVel[i * 3 + 1]! * ages[i]!, angVel[i * 3 + 2]! * ages[i]!)
        const s = base * (0.7 + seeds[i]! * 0.6)
        dummy.scale.set(s, s, s)
        dummy.updateMatrix()
        layer.mesh.setMatrixAt(i, dummy.matrix)
        ;(void fade)
    }
    layer.mesh.instanceMatrix.needsUpdate = true
    tintMaterial(layer.material, '#7a4a2a', runtime.params.opacity)
}

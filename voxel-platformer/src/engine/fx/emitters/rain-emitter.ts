import { PlaneGeometry } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, ExtraLayer, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard, pointAtTop, pointInZone } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { ageLayer, integrate, recycleOldestSlot, wrapHorizontal } from '../core/particle-ops'
import { tintMaterial } from '../materials/material-tint'

/**
 * Falling droplet streaks + ground splash ripples.
 *
 * Droplets fall along -Y at `params.speed`, wind-drifted in XZ. When a
 * particle crosses the bottom of the zone it triggers a splash ring in
 * the secondary `rainSplash` layer and respawns at the top. Streaks
 * elongate by `streakLength * (1 + speed * 0.018)` so heavy storms
 * read differently from a light shower.
 */
export class RainEmitter implements EmitterStrategy {
    readonly type = 'rain' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'streak')
        runtime.particles.count = runtime.params.count

        const splash = buildExtraLayer(runtime, deps, {
            type: 'rainSplash',
            textureKind: 'splash',
            count: Math.max(24, Math.floor(runtime.params.count / 6)),
            materialOpts: { additive: true },
        })
        ;(splash.geometry as PlaneGeometry).rotateX(-Math.PI / 2)
        runtime.extras.push(splash)
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
        pool.velocities[p3] = runtime.params.windX
        pool.velocities[p3 + 1] = -runtime.params.speed
        pool.velocities[p3 + 2] = runtime.params.windZ
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.25)
        pool.ages[i] = recycle ? 0 : rand(rng, 0, runtime.params.lifetime)
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.55, 1.45)
    }

    update(runtime: WeatherZoneRuntime, dt: number, _elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const splash = runtime.findExtra('rainSplash')
        const bottomY = -p.size.y / 2 + 0.05
        const halfX = p.size.x / 2
        const halfZ = p.size.z / 2

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            pool.velocities[p3]     = p.windX + Math.sin(runtime.elapsed * 0.6 + pool.phases[i]!) * p.turbulence
            pool.velocities[p3 + 1] = -p.speed - p.gravity * 3.2 * dt
            pool.velocities[p3 + 2] = p.windZ + Math.cos(runtime.elapsed * 0.55 + pool.phases[i]! * 1.3) * p.turbulence

            integrate(pool, i, dt)

            const py = pool.positions[p3 + 1]!
            if (py < bottomY || pool.ages[i]! > pool.lifetimes[i]!) {
                if (splash) triggerSplash(splash, pool.positions[p3]!, bottomY, pool.positions[p3 + 2]!, rng)
                this.spawn(runtime, i, true, rng)
                continue
            }
            wrapHorizontal(pool, i, halfX, halfZ)
        }
        if (splash) ageLayer(splash, dt)
    }

    write(runtime: WeatherZoneRuntime, _elapsed: number, ctx: WriteContext): void {
        const primary = runtime.primary
        if (!primary) return
        const p = runtime.params
        const pool = runtime.particles
        const dummy = ctx.dummy
        const stretch = p.streaks ? p.streakLength * (1 + p.speed * 0.018) : 1
        const baseW = p.particleSize
        const baseH = p.particleSize * (p.streaks ? 6 + p.speed * 0.05 : 1)

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const px = pool.positions[p3]!
            const py = pool.positions[p3 + 1]!
            const pz = pool.positions[p3 + 2]!
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, 0)
            dummy.scale.set(baseW * pool.sizes[i]!, baseH * pool.sizes[i]! * stretch, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        const splash = runtime.findExtra('rainSplash')
        if (splash) writeSplashes(splash, runtime, ctx)
    }

    dispose(_runtime: WeatherZoneRuntime): void { /* meshes freed by WeatherZone */ }
}

function triggerSplash(splash: ExtraLayer, x: number, y: number, z: number, rng: () => number): void {
    const positions = splash.data.positions as Float32Array
    const ages = splash.data.ages as Float32Array
    const lifetimes = splash.data.lifetimes as Float32Array
    const seeds = splash.data.seeds as Float32Array
    const target = recycleOldestSlot(splash)
    const t3 = target * 3
    positions[t3] = x
    positions[t3 + 1] = y
    positions[t3 + 2] = z
    ages[target] = 0
    lifetimes[target] = 0.55 + rng() * 0.35
    seeds[target] = rng()
}

function writeSplashes(splash: ExtraLayer, runtime: WeatherZoneRuntime, ctx: WriteContext): void {
    const positions = splash.data.positions as Float32Array
    const ages = splash.data.ages as Float32Array
    const lifetimes = splash.data.lifetimes as Float32Array
    const dummy = ctx.dummy
    const base = runtime.params.particleSize * 4
    for (let i = 0; i < splash.count; i++) {
        const remaining = lifetimes[i]! - ages[i]!
        if (remaining <= 0) {
            dummy.position.set(0, 0, 0)
            dummy.scale.set(0, 0, 0)
            dummy.updateMatrix()
            splash.mesh.setMatrixAt(i, dummy.matrix)
            continue
        }
        const t = 1 - remaining / lifetimes[i]!
        const i3 = i * 3
        dummy.position.set(
            positions[i3]!,
            positions[i3 + 1]!,
            positions[i3 + 2]!,
        )
        dummy.rotation.set(0, 0, 0)
        const scale = base * (0.4 + t * 1.6)
        dummy.scale.set(scale, scale, scale)
        dummy.updateMatrix()
        splash.mesh.setMatrixAt(i, dummy.matrix)
    }
    splash.mesh.instanceMatrix.needsUpdate = true
    tintMaterial(splash.material, runtime.params.color, runtime.params.opacity * 0.65)
}

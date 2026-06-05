import { PlaneGeometry } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, ExtraLayer, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { recycleOldestSlot } from '../core/particle-ops'
import { tintMaterial } from '../materials/material-tint'

/**
 * Surface bubbles + pop ripples + slow steam puffs. Use as a child
 * effect of a liquid zone (water surface, lava pool) — by itself it
 * looks like floating spheres on nothing.
 */
export class BoilingEmitter implements EmitterStrategy {
    readonly type = 'boiling' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'bubble')
        runtime.particles.count = runtime.params.count
        const steam = buildExtraLayer(runtime, deps, {
            type: 'boilSteam',
            textureKind: 'fog',
            count: Math.max(20, Math.floor(runtime.params.count / 8)),
        })
        const ripples = buildExtraLayer(runtime, deps, {
            type: 'boilRipples',
            textureKind: 'splash',
            count: Math.max(18, Math.floor(runtime.params.count / 10)),
            materialOpts: { additive: true },
        })
        ;(ripples.geometry as PlaneGeometry).rotateX(-Math.PI / 2)
        runtime.extras.push(steam, ripples)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const ang = rng() * TAU
        const r = rng() * runtime.params.size.x * 0.45
        pool.positions[p3] = Math.cos(ang) * r
        pool.positions[p3 + 1] = -runtime.params.size.y / 2 + rand(rng, 0.05, 0.3)
        pool.positions[p3 + 2] = Math.sin(ang) * r
        pool.velocities[p3] = rand(rng, -0.1, 0.1)
        pool.velocities[p3 + 1] = rand(rng, 0.4, runtime.params.speed * 1.5)
        pool.velocities[p3 + 2] = rand(rng, -0.1, 0.1)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.3)
        pool.ages[i] = 0
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.45, 0.95)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const surfaceY = 0

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const ph = pool.phases[i]!
            pool.velocities[p3]     += Math.sin(elapsed * 2 + ph) * p.turbulence * 0.05 * dt
            pool.velocities[p3 + 2] += Math.cos(elapsed * 1.8 + ph * 1.3) * p.turbulence * 0.05 * dt
            pool.positions[p3]     += pool.velocities[p3]! * dt
            pool.positions[p3 + 1] += pool.velocities[p3 + 1]! * dt
            pool.positions[p3 + 2] += pool.velocities[p3 + 2]! * dt
            pool.ages[i]! += dt
            if (pool.positions[p3 + 1]! >= surfaceY || pool.ages[i]! > pool.lifetimes[i]!) {
                triggerRipple(runtime.findExtra('boilRipples'), pool.positions[p3]!, surfaceY, pool.positions[p3 + 2]!, rng)
                triggerSteam(runtime.findExtra('boilSteam'), pool.positions[p3]!, surfaceY, pool.positions[p3 + 2]!, rng)
                this.spawn(runtime, i, true, rng)
            }
        }

        const steam = runtime.findExtra('boilSteam')
        if (steam) {
            const positions = steam.data.positions as Float32Array
            const velocities = steam.data.velocities as Float32Array
            const ages = steam.data.ages as Float32Array
            for (let i = 0; i < steam.count; i++) {
                ages[i]! += dt
                positions[i * 3] += velocities[i * 3]! * dt
                positions[i * 3 + 1] += velocities[i * 3 + 1]! * dt
                positions[i * 3 + 2] += velocities[i * 3 + 2]! * dt
            }
        }
        const ripples = runtime.findExtra('boilRipples')
        if (ripples) {
            const ages = ripples.data.ages as Float32Array
            for (let i = 0; i < ripples.count; i++) ages[i]! += dt
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
            const buoy = 1 + Math.sin(elapsed * 3 + pool.phases[i]!) * 0.08
            const s = p.particleSize * pool.sizes[i]! * (0.8 + lifeT * 0.6) * buoy
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, elapsed * 0.6 + pool.seeds[i]! * TAU)
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        writeSteam(runtime.findExtra('boilSteam'), runtime, ctx)
        writeRipples(runtime.findExtra('boilRipples'), runtime, ctx)
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

function triggerRipple(layer: ExtraLayer | undefined, x: number, y: number, z: number, rng: () => number): void {
    if (!layer) return
    const positions = layer.data.positions as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const target = recycleOldestSlot(layer)
    positions[target * 3] = x
    positions[target * 3 + 1] = y
    positions[target * 3 + 2] = z
    ages[target] = 0
    lifetimes[target] = 0.7 + rng() * 0.4
}

function triggerSteam(layer: ExtraLayer | undefined, x: number, y: number, z: number, rng: () => number): void {
    if (!layer) return
    if (rng() > 0.18) return
    const positions = layer.data.positions as Float32Array
    const velocities = layer.data.velocities as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const target = recycleOldestSlot(layer)
    positions[target * 3] = x
    positions[target * 3 + 1] = y
    positions[target * 3 + 2] = z
    velocities[target * 3] = rand(rng, -0.1, 0.1)
    velocities[target * 3 + 1] = rand(rng, 0.5, 1.4)
    velocities[target * 3 + 2] = rand(rng, -0.1, 0.1)
    ages[target] = 0
    lifetimes[target] = 1.4 + rng() * 0.6
}

function writeSteam(layer: ExtraLayer | undefined, runtime: WeatherZoneRuntime, ctx: WriteContext): void {
    if (!layer) return
    const positions = layer.data.positions as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const dummy = ctx.dummy
    const base = runtime.params.particleSize * 2.8
    for (let i = 0; i < layer.count; i++) {
        const lifeT = Math.min(1, ages[i]! / Math.max(0.001, lifetimes[i]!))
        if (lifeT >= 1) {
            dummy.position.set(0, 0, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix()
            layer.mesh.setMatrixAt(i, dummy.matrix)
            continue
        }
        const i3 = i * 3
        dummy.position.set(positions[i3]!, positions[i3 + 1]!, positions[i3 + 2]!)
        const yaw = billboardYaw(ctx, positions[i3]!, positions[i3 + 2]!)
        dummy.rotation.set(0, yaw, 0)
        const s = base * (0.6 + lifeT * 2.4)
        dummy.scale.set(s, s, 1)
        dummy.updateMatrix()
        layer.mesh.setMatrixAt(i, dummy.matrix)
    }
    layer.mesh.instanceMatrix.needsUpdate = true
    tintMaterial(layer.material, '#dbe5ee', runtime.params.opacity * 0.4)
}

function writeRipples(layer: ExtraLayer | undefined, runtime: WeatherZoneRuntime, ctx: WriteContext): void {
    if (!layer) return
    const positions = layer.data.positions as Float32Array
    const ages = layer.data.ages as Float32Array
    const lifetimes = layer.data.lifetimes as Float32Array
    const dummy = ctx.dummy
    const base = runtime.params.particleSize * 5
    for (let i = 0; i < layer.count; i++) {
        const lifeT = Math.min(1, ages[i]! / Math.max(0.001, lifetimes[i]!))
        if (lifeT >= 1) {
            dummy.position.set(0, 0, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix()
            layer.mesh.setMatrixAt(i, dummy.matrix)
            continue
        }
        const i3 = i * 3
        dummy.position.set(positions[i3]!, positions[i3 + 1]! + 0.02, positions[i3 + 2]!)
        dummy.rotation.set(0, 0, 0)
        const s = base * (0.4 + lifeT * 1.8)
        dummy.scale.set(s, s, s)
        dummy.updateMatrix()
        layer.mesh.setMatrixAt(i, dummy.matrix)
    }
    layer.mesh.instanceMatrix.needsUpdate = true
    tintMaterial(layer.material, runtime.params.color, runtime.params.opacity * 0.5)
}

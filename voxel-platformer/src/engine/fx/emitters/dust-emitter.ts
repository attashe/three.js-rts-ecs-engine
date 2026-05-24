import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard, pointInZone } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { integrate } from '../core/particle-ops'
import { tintMaterial } from '../materials/material-tint'

/**
 * Dust / sandstorm. Wind-driven puffs that stretch with velocity plus a
 * fine-grain secondary layer that gives the sandstorm body. Spawn
 * entry is biased to the windward face so puffs feel like they sweep
 * across the volume.
 */
export class DustEmitter implements EmitterStrategy {
    readonly type = 'dust' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'dust')
        runtime.particles.count = runtime.params.count
        const grains = buildExtraLayer(runtime, deps, {
            type: 'dustGrains',
            textureKind: 'soft',
            count: Math.max(80, Math.floor(runtime.params.count * 0.35)),
        })
        runtime.extras.push(grains)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const halfX = runtime.params.size.x / 2
        const halfY = runtime.params.size.y / 2
        const halfZ = runtime.params.size.z / 2
        if (recycle) {
            const windDir = Math.sign(runtime.params.windX) || 1
            pool.positions[p3] = -windDir * halfX
            pool.positions[p3 + 1] = rand(rng, -halfY * 0.3, halfY * 0.6)
            pool.positions[p3 + 2] = rand(rng, -halfZ, halfZ)
        } else {
            const target = { x: 0, y: 0, z: 0 }
            pointInZone(runtime, rng, target)
            pool.positions[p3] = target.x
            pool.positions[p3 + 1] = target.y
            pool.positions[p3 + 2] = target.z
        }
        pool.velocities[p3] = runtime.params.windX
        pool.velocities[p3 + 1] = 0
        pool.velocities[p3 + 2] = runtime.params.windZ
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.4)
        pool.ages[i] = recycle ? 0 : rand(rng, 0, runtime.params.lifetime)
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.6, 1.4)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const halfX = p.size.x / 2

        // Slow gust envelope so the storm pulses.
        const gust = 1 + Math.sin(elapsed * 0.4) * 0.65

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const phase = pool.phases[i]!
            pool.velocities[p3]     = p.windX * gust + Math.sin(elapsed * 0.9 + phase) * p.turbulence * 0.6
            pool.velocities[p3 + 1] = Math.sin(elapsed * 0.3 + phase * 1.4) * p.turbulence * 0.25 - p.gravity * 0.05
            pool.velocities[p3 + 2] = p.windZ * gust + Math.cos(elapsed * 0.8 + phase * 1.1) * p.turbulence * 0.6

            integrate(pool, i, dt)

            const px = pool.positions[p3]!
            if (Math.abs(px) > halfX || pool.ages[i]! > pool.lifetimes[i]!) {
                this.spawn(runtime, i, true, rng)
            }
        }

        // Grains use seeds to drift independently — minimal state.
        const grains = runtime.findExtra('dustGrains')
        if (grains) {
            const positions = grains.data.positions as Float32Array
            const seeds = grains.data.seeds as Float32Array
            for (let i = 0; i < grains.count; i++) {
                const i3 = i * 3
                if (seeds[i] === 0) {
                    seeds[i] = rng()
                    positions[i3] = rand(rng, -halfX, halfX)
                    positions[i3 + 1] = rand(rng, -p.size.y * 0.35, p.size.y * 0.55)
                    positions[i3 + 2] = rand(rng, -p.size.z / 2, p.size.z / 2)
                }
                positions[i3]     += p.windX * 0.7 * dt
                positions[i3 + 1] += Math.sin(elapsed * 0.8 + seeds[i]! * TAU) * p.turbulence * 0.08 * dt
                positions[i3 + 2] += p.windZ * 0.7 * dt
                if (Math.abs(positions[i3]!) > halfX) positions[i3] = -Math.sign(positions[i3]!) * halfX
                if (positions[i3 + 1]! < -p.size.y / 2) positions[i3 + 1] = p.size.y / 2
                else if (positions[i3 + 1]! > p.size.y / 2) positions[i3 + 1] = -p.size.y / 2
                if (Math.abs(positions[i3 + 2]!) > p.size.z / 2) positions[i3 + 2] = -Math.sign(positions[i3 + 2]!) * p.size.z / 2
            }
        }
    }

    write(runtime: WeatherZoneRuntime, elapsed: number, ctx: WriteContext): void {
        const primary = runtime.primary
        if (!primary) return
        const p = runtime.params
        const pool = runtime.particles
        const dummy = ctx.dummy
        const baseW = p.particleSize * 4.2
        const baseH = p.particleSize * 1.55

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const px = pool.positions[p3]!
            const py = pool.positions[p3 + 1]!
            const pz = pool.positions[p3 + 2]!
            const yaw = billboardYaw(ctx, px, pz)
            const roll = Math.atan2(pool.velocities[p3 + 1]!, pool.velocities[p3]! + 1e-3)
            const pulse = 1 + Math.sin(elapsed * 1.4 + pool.phases[i]!) * 0.25
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, roll * 0.4)
            dummy.scale.set(baseW * pool.sizes[i]! * pulse, baseH * pool.sizes[i]! * pulse, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity * 0.85)

        const grains = runtime.findExtra('dustGrains')
        if (grains) {
            const positions = grains.data.positions as Float32Array
            const seeds = grains.data.seeds as Float32Array
            const grainScale = p.particleSize * 0.6
            for (let i = 0; i < grains.count; i++) {
                const i3 = i * 3
                dummy.position.set(positions[i3]!, positions[i3 + 1]!, positions[i3 + 2]!)
                dummy.rotation.set(0, 0, 0)
                const pulse = 0.55 + Math.abs(Math.sin(elapsed * 3.2 + seeds[i]! * TAU)) * 0.75
                dummy.scale.set(grainScale * pulse, grainScale * pulse, 1)
                dummy.updateMatrix()
                grains.mesh.setMatrixAt(i, dummy.matrix)
            }
            grains.mesh.instanceMatrix.needsUpdate = true
            tintMaterial(grains.material, p.color, p.opacity * 0.35)
        }
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

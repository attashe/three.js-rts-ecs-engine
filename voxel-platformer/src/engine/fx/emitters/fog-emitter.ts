import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard, pointInZone } from './emitter-base'
import { curlNoise3, rand, TAU, wrap } from '../core/sim-utils'
import { tintMaterial } from '../materials/material-tint'

/**
 * Soft, layered fog. Primary: large translucent billboards drifting on
 * curl noise inside the volume. Extra layer: low ground-fog sheets
 * rolling along the floor for a clear horizon.
 */
export class FogEmitter implements EmitterStrategy {
    readonly type = 'fog' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'fog')
        runtime.particles.count = runtime.params.count
        const ground = buildExtraLayer(runtime, deps, {
            type: 'groundFog',
            textureKind: 'fog',
            count: Math.max(16, Math.floor(runtime.params.count / 5)),
        })
        runtime.extras.push(ground)
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
        pool.velocities[p3] = 0
        pool.velocities[p3 + 1] = 0
        pool.velocities[p3 + 2] = 0
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.8, 1.4)
        pool.ages[i] = rand(rng, 0, runtime.params.lifetime)
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.9, 1.4)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, _rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const halfX = p.size.x / 2
        const halfY = p.size.y / 2
        const halfZ = p.size.z / 2

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const noise = curlNoise3(pool.positions[p3]!, pool.positions[p3 + 1]!, pool.positions[p3 + 2]!, elapsed * 0.12)
            pool.positions[p3]     = wrap(pool.positions[p3]!     + (p.windX * 0.2 + noise.x * 0.15 * p.turbulence) * dt, halfX)
            pool.positions[p3 + 1] = wrap(pool.positions[p3 + 1]! + (noise.y * 0.05) * dt, halfY)
            pool.positions[p3 + 2] = wrap(pool.positions[p3 + 2]! + (p.windZ * 0.2 + noise.z * 0.15 * p.turbulence) * dt, halfZ)
            pool.ages[i]! += dt
        }

        // Ground fog sheet drifts along the floor.
        const ground = runtime.findExtra('groundFog')
        if (ground) {
            const positions = ground.data.positions as Float32Array
            const seeds = ground.data.seeds as Float32Array
            for (let i = 0; i < ground.count; i++) {
                if (seeds[i] === 0) { seeds[i] = Math.random(); positions[i * 3] = rand(Math.random, -halfX, halfX); positions[i * 3 + 2] = rand(Math.random, -halfZ, halfZ) }
                positions[i * 3]     = wrap(positions[i * 3]!     + p.windX * 0.18 * dt, halfX)
                positions[i * 3 + 2] = wrap(positions[i * 3 + 2]! + p.windZ * 0.18 * dt, halfZ)
            }
        }
    }

    write(runtime: WeatherZoneRuntime, elapsed: number, ctx: WriteContext): void {
        const primary = runtime.primary
        if (!primary) return
        const p = runtime.params
        const pool = runtime.particles
        const dummy = ctx.dummy
        // Soft breathing scale — fog should look like slow blooms.
        const breathe = 1 + Math.sin(elapsed * 0.45) * 0.07
        const baseW = p.particleSize * 4.6 * breathe
        const baseH = p.particleSize * 2.5 * breathe

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const px = pool.positions[p3]!
            const py = pool.positions[p3 + 1]!
            const pz = pool.positions[p3 + 2]!
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, pool.phases[i]! * 0.2)
            dummy.scale.set(baseW * pool.sizes[i]!, baseH * pool.sizes[i]!, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity * 0.42)

        const ground = runtime.findExtra('groundFog')
        if (ground) {
            const positions = ground.data.positions as Float32Array
            const groundW = p.particleSize * 6.4
            const groundH = p.particleSize * 1.5
            const groundY = -p.size.y / 2 + 0.4
            for (let i = 0; i < ground.count; i++) {
                const i3 = i * 3
                dummy.position.set(positions[i3]!, groundY, positions[i3 + 2]!)
                dummy.rotation.set(-Math.PI / 2, 0, 0)
                dummy.scale.set(groundW, groundH, 1)
                dummy.updateMatrix()
                ground.mesh.setMatrixAt(i, dummy.matrix)
            }
            ground.mesh.instanceMatrix.needsUpdate = true
            tintMaterial(ground.material, p.color, p.opacity * 0.4)
        }
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

import { PlaneGeometry } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { buildExtraLayer, buildPrimaryBillboard, pointAtTop } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { tintMaterial } from '../materials/material-tint'

/**
 * Tumbling falling leaves with three-axis rotation and a flat shadow
 * disc projected onto the floor — a cheap stand-in for proper shadow
 * mapping that reads well in voxel scenes.
 */
export class LeavesEmitter implements EmitterStrategy {
    readonly type = 'leaves' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'leaf')
        runtime.particles.count = runtime.params.count
        const shadow = buildExtraLayer(runtime, deps, {
            type: 'leafShadows',
            textureKind: 'soft',
            count: Math.max(20, Math.floor(runtime.params.count * 0.34)),
        })
        ;(shadow.geometry as PlaneGeometry).rotateX(-Math.PI / 2)
        runtime.extras.push(shadow)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const target = { x: 0, y: 0, z: 0 }
        pointAtTop(runtime, rng, target)
        pool.positions[p3] = target.x
        pool.positions[p3 + 1] = recycle ? target.y : rand(rng, -runtime.params.size.y / 2, target.y)
        pool.positions[p3 + 2] = target.z
        pool.velocities[p3] = rand(rng, -0.4, 0.4)
        pool.velocities[p3 + 1] = -rand(rng, 0.5, runtime.params.speed)
        pool.velocities[p3 + 2] = rand(rng, -0.4, 0.4)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.7, 1.5)
        pool.ages[i] = 0
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.75, 1.45)
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const bottomY = -p.size.y / 2 + 0.05

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const ph = pool.phases[i]!
            pool.velocities[p3]     = p.windX + Math.sin(elapsed * 1.1 + ph) * p.turbulence * 0.5
            pool.velocities[p3 + 1] = -p.speed - p.gravity * 0.3 + Math.sin(elapsed * 0.7 + ph * 1.6) * 0.25
            pool.velocities[p3 + 2] = p.windZ + Math.cos(elapsed * 1.0 + ph * 1.3) * p.turbulence * 0.5

            pool.positions[p3]     += pool.velocities[p3]! * dt
            pool.positions[p3 + 1] += pool.velocities[p3 + 1]! * dt
            pool.positions[p3 + 2] += pool.velocities[p3 + 2]! * dt
            pool.ages[i]! += dt

            if (pool.positions[p3 + 1]! < bottomY || pool.ages[i]! > pool.lifetimes[i]!) {
                this.spawn(runtime, i, true, rng)
            }
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
            const ph = pool.phases[i]!
            // Three-axis tumble.
            dummy.position.set(px, py, pz)
            dummy.rotation.set(
                Math.sin(elapsed * 1.3 + ph) * 1.2,
                Math.sin(elapsed * 1.7 + ph * 1.3),
                Math.cos(elapsed * 1.1 + ph * 0.7) * 0.9,
            )
            const s = p.particleSize * pool.sizes[i]! * 2
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        // Shadows sample every Nth leaf.
        const shadow = runtime.findExtra('leafShadows')
        if (shadow) {
            const step = Math.max(1, Math.floor(pool.count / shadow.count))
            const groundY = -p.size.y / 2 + 0.02
            for (let i = 0; i < shadow.count; i++) {
                const src = Math.min(pool.count - 1, i * step)
                const s3 = src * 3
                const px = pool.positions[s3]!
                const pz = pool.positions[s3 + 2]!
                const heightAbove = pool.positions[s3 + 1]! - (-p.size.y / 2)
                const heightFactor = Math.max(0.1, 1 - heightAbove / p.size.y)
                const s = p.particleSize * 1.6 * (0.6 + heightFactor)
                dummy.position.set(px, groundY, pz)
                dummy.rotation.set(0, 0, 0)
                dummy.scale.set(s, s, 1)
                dummy.updateMatrix()
                shadow.mesh.setMatrixAt(i, dummy.matrix)
            }
            shadow.mesh.instanceMatrix.needsUpdate = true
            tintMaterial(shadow.material, '#221710', 0.18)
        }
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

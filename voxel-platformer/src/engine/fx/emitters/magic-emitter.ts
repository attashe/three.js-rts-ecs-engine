import { TorusGeometry } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { tintMaterial } from '../materials/material-tint'

/**
 * Orbital "magic motes" plus rotating torus rings. The motes follow
 * gentle elliptical orbits around the zone centre; the ring layer is
 * a small handful of torus meshes that rotate at staggered rates and
 * pulse with the zone's light intensity.
 */
export class MagicEmitter implements EmitterStrategy {
    readonly type = 'magic' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'magic', { additive: true })
        runtime.particles.count = runtime.params.count
        const rings = buildExtraLayer(runtime, deps, {
            type: 'magicRings',
            textureKind: 'soft',
            count: 6,
            materialOpts: { additive: true },
            geometry: new TorusGeometry(1, 0.06, 12, 48),
        })
        runtime.extras.push(rings)
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const r = rand(rng, runtime.params.size.x * 0.15, runtime.params.size.x * 0.45)
        const ang = rng() * TAU
        pool.positions[p3] = Math.cos(ang) * r
        pool.positions[p3 + 1] = rand(rng, -runtime.params.size.y * 0.35, runtime.params.size.y * 0.35)
        pool.positions[p3 + 2] = Math.sin(ang) * r
        pool.velocities[p3] = -Math.sin(ang) * rand(rng, 0.4, 1.0)
        pool.velocities[p3 + 1] = rand(rng, -0.1, 0.2)
        pool.velocities[p3 + 2] = Math.cos(ang) * rand(rng, 0.4, 1.0)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.6, 1.4)
        pool.ages[i] = rand(rng, 0, runtime.params.lifetime)
        pool.lifetimes[i] = runtime.params.lifetime
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            const phase = pool.phases[i]!
            // Spiral wobble — tangential + small radial breathing.
            const x = pool.positions[p3]!
            const z = pool.positions[p3 + 2]!
            const r = Math.hypot(x, z) || 1
            const tangX = -z / r
            const tangZ = x / r
            const breath = Math.sin(elapsed * 0.5 + phase) * p.turbulence * 0.05
            pool.positions[p3]     += (tangX * p.speed * 0.4 + (x / r) * breath) * dt
            pool.positions[p3 + 1] += Math.sin(elapsed * 0.7 + phase * 1.4) * p.turbulence * 0.06 - p.gravity * 0.08 * dt
            pool.positions[p3 + 2] += (tangZ * p.speed * 0.4 + (z / r) * breath) * dt
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
            const yaw = billboardYaw(ctx, px, pz)
            const pulse = 0.8 + Math.sin(elapsed * 3 + pool.phases[i]!) * 0.4
            const s = p.particleSize * pool.sizes[i]! * pulse
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, elapsed + pool.seeds[i]! * TAU)
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        const rings = runtime.findExtra('magicRings')
        if (rings) {
            const ringScale = p.size.x * 0.45
            for (let i = 0; i < rings.count; i++) {
                const off = i / rings.count
                const rate = 0.4 + i * 0.18
                dummy.position.set(0, Math.sin(elapsed * 0.6 + off * TAU) * p.size.y * 0.18, 0)
                dummy.rotation.set(elapsed * rate, elapsed * rate * 0.7, off * TAU)
                const breath = 1 + Math.sin(elapsed * 1.8 + off * TAU) * 0.18
                dummy.scale.set(ringScale * breath, ringScale * breath, ringScale * breath)
                dummy.updateMatrix()
                rings.mesh.setMatrixAt(i, dummy.matrix)
            }
            rings.mesh.instanceMatrix.needsUpdate = true
            tintMaterial(rings.material, p.color, p.opacity * 0.6)
        }
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

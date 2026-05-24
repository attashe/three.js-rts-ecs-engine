import { CylinderGeometry, Vector3 } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, ExtraLayer, WeatherZoneRuntime, WriteContext } from '../core/types'
import { billboardYaw, buildExtraLayer, buildPrimaryBillboard, pointInZone } from './emitter-base'
import { rand, TAU } from '../core/sim-utils'
import { applyLightFlash } from '../lights/fx-light-controller'
import { tintMaterial } from '../materials/material-tint'

const Y_AXIS = new Vector3(0, 1, 0)

/**
 * Lightning. Primary: sparse "charged motes" near the cloud-top layer.
 * Extra layer: segmented cylinder bolts emitted as a coordinated
 * strike, with branching forks. Strikes are scheduled by `lifetime`
 * (so big `lifetime` = rare strikes) and each one resets the entire
 * bolt buffer.
 */
export class LightningEmitter implements EmitterStrategy {
    readonly type = 'lightning' as const

    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated {
        const { mesh } = buildPrimaryBillboard(runtime, deps, 'spark', { additive: true })
        runtime.particles.count = runtime.params.count
        const bolts = buildExtraLayer(runtime, deps, {
            type: 'lightningBolts',
            textureKind: 'soft',
            count: 30,
            materialOpts: { additive: true },
            arrays: { starts: 3, ends: 3, widths: 1 },
            geometry: new CylinderGeometry(0.5, 0.5, 1, 6, 1, true),
        })
        runtime.extras.push(bolts)
        ;(runtime as { _nextStrike?: number })._nextStrike = runtime.elapsed + 0.6
        return { primary: mesh, extras: runtime.extras }
    }

    spawn(runtime: WeatherZoneRuntime, i: number, _recycle: boolean, rng: () => number): void {
        const pool = runtime.particles
        const p3 = i * 3
        const half = runtime.params.size
        pool.positions[p3] = rand(rng, -half.x / 2, half.x / 2)
        pool.positions[p3 + 1] = rand(rng, half.y * 0.2, half.y * 0.45)
        pool.positions[p3 + 2] = rand(rng, -half.z / 2, half.z / 2)
        pool.velocities[p3] = rand(rng, -0.3, 0.3)
        pool.velocities[p3 + 1] = 0
        pool.velocities[p3 + 2] = rand(rng, -0.3, 0.3)
        pool.phases[i] = rng() * TAU
        pool.seeds[i] = rng()
        pool.sizes[i] = rand(rng, 0.4, 1)
        pool.ages[i] = 0
        pool.lifetimes[i] = runtime.params.lifetime * rand(rng, 0.4, 1.2)
        ;(void pointInZone) // silence unused-import while keeping symmetry
    }

    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void {
        const p = runtime.params
        const pool = runtime.particles
        const halfX = p.size.x / 2
        const halfZ = p.size.z / 2

        for (let i = 0; i < pool.count; i++) {
            const p3 = i * 3
            pool.positions[p3]     += pool.velocities[p3]! * dt
            pool.positions[p3 + 2] += pool.velocities[p3 + 2]! * dt
            pool.ages[i]! += dt
            if (Math.abs(pool.positions[p3]!) > halfX) pool.positions[p3] = -Math.sign(pool.positions[p3]!) * halfX
            if (Math.abs(pool.positions[p3 + 2]!) > halfZ) pool.positions[p3 + 2] = -Math.sign(pool.positions[p3 + 2]!) * halfZ
            if (pool.ages[i]! > pool.lifetimes[i]!) this.spawn(runtime, i, true, rng)
        }

        // Schedule strikes — rare bursts with a short visible window.
        const next = (runtime as { _nextStrike?: number })._nextStrike ?? 0
        const bolts = runtime.findExtra('lightningBolts')
        if (bolts) {
            const ages = bolts.data.ages as Float32Array
            for (let i = 0; i < bolts.count; i++) ages[i]! += dt
            if (elapsed >= next) {
                resetStrike(bolts, runtime, rng)
                ;(runtime as { _lightningFlash?: number })._lightningFlash = p.lightIntensity * rand(rng, 10.0, 16.0)
                ;(runtime as { _nextStrike?: number })._nextStrike = elapsed + Math.max(0.8, p.lifetime) * rand(rng, 0.6, 1.4)
            }
        }

        const flash = (runtime as { _lightningFlash?: number })._lightningFlash ?? 0
        if (flash > 0) {
            if (p.lightEnabled) applyLightFlash(runtime, flash)
            ;(runtime as { _lightningFlash?: number })._lightningFlash = Math.max(0, flash - dt * p.lightIntensity * 10)
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
            const pulse = 0.4 + Math.abs(Math.sin(elapsed * 3 + pool.phases[i]!)) * 0.6
            const s = p.particleSize * pool.sizes[i]! * pulse
            const yaw = billboardYaw(ctx, px, pz)
            dummy.position.set(px, py, pz)
            dummy.rotation.set(0, yaw, elapsed * 5 + pool.seeds[i]! * TAU)
            dummy.scale.set(s, s, 1)
            dummy.updateMatrix()
            primary.setMatrixAt(i, dummy.matrix)
        }
        primary.instanceMatrix.needsUpdate = true
        tintMaterial(primary.material, p.color, p.opacity)

        const bolts = runtime.findExtra('lightningBolts')
        if (bolts) writeBolts(bolts, runtime, ctx, elapsed)
    }

    dispose(_runtime: WeatherZoneRuntime): void {}
}

/**
 * Generate a coordinated cloud-to-ground lightning strike. 2–5 main
 * branches, 4–7 segments each, ~28% chance of a sub-branch per segment.
 * Per-segment widths fall off for forks. Faithful port of the demo's
 * generator — see `import/particle_system_lightning_extended_liquids.html`
 * § "resetLightningStrike".
 */
function resetStrike(bolts: ExtraLayer, runtime: WeatherZoneRuntime, rng: () => number): void {
    const starts = bolts.data.starts as Float32Array
    const ends = bolts.data.ends as Float32Array
    const widths = bolts.data.widths as Float32Array
    const ages = bolts.data.ages as Float32Array
    const lifetimes = bolts.data.lifetimes as Float32Array
    for (let i = 0; i < bolts.count; i++) ages[i] = 99

    const p = runtime.params
    const branches = Math.floor(rand(rng, 2, 5))
    const topY = p.size.y / 2
    const bottomY = -p.size.y / 2 + 0.15
    let cursor = 0

    for (let b = 0; b < branches && cursor < bolts.count; b++) {
        const start = new Vector3(
            rand(rng, -p.size.x * 0.14, p.size.x * 0.14),
            topY,
            rand(rng, -p.size.z * 0.14, p.size.z * 0.14),
        )
        const target = new Vector3(
            rand(rng, -p.size.x * 0.36, p.size.x * 0.36),
            rand(rng, bottomY, bottomY + p.size.y * 0.28),
            rand(rng, -p.size.z * 0.36, p.size.z * 0.36),
        )
        const steps = Math.floor(rand(rng, 4, 7))
        const prev = start.clone()
        const next = new Vector3()

        for (let s = 1; s <= steps && cursor < bolts.count; s++) {
            const tt = s / steps
            next.copy(start).lerp(target, tt)
            const spread = (1 - tt) * 0.5 + 0.12
            next.x += rand(rng, -p.size.x * 0.08, p.size.x * 0.08) * spread
            next.z += rand(rng, -p.size.z * 0.08, p.size.z * 0.08) * spread
            if (s < steps) next.y += rand(rng, -0.22, 0.22)

            const a = cursor * 3
            starts[a]     = prev.x; starts[a + 1] = prev.y; starts[a + 2] = prev.z
            ends[a]       = next.x; ends[a + 1]   = next.y; ends[a + 2]   = next.z
            ages[cursor] = rand(rng, 0, 0.03)
            lifetimes[cursor] = rand(rng, 0.08, 0.16)
            widths[cursor] = rand(rng, 0.08, 0.17)
            cursor++

            if (rng() < 0.28 && cursor < bolts.count && s < steps - 1) {
                const side = next.clone().add(new Vector3(rand(rng, -1, 1), rand(rng, -1.4, -0.2), rand(rng, -1, 1)))
                const a2 = cursor * 3
                starts[a2]     = next.x; starts[a2 + 1] = next.y; starts[a2 + 2] = next.z
                ends[a2]       = side.x; ends[a2 + 1]   = side.y; ends[a2 + 2]   = side.z
                ages[cursor] = rand(rng, 0.01, 0.05)
                lifetimes[cursor] = rand(rng, 0.05, 0.12)
                widths[cursor] = rand(rng, 0.05, 0.1)
                cursor++
            }
            prev.copy(next)
        }
    }
}

const tmpDir = new Vector3()
function writeBolts(bolts: ExtraLayer, runtime: WeatherZoneRuntime, ctx: WriteContext, elapsed: number): void {
    const starts = bolts.data.starts as Float32Array
    const ends = bolts.data.ends as Float32Array
    const widths = bolts.data.widths as Float32Array
    const ages = bolts.data.ages as Float32Array
    const lifetimes = bolts.data.lifetimes as Float32Array
    const dummy = ctx.dummy
    for (let i = 0; i < bolts.count; i++) {
        const t = ages[i]! / Math.max(0.001, lifetimes[i]!)
        if (t >= 1 || ages[i]! < 0) {
            dummy.position.set(0, 0, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix()
            bolts.mesh.setMatrixAt(i, dummy.matrix)
            continue
        }
        const i3 = i * 3
        const sx = starts[i3]!, sy = starts[i3 + 1]!, sz = starts[i3 + 2]!
        const ex = ends[i3]!,   ey = ends[i3 + 1]!,   ez = ends[i3 + 2]!
        const mx = (sx + ex) * 0.5, my = (sy + ey) * 0.5, mz = (sz + ez) * 0.5
        tmpDir.set(ex - sx, ey - sy, ez - sz)
        const len = tmpDir.length()
        tmpDir.normalize()
        dummy.position.set(mx, my, mz)
        dummy.quaternion.setFromUnitVectors(Y_AXIS, tmpDir)
        const w = widths[i]! * (1 - t)
        dummy.scale.set(w, len, w)
        dummy.updateMatrix()
        bolts.mesh.setMatrixAt(i, dummy.matrix)
    }
    bolts.mesh.instanceMatrix.needsUpdate = true
    // Quick flicker on the bolt material.
    const flicker = 0.4 + Math.abs(Math.sin(elapsed * 52)) * 0.6
    tintMaterial(bolts.material, runtime.params.color, runtime.params.opacity * flicker)
}

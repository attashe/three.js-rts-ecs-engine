import { InstancedMesh, PlaneGeometry, MeshBasicMaterial } from 'three'
import type { EmitterCreated, EmitterDeps, EmitterStrategy, WeatherZoneRuntime, WriteContext } from '../core/types'

/**
 * Darkness FX zone. No particles, no visible primitives — the entire
 * effect is the zone's PointLight running at *negative* intensity.
 * Three.js's lighting model accumulates light contributions linearly
 * before the final HDR clamp, so a negative light subtracts from the
 * sum and produces a soft dark dome on every PBR surface within its
 * `lightDistance` radius. Useful for caves, dungeons, cursed areas,
 * any place where the level designer wants a localised "negative
 * lightning" pool that the existing global lights can't easily
 * suppress.
 *
 * The light's sign is set in `modulateZoneLight` (it negates the
 * authored `lightIntensity`), so the zone-preset declares a *positive*
 * magnitude in its params — that's friendlier to the editor's number
 * input. The flash/strike helpers and the LightBudget treat the light
 * like any other zone light; off-budget far-away darkness zones fade
 * out cleanly.
 *
 * The emitter still needs a primary InstancedMesh — the zone
 * framework adds one to the scene unconditionally and reads
 * `runtime.primary` for the `write` step. We give it a degenerate
 * mesh (zero instances) so the per-frame cost is just the matrix
 * count being checked against 0.
 */
export class DarknessEmitter implements EmitterStrategy {
    readonly type = 'darkness' as const

    create(_runtime: WeatherZoneRuntime, _deps: EmitterDeps): EmitterCreated {
        // Zero-instance placeholder. We can't return `null` because
        // the WeatherZone framework expects an InstancedMesh on the
        // primary slot. A single-instance mesh with `count = 0` is
        // cheap and never renders — three.js skips the draw call.
        const geometry = new PlaneGeometry(0.001, 0.001)
        const material = new MeshBasicMaterial({ visible: false })
        const mesh = new InstancedMesh(geometry, material, 1)
        mesh.count = 0
        mesh.frustumCulled = false
        return { primary: mesh, extras: [] }
    }

    spawn(_runtime: WeatherZoneRuntime, _i: number, _recycle: boolean, _rng: () => number): void {
        // No particles to spawn.
    }

    update(_runtime: WeatherZoneRuntime, _dt: number, _elapsed: number, _rng: () => number): void {
        // Light intensity / position is handled by the framework's
        // `modulateZoneLight` (the negation lives there) plus the
        // zone group's own position. Nothing to do per frame.
    }

    write(_runtime: WeatherZoneRuntime, _elapsed: number, _ctx: WriteContext): void {
        // Nothing to write — the primary mesh has zero instances.
    }

    dispose(runtime: WeatherZoneRuntime): void {
        // The primary mesh's geometry + material aren't part of the
        // shared primitives cache (we built throwaway 0.001-unit ones
        // in `create`), so dispose them here to avoid leaks on rebuild.
        if (runtime.primary) {
            runtime.primary.geometry.dispose()
            const mat = runtime.primary.material
            if (Array.isArray(mat)) for (const m of mat) m.dispose()
            else mat.dispose()
        }
    }
}

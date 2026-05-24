import { InstancedMesh, PlaneGeometry } from 'three'
import type { EmitterDeps, ExtraLayer, ParticleMaterialOpts, WeatherZoneRuntime, WriteContext } from '../core/types'
import { rand } from '../core/sim-utils'

/**
 * Helpers shared by every concrete emitter. Keeps the strategy files
 * focused on per-effect physics + visuals; allocation boilerplate
 * (geometries, instanced meshes, scratch arrays) lives here.
 */

export function buildPrimaryBillboard(
    runtime: WeatherZoneRuntime,
    deps: EmitterDeps,
    textureKind: string,
    overrides: Partial<ParticleMaterialOpts> = {},
): { mesh: InstancedMesh; geometry: PlaneGeometry } {
    const p = runtime.params
    const geometry = new PlaneGeometry(1, 1)
    const material = deps.materials.particleMaterial({
        texture: deps.textures.particle(textureKind),
        color: p.color,
        opacity: p.opacity,
        cacheable: false,
        ...overrides,
    })
    const mesh = new InstancedMesh(geometry, material, p.count)
    mesh.frustumCulled = false
    return { mesh, geometry }
}

export interface ExtraLayerInit {
    type: string
    textureKind: string
    count: number
    materialOpts?: Partial<ParticleMaterialOpts>
    /** Allocate extra scratch arrays alongside the mesh. */
    arrays?: Record<string, number>
    /** Override default plane geometry if you need a cylinder, box, etc. */
    geometry?: import('three').BufferGeometry
}

export function buildExtraLayer(
    runtime: WeatherZoneRuntime,
    deps: EmitterDeps,
    init: ExtraLayerInit,
): ExtraLayer {
    const count = Math.max(1, Math.floor(init.count))
    const geometry = init.geometry ?? new PlaneGeometry(1, 1)
    const material = deps.materials.particleMaterial({
        texture: deps.textures.particle(init.textureKind),
        color: runtime.params.color,
        opacity: runtime.params.opacity,
        cacheable: false,
        ...(init.materialOpts ?? {}),
    })
    const mesh = new InstancedMesh(geometry, material, count)
    mesh.frustumCulled = false

    const data: ExtraLayer['data'] = {
        positions: new Float32Array(count * 3),
        velocities: new Float32Array(count * 3),
        ages: new Float32Array(count),
        lifetimes: new Float32Array(count),
        seeds: new Float32Array(count),
    }
    if (init.arrays) {
        for (const [k, width] of Object.entries(init.arrays)) {
            data[k] = new Float32Array(count * Math.max(1, width))
        }
    }
    return { type: init.type, count, mesh, geometry, material, data }
}

/** Random point inside the zone's AABB. Useful for fog/firefly spawn. */
export function pointInZone(runtime: WeatherZoneRuntime, rng: () => number, out: { x: number; y: number; z: number }): void {
    const { x, y, z } = runtime.params.size
    out.x = rand(rng, -x / 2, x / 2)
    out.y = rand(rng, -y / 2, y / 2)
    out.z = rand(rng, -z / 2, z / 2)
}

/** Spawn position on the top face of the zone (for falling effects). */
export function pointAtTop(runtime: WeatherZoneRuntime, rng: () => number, out: { x: number; y: number; z: number }): void {
    const { x, y, z } = runtime.params.size
    out.x = rand(rng, -x / 2, x / 2)
    out.y = y / 2
    out.z = rand(rng, -z / 2, z / 2)
}

export function billboardYaw(ctx: WriteContext, localX: number, localZ: number): number {
    return Math.atan2(
        ctx.cameraPosition.x - (ctx.zonePosition.x + localX),
        ctx.cameraPosition.z - (ctx.zonePosition.z + localZ),
    )
}

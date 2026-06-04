import { isCollidable, isPathSurface } from '../../engine/voxel/palette'
import { isRecord } from './worldgen-util'
import type { WorldgenCompileContext } from './compile-context'
import type { VoxelCoord } from './spec-types'
import type { SurfaceCandidate, UndergroundFeature, UndergroundState } from './underground-types'
import { coordKey, isPassableAt, keyToCoord } from './underground-stamping'
import { readNumberRange } from './worldgen-parse'

export interface UndergroundSurfaceOptions {
    kind: string
    yRange: [number, number]
    searchRadius: number
    requireAirAbove: number
}

export function refreshAllFeatureSurfaces(ctx: WorldgenCompileContext, state: UndergroundState): void {
    for (const feature of state.features.values()) refreshFeatureSurfaces(ctx, feature)
}

export function refreshFeatureSurfaces(ctx: WorldgenCompileContext, feature: UndergroundFeature): void {
    feature.floor = new Set()
    feature.wall = new Set()
    feature.ceiling = new Set()
    const bounds = feature.bounds ?? { minX: 1, maxX: ctx.sizeX - 2, minY: 1, maxY: ctx.sizeY - 2, minZ: 1, maxZ: ctx.sizeZ - 2 }
    for (let y = Math.max(1, bounds.minY); y <= Math.min(ctx.sizeY - 2, bounds.maxY); y += 1) {
        for (let z = Math.max(1, bounds.minZ); z <= Math.min(ctx.sizeZ - 2, bounds.maxZ); z += 1) {
            for (let x = Math.max(1, bounds.minX); x <= Math.min(ctx.sizeX - 2, bounds.maxX); x += 1) {
                const key = coordKey(x, y, z)
                if (feature.cells.size > 0 && !feature.cells.has(key)) continue
                if (!isPassableAt(ctx, x, y, z)) continue
                if (isPathSurface(ctx.chunks.palette, ctx.chunks.getVoxel(x, y - 1, z)) && isPassableAt(ctx, x, y + 1, z)) feature.floor.add(key)
                if (isCollidable(ctx.chunks.palette, ctx.chunks.getVoxel(x, y + 1, z))) feature.ceiling.add(key)
                if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => isCollidable(ctx.chunks.palette, ctx.chunks.getVoxel(x + dx, y, z + dz)))) feature.wall.add(key)
            }
        }
    }
}

export function findBestSurfaceNear(
    ctx: WorldgenCompileContext,
    _state: UndergroundState,
    x: number,
    z: number,
    opts: { kind: string; yRange: [number, number]; searchRadius: number; requireAirAbove?: number },
): SurfaceCandidate | null {
    const candidates: SurfaceCandidate[] = []
    for (let dz = -opts.searchRadius; dz <= opts.searchRadius; dz += 1) {
        for (let dx = -opts.searchRadius; dx <= opts.searchRadius; dx += 1) {
            if (Math.hypot(dx, dz) > opts.searchRadius) continue
            const wx = x + dx
            const wz = z + dz
            if (!ctx.inXZ(wx, wz)) continue
            for (let y = opts.yRange[0]; y <= opts.yRange[1]; y += 1) {
                const candidate = surfaceAt(ctx, wx, y, wz, opts.kind, opts.requireAirAbove ?? 2)
                if (!candidate) continue
                const distance = Math.hypot(dx, dz)
                candidates.push({ ...candidate, score: -distance + ctx.rand01('surface', wx, y, wz) * 0.01 })
            }
        }
    }
    candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x || a.z - b.z)
    return candidates[0] ?? null
}

export function surfaceAt(ctx: WorldgenCompileContext, x: number, y: number, z: number, kind: string, requireAir: number): SurfaceCandidate | null {
    if (!ctx.inXYZ(x, y, z)) return null
    if (kind === 'floor') {
        if (!isPathSurface(ctx.chunks.palette, ctx.chunks.getVoxel(x, y - 1, z))) return null
        for (let h = 0; h < requireAir; h += 1) if (!isPassableAt(ctx, x, y + h, z)) return null
        return { x, y, z, kind, score: y }
    }
    if (kind === 'ceiling') {
        if (!isCollidable(ctx.chunks.palette, ctx.chunks.getVoxel(x, y + 1, z))) return null
        for (let h = 0; h < requireAir; h += 1) if (!isPassableAt(ctx, x, y - h, z)) return null
        return { x, y, z, kind, score: -y }
    }
    if (kind === 'wall') {
        if (!isPassableAt(ctx, x, y, z)) return null
        const normal = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dz]) => isCollidable(ctx.chunks.palette, ctx.chunks.getVoxel(x + dx, y, z + dz)))
        return normal ? { x, y, z, kind, normal: { x: normal[0], z: normal[1] }, score: ctx.rand01('wall', x, y, z) } : null
    }
    return null
}

export function undergroundSpawn(ctx: WorldgenCompileContext, state: UndergroundState): VoxelCoord {
    const spawn = ctx.report.resolvedAnchors.spawn ?? ctx.report.resolvedObjects.spawn
    if (spawn) return spawn
    ctx.warning({ code: 'missing_reference', message: 'No underground spawn marker was resolved; using the first floor surface.', path: '$.structures' })
    return undergroundFallbackSpawn(ctx, state)
}

export function undergroundFallbackSpawn(_ctx: WorldgenCompileContext, state: UndergroundState): VoxelCoord {
    for (const feature of state.features.values()) {
        const first = feature.floor.values().next()
        if (!first.done) {
            const [x, y, z] = keyToCoord(first.value)
            return { x: x + 0.5, y, z: z + 0.5 }
        }
    }
    return { x: 0.5, y: 1, z: 0.5 }
}

export function readSurfaceOptions(ctx: WorldgenCompileContext, value: unknown, path: string): UndergroundSurfaceOptions {
    const source = isRecord(value) ? value : {}
    const kind = typeof source.kind === 'string' ? source.kind : 'floor'
    const range = readNumberRange(ctx, source.y_range, `${path}.y_range`, [1, ctx.sizeY - 2]) ?? [1, ctx.sizeY - 2]
    const searchRadius = Math.max(0, Math.floor(ctx.number(source.search_radius, 4, `${path}.search_radius`, { min: 0 })))
    const requireAirAbove = Math.max(1, Math.floor(ctx.number(source.require_air_above ?? source.require_air, 2, `${path}.require_air_above`, { min: 1 })))
    return { kind, yRange: [Math.max(1, Math.round(Math.min(range[0], range[1]))), Math.min(ctx.sizeY - 2, Math.round(Math.max(range[0], range[1])))], searchRadius, requireAirAbove }
}

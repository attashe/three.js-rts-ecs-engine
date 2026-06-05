import { BLOCK, isCollidable } from '../../engine/voxel/palette'
import type { WorldgenCompileContext } from './compile-context'
import type { Vec3Tuple } from './spec-types'
import type { UndergroundFeature, UndergroundState } from './underground-types'
import { boundsAround, mergeBounds } from './worldgen-math'
import { readVec3 } from './worldgen-parse'

export function ensureFeature(state: UndergroundState, id: string): UndergroundFeature {
    let feature = state.features.get(id)
    if (!feature) {
        feature = { id, cells: new Set(), floor: new Set(), wall: new Set(), ceiling: new Set(), bounds: null, meta: {} }
        state.features.set(id, feature)
    }
    return feature
}

export function stampTunnelCell(ctx: WorldgenCompileContext, feature: UndergroundFeature, x: number, floorY: number, z: number, halfWidth: number, height: number, floorBlock: number): void {
    for (let dz = -halfWidth; dz <= halfWidth; dz += 1) {
        for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
            if (Math.abs(dx) + Math.abs(dz) > halfWidth + 1) continue
            stampFloorCell(ctx, feature, x + dx, floorY, z + dz, floorBlock, height)
        }
    }
}

export function stampFloorCell(ctx: WorldgenCompileContext, feature: UndergroundFeature, x: number, floorY: number, z: number, floorBlock: number, airHeight = 3): void {
    if (!ctx.inXYZ(x, floorY, z)) return
    setSolid(ctx, x, floorY - 1, z, floorBlock)
    for (let y = floorY; y <= Math.min(ctx.sizeY - 2, floorY + airHeight); y += 1) carveAir(ctx, feature, x, y, z)
    feature.floor.add(coordKey(x, floorY, z))
    feature.bounds = mergeBounds(feature.bounds, { minX: x, maxX: x, minY: floorY - 1, maxY: Math.min(ctx.sizeY - 2, floorY + airHeight), minZ: z, maxZ: z })
}

export function carveSphere(ctx: WorldgenCompileContext, feature: UndergroundFeature, cx: number, cy: number, cz: number, radius: number): void {
    const r = Math.ceil(radius)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z += 1) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
                if (Math.hypot(x - cx, y - cy, z - cz) <= radius) carveAir(ctx, feature, x, y, z)
            }
        }
    }
    feature.bounds = mergeBounds(feature.bounds, boundsAround(cx, cy, cz, radius, radius, radius))
}

export function carveAir(ctx: WorldgenCompileContext, feature: UndergroundFeature, x: number, y: number, z: number): void {
    if (!ctx.inXYZ(x, y, z)) return
    if (ctx.chunks.getVoxel(x, y, z) === BLOCK.air) {
        feature.cells.add(coordKey(x, y, z))
        feature.bounds = mergeBounds(feature.bounds, { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z })
        return
    }
    ctx.setVoxel(x, y, z, BLOCK.air)
    feature.cells.add(coordKey(x, y, z))
    feature.bounds = mergeBounds(feature.bounds, { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z })
}

export function setSolid(ctx: WorldgenCompileContext, x: number, y: number, z: number, block: number): void {
    if (ctx.inXYZ(x, y, z)) ctx.setVoxel(x, y, z, block)
}

export function flattenUndergroundFootprint(ctx: WorldgenCompileContext, x: number, y: number, z: number, width: number, depth: number): void {
    const minX = x - Math.floor(width / 2)
    const minZ = z - Math.floor(depth / 2)
    for (let dz = 0; dz < depth; dz += 1) {
        for (let dx = 0; dx < width; dx += 1) {
            const wx = minX + dx
            const wz = minZ + dz
            setSolid(ctx, wx, y - 1, wz, BLOCK.stone)
            for (let h = 0; h < 5; h += 1) if (ctx.inXYZ(wx, y + h, wz)) ctx.setVoxel(wx, y + h, wz, BLOCK.air)
        }
    }
}

export function isPassableAt(ctx: WorldgenCompileContext, x: number, y: number, z: number): boolean {
    return ctx.inXYZ(x, y, z) && !isCollidable(ctx.chunks.palette, ctx.chunks.getVoxel(x, y, z))
}

export function resolvePoint(ctx: WorldgenCompileContext, state: UndergroundState, value: unknown, path: string): Vec3Tuple | null {
    if (Array.isArray(value)) return readVec3(ctx, value, path)
    if (typeof value === 'string') {
        const trimmed = value.trim()
        const object = ctx.report.resolvedObjects[trimmed] ?? ctx.report.resolvedAnchors[trimmed]
        if (object) return [object.x, object.y, object.z]
        const [featureId, socket] = trimmed.split('.')
        const feature = state.features.get(featureId ?? '')
        if (feature?.meta) {
            if (socket === 'center' && feature.meta.center) return feature.meta.center
            if (socket === 'bottom' && feature.meta.bottom) return feature.meta.bottom
            if (!socket && feature.meta.center) return feature.meta.center
        }
    }
    ctx.error({ code: 'missing_reference', message: `${path} must reference a known point.`, path, details: { value } })
    return null
}

export function coordKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

export function keyToCoord(key: string): Vec3Tuple {
    const [x, y, z] = key.split(',').map(Number)
    return [x ?? 0, y ?? 0, z ?? 0]
}

import type { Zone } from '../../engine/ecs/zones'
import { BLOCK } from '../../engine/voxel/palette'
import {
    generateStructureAsset,
    measureStructurePlacement,
    placeStructureAsset,
    prefabSource,
    structurePropPlacements,
    type StructureAsset,
} from '../../procedural-structures'
import { isRecord } from './worldgen-util'
import type { WorldgenCompileContext } from './compile-context'
import type { StructurePlacementSpec, Vec3Tuple, VoxelCoord } from './spec-types'
import type { UndergroundState } from './underground-types'
import type { WorldgenLevelDraft } from './level-draft'
import { pointOnSpline3 } from './worldgen-math'
import { readVec2 } from './worldgen-parse'
import { flattenUndergroundFootprint, setSolid } from './underground-stamping'
import { findBestSurfaceNear, readSurfaceOptions } from './underground-surfaces'

const MARKER_ASSETS = new Set(['marker.spawn', 'marker.player'])
const PORTAL_ASSET = 'fixed.portal.blue_stone'
const BRIDGE_ASSET = 'fixed.bridge.broken_stone'
const SHRINE_ASSET = 'fixed.shrine.moonstone'
const DWARF_ROOM_ASSETS = new Set([
    'fixed.room.dwarf_living',
    'fixed.room.dwarf_bunks',
    'fixed.room.dwarf_meeting',
    'fixed.room.dwarf_shop',
    'fixed.room.dwarf_forge',
    'fixed.room.dwarf_storage',
    'fixed.room.mine_office',
    'fixed.room.ore_storage',
    'fixed.room.rail_station',
])

export function placeUndergroundStructures(ctx: WorldgenCompileContext, state: UndergroundState, draft: WorldgenLevelDraft): void {
    const structures = ctx.spec.structures ?? []
    for (let i = 0; i < structures.length; i += 1) placeUndergroundStructure(ctx, state, draft, structures[i]!, `$.structures[${i}]`)
}

function placeUndergroundStructure(ctx: WorldgenCompileContext, state: UndergroundState, draft: WorldgenLevelDraft, spec: StructurePlacementSpec, path: string): boolean {
    const required = spec.required !== false
    const assetId = typeof spec.asset === 'string' ? spec.asset.trim() : ''
    const point = resolveUndergroundPlacement(ctx, state, spec, path, required)
    if (!point) return false

    if (MARKER_ASSETS.has(assetId)) {
        const coord = { x: point.x + 0.5, y: point.y, z: point.z + 0.5 }
        if (assetId === 'marker.spawn' || spec.id === 'spawn') ctx.resolveAnchor('spawn', coord)
        ctx.resolveObject(spec.id, coord)
        ctx.report.placements.push({ id: spec.id, kind: 'underground_marker', assetId, x: coord.x, y: coord.y, z: coord.z })
        return true
    }

    if (assetId === PORTAL_ASSET || assetId === 'prefab.portal-gate') {
        const asset = generateStructureAsset(prefabSource('portal-gate'), { palette: ctx.chunks.palette })
        return placeUndergroundStructureAsset(ctx, draft, spec.id, path, assetId, asset, point, 'portal', required)
    }

    if (assetId === BRIDGE_ASSET) {
        stampBridgeDecor(ctx, point)
        const coord = { x: point.x + 0.5, y: point.y, z: point.z + 0.5 }
        ctx.resolveObject(spec.id, coord)
        ctx.report.placements.push({ id: spec.id, kind: 'underground_decor', assetId, x: coord.x, y: coord.y, z: coord.z })
        return true
    }

    if (assetId === SHRINE_ASSET) {
        stampShrineDecor(ctx, point)
        const coord = { x: point.x + 0.5, y: point.y, z: point.z + 2.5 }
        ctx.resolveObject(spec.id, coord)
        draft.props.push({
            id: `worldgen:${spec.id}:shrine`,
            kind: 'portal-shrine',
            position: { x: point.x + 0.5, y: point.y, z: point.z + 0.5 },
            yaw: 0,
            scale: 1,
            gridAligned: false,
        })
        ctx.report.placements.push({ id: spec.id, kind: 'underground_decor', assetId, x: coord.x, y: coord.y, z: coord.z })
        return true
    }

    if (DWARF_ROOM_ASSETS.has(assetId)) {
        stampDwarfRoomDecor(ctx, point, assetId)
        const coord = { x: point.x + 0.5, y: point.y, z: point.z + 0.5 }
        ctx.resolveObject(spec.id, coord)
        ctx.report.placements.push({ id: spec.id, kind: 'underground_decor', assetId, x: coord.x, y: coord.y, z: coord.z })
        return true
    }

    return placementProblem(ctx, required, path, `Unsupported underground structure asset "${assetId}".`, { id: spec.id, asset: spec.asset })
}

function placeUndergroundStructureAsset(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    id: string,
    path: string,
    assetId: string,
    asset: StructureAsset,
    point: { x: number; y: number; z: number },
    kind: string,
    required: boolean,
): boolean {
    const measure = measureStructurePlacement(asset, {
        origin: point,
        rotation: 0,
        anchor: 'bottom-center',
    })
    if (
        measure.bounds.minX < 0 ||
        measure.bounds.minY < 0 ||
        measure.bounds.minZ < 0 ||
        measure.bounds.maxX >= ctx.sizeX ||
        measure.bounds.maxY >= ctx.sizeY ||
        measure.bounds.maxZ >= ctx.sizeZ
    ) {
        return placementProblem(ctx, required, path, `Underground structure "${id}" visual bounds leave world bounds.`, { id, bounds: measure.bounds })
    }
    const result = placeStructureAsset(ctx.chunks, asset, { origin: point, rotation: 0, anchor: 'bottom-center' })
    ctx.writtenVoxels += result.changedVoxels
    draft.props.push(...structurePropPlacements(asset, { origin: point, rotation: 0, anchor: 'bottom-center' }, `worldgen:${id}`))
    const access = { x: point.x + 0.5, y: point.y, z: point.z + Math.floor(asset.footprint.depth / 2) + 1.5 }
    ctx.resolveObject(id, access)
    ctx.report.placements.push({ id, kind: 'underground_structure', assetId, assetKind: kind, x: point.x, y: point.y, z: point.z, access, changedVoxels: result.changedVoxels })
    if (kind === 'portal') draft.zones.push(inactivePortalMarkerZone(id, access))
    return true
}

function resolveUndergroundPlacement(
    ctx: WorldgenCompileContext,
    state: UndergroundState,
    spec: StructurePlacementSpec,
    path: string,
    required: boolean,
): { x: number; y: number; z: number } | null {
    const place = isRecord(spec.place) ? spec.place : null
    if (place && place.mode === 'room_center') {
        const roomId = typeof place.room === 'string' ? place.room.trim() : ''
        const room = state.features.get(roomId)
        if (!room?.meta.center) {
            placementProblem(ctx, required, path, `Unknown room "${roomId}".`, { id: spec.id, room: roomId })
            return null
        }
        const [x, y, z] = room.meta.center
        const surface = findBestSurfaceNear(ctx, state, x, z, { kind: 'floor', yRange: [Math.max(1, y - 8), Math.min(ctx.sizeY - 2, y + 8)], searchRadius: 5 })
        return surface ? { x: surface.x, y: surface.y, z: surface.z } : { x: Math.round(x), y: Math.round(y), z: Math.round(z) }
    }
    if (place && place.mode === 'surface_at_xz') {
        const x = Math.round(ctx.number(place.x, 0, `${path}.place.x`, { min: 0, max: ctx.sizeX - 1 }))
        const z = Math.round(ctx.number(place.z, 0, `${path}.place.z`, { min: 0, max: ctx.sizeZ - 1 }))
        const surface = findBestSurfaceNear(ctx, state, x, z, readSurfaceOptions(ctx, place, `${path}.place`))
        if (!surface) {
            placementProblem(ctx, required, path, `No underground surface for "${spec.id}" near ${x},${z}.`, { id: spec.id, x, z })
            return null
        }
        return { x: surface.x, y: surface.y, z: surface.z }
    }
    if (place && place.mode === 'canyon_crossing') {
        const featureId = typeof place.feature === 'string' ? place.feature.trim() : ''
        const feature = state.features.get(featureId)
        if (!feature?.meta.spline) {
            placementProblem(ctx, required, path, `Unknown canyon "${featureId}".`, { id: spec.id, feature: featureId })
            return null
        }
        const atT = ctx.number(place.at_t, 0.5, `${path}.place.at_t`, { min: 0, max: 1 })
        const point = pointOnSpline3(feature.meta.spline, atT).map(Math.round) as Vec3Tuple
        return { x: point[0], y: point[1], z: point[2] }
    }
    if (spec.place_at_xz !== undefined) {
        const point = readVec2(ctx, spec.place_at_xz, `${path}.place_at_xz`)
        if (!point) return null
        const surface = findBestSurfaceNear(ctx, state, Math.round(point[0]), Math.round(point[1]), readSurfaceOptions(ctx, spec.auto_surface, `${path}.auto_surface`))
        if (!surface) {
            placementProblem(ctx, required, path, `No underground surface for "${spec.id}" near ${point[0]},${point[1]}.`, { id: spec.id, point })
            return null
        }
        if (isRecord(spec.auto_surface) && spec.auto_surface.terraform === 'flatten_footprint') flattenUndergroundFootprint(ctx, surface.x, surface.y, surface.z, 5, 5)
        return { x: surface.x, y: surface.y, z: surface.z }
    }
    placementProblem(ctx, required, path, `Unsupported underground placement for "${spec.id}".`, { id: spec.id, place: spec.place })
    return null
}

function stampBridgeDecor(ctx: WorldgenCompileContext, point: { x: number; y: number; z: number }): void {
    for (let z = point.z - 2; z <= point.z + 2; z += 1) {
        for (let x = point.x - 3; x <= point.x + 3; x += 1) setSolid(ctx, x, point.y - 1, z, BLOCK.plank)
    }
}

function stampShrineDecor(ctx: WorldgenCompileContext, point: { x: number; y: number; z: number }): void {
    setSolid(ctx, point.x, point.y - 1, point.z, BLOCK.glow)
    setSolid(ctx, point.x, point.y, point.z, BLOCK.glow)
    setSolid(ctx, point.x, point.y + 1, point.z, BLOCK.torch)
}

function stampDwarfRoomDecor(ctx: WorldgenCompileContext, point: { x: number; y: number; z: number }, assetId: string): void {
    if (assetId.includes('forge')) {
        for (let dx = -1; dx <= 1; dx += 1) setSolid(ctx, point.x + dx, point.y, point.z, BLOCK.metal)
        setSolid(ctx, point.x, point.y + 1, point.z, BLOCK.fire)
        setSolid(ctx, point.x - 2, point.y, point.z + 1, BLOCK.oreIron)
        setSolid(ctx, point.x + 2, point.y, point.z + 1, BLOCK.oreCopper)
        setSolid(ctx, point.x - 3, point.y + 1, point.z, BLOCK.toolPanel)
        setSolid(ctx, point.x + 3, point.y + 1, point.z, BLOCK.toolPanel)
        setSolid(ctx, point.x, point.y, point.z + 2, BLOCK.oreShelf)
        return
    }
    if (assetId.includes('ore_storage')) {
        for (let dz = -1; dz <= 1; dz += 1) {
            setSolid(ctx, point.x - 2, point.y, point.z + dz, BLOCK.oreIron)
            setSolid(ctx, point.x + 2, point.y, point.z + dz, BLOCK.oreCopper)
        }
        setSolid(ctx, point.x, point.y, point.z, BLOCK.metal)
        setSolid(ctx, point.x - 3, point.y, point.z, BLOCK.oreShelf)
        setSolid(ctx, point.x + 3, point.y, point.z, BLOCK.oreShelf)
        setSolid(ctx, point.x, point.y + 1, point.z + 2, BLOCK.toolPanel)
        return
    }
    if (assetId.includes('storage')) {
        for (let dz = -1; dz <= 1; dz += 1) {
            setSolid(ctx, point.x - 1, point.y, point.z + dz, BLOCK.plank)
            setSolid(ctx, point.x + 1, point.y, point.z + dz, BLOCK.plank)
        }
        setSolid(ctx, point.x - 3, point.y, point.z, BLOCK.goodsShelf)
        setSolid(ctx, point.x + 3, point.y, point.z, BLOCK.goodsShelf)
        setSolid(ctx, point.x, point.y + 1, point.z - 2, BLOCK.recordShelf)
        return
    }
    if (assetId.includes('meeting')) {
        for (let dx = -2; dx <= 2; dx += 1) setSolid(ctx, point.x + dx, point.y, point.z, BLOCK.wood)
        setSolid(ctx, point.x - 2, point.y, point.z - 2, BLOCK.plank)
        setSolid(ctx, point.x + 2, point.y, point.z - 2, BLOCK.plank)
        setSolid(ctx, point.x - 2, point.y, point.z + 2, BLOCK.plank)
        setSolid(ctx, point.x + 2, point.y, point.z + 2, BLOCK.plank)
        setSolid(ctx, point.x, point.y + 1, point.z - 3, BLOCK.recordShelf)
        setSolid(ctx, point.x - 3, point.y + 1, point.z, BLOCK.goodsShelf)
        setSolid(ctx, point.x + 3, point.y + 1, point.z, BLOCK.goodsShelf)
        return
    }
    if (assetId.includes('shop')) {
        for (let dx = -2; dx <= 2; dx += 1) setSolid(ctx, point.x + dx, point.y, point.z - 1, BLOCK.plank)
        setSolid(ctx, point.x - 2, point.y + 1, point.z - 1, BLOCK.goodsShelf)
        setSolid(ctx, point.x, point.y + 1, point.z - 1, BLOCK.recordShelf)
        setSolid(ctx, point.x + 2, point.y + 1, point.z - 1, BLOCK.oreShelf)
        setSolid(ctx, point.x - 3, point.y, point.z + 1, BLOCK.goodsShelf)
        setSolid(ctx, point.x + 3, point.y, point.z + 1, BLOCK.goodsShelf)
        return
    }
    if (assetId.includes('office')) {
        setSolid(ctx, point.x, point.y, point.z, BLOCK.plank)
        setSolid(ctx, point.x - 1, point.y, point.z, BLOCK.plank)
        setSolid(ctx, point.x + 1, point.y, point.z - 2, BLOCK.wood)
        setSolid(ctx, point.x + 2, point.y, point.z - 2, BLOCK.wood)
        setSolid(ctx, point.x - 2, point.y + 1, point.z, BLOCK.recordShelf)
        setSolid(ctx, point.x + 3, point.y + 1, point.z - 2, BLOCK.recordShelf)
        return
    }
    if (assetId.includes('rail_station')) {
        for (let dx = -3; dx <= 3; dx += 1) setSolid(ctx, point.x + dx, point.y, point.z, BLOCK.rail)
        setSolid(ctx, point.x - 2, point.y, point.z - 2, BLOCK.fence)
        setSolid(ctx, point.x + 2, point.y, point.z - 2, BLOCK.fence)
        setSolid(ctx, point.x, point.y + 1, point.z - 2, BLOCK.torch)
        setSolid(ctx, point.x - 3, point.y + 1, point.z - 1, BLOCK.toolPanel)
        setSolid(ctx, point.x + 3, point.y + 1, point.z - 1, BLOCK.goodsShelf)
        return
    }
    const block = assetId.includes('bunks') ? BLOCK.woodDark : BLOCK.wood
    for (let dx = -2; dx <= 2; dx += 2) {
        setSolid(ctx, point.x + dx, point.y, point.z - 1, block)
        setSolid(ctx, point.x + dx, point.y, point.z + 1, block)
    }
    setSolid(ctx, point.x - 3, point.y + 1, point.z, BLOCK.goodsShelf)
    setSolid(ctx, point.x + 3, point.y + 1, point.z, assetId.includes('bunks') ? BLOCK.recordShelf : BLOCK.goodsShelf)
}

function inactivePortalMarkerZone(id: string, access: VoxelCoord): Zone {
    return {
        id: `worldgen:${id}:portal-zone`,
        kind: 'portal',
        label: id,
        min: { x: access.x - 1, y: access.y - 1, z: access.z - 1 },
        max: { x: access.x + 1, y: access.y + 2, z: access.z + 1 },
        active: false,
    }
}

function placementProblem(ctx: WorldgenCompileContext, required: boolean, path: string, message: string, details: unknown): false {
    const diagnostic = { code: 'placement_failed', message, path, details }
    if (required) ctx.error(diagnostic)
    else ctx.warning(diagnostic)
    return false
}

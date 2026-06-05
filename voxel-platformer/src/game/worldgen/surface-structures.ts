import type { Zone } from '../../engine/ecs/zones'
import { isRecord } from './worldgen-util'
import type { EditorProp } from '../props/prop-types'
import {
    generateStructureAsset,
    measureStructurePlacement,
    placeStructureAsset,
    structurePropPlacements,
    structureSourceKey,
    type StructureAsset,
    type StructureRotation,
} from '../../procedural-structures'
import { WorldgenCompileContext, clamp } from './compile-context'
import {
    sampleFootprint,
    slopeAt,
    surfaceY,
    writeTerrainColumn,
    type SurfaceGrid,
} from './surface-grid'
import type {
    ScatterAssetSpec,
    ScatterSpec,
    StructureGroupItemSpec,
    StructurePlacementSpec,
    VoxelCoord,
} from './spec-types'
import { resolveWorldgenAsset, type ResolvedWorldgenAsset, type WorldgenAssetKind } from './asset-registry'

interface StructurePlacementRequest {
    id: string
    path: string
    assetId: string
    asset: StructureAsset
    assetKind: WorldgenAssetKind
    sourceKind: ResolvedWorldgenAsset['sourceKind']
    required: boolean
    x: number
    z: number
    autoY: Record<string, unknown>
    rotation: StructureRotation
    allowOwner: string | null
    props: EditorProp[]
    zones: Zone[]
}

interface ScatterAssetChoice {
    id: string
    weight: number
    resolved: ResolvedWorldgenAsset
}

interface ScatterMask {
    avoidReserved: boolean
    minDistanceToRoad: number
    slopeLte: number | null
    elevationGte: number | null
    elevationLte: number | null
    invalid: boolean
}

type SkipReason = 'asset' | 'bounds' | 'reserved' | 'road' | 'slope' | 'elevation' | 'mask' | 'placement'

export function placeStructures(ctx: WorldgenCompileContext, grid: SurfaceGrid, props: EditorProp[], zones: Zone[]): void {
    const structures = ctx.spec.structures ?? []
    for (let i = 0; i < structures.length; i += 1) {
        const spec = structures[i]!
        const path = `$.structures[${i}]`
        if (spec.type === 'group') placeStructureGroup(ctx, grid, spec, path, props, zones)
        else placeOneStructure(ctx, grid, spec, path, props, zones)
    }
}

export function scatterStructures(ctx: WorldgenCompileContext, grid: SurfaceGrid, props: EditorProp[]): void {
    const scatter = ctx.spec.scatter ?? []
    const assetCache = new Map<string, StructureAsset>()
    for (let i = 0; i < scatter.length; i += 1) {
        const sc = scatter[i]!
        const path = `$.scatter[${i}]`
        const warningStart = ctx.report.warnings.length
        const count = Math.max(0, Math.floor(ctx.number(sc.count, 0, `${path}.count`, { min: 0 })))
        const choices = readScatterAssetChoices(ctx, sc, path)
        const mask = readScatterMask(ctx, sc, path)
        const rotations = readScatterRotations(ctx, sc.rotations, `${path}.rotations`)
        const skippedByReason: Record<string, number> = {}
        const noteSkip = (reason: SkipReason): void => {
            skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1
        }

        if (count <= 0 || choices.length === 0) {
            const skipped = count > 0 && choices.length === 0 ? count : 0
            if (skipped > 0) noteSkip('asset')
            ctx.report.placements.push({
                id: sc.id,
                kind: 'scatter_summary',
                requested: count,
                candidates: 0,
                placed: 0,
                skipped,
                skippedByReason,
                warningCount: ctx.report.warnings.length - warningStart,
            })
            continue
        }

        const cell = Math.max(1, Math.floor(ctx.number(readNestedNumber(sc, 'deterministic_grid', 'cell'), 6, `${path}.deterministic_grid.cell`, { min: 1 })))
        const jitter = Math.max(0, Math.floor(ctx.number(readNestedNumber(sc, 'deterministic_grid', 'jitter'), 2, `${path}.deterministic_grid.jitter`, { min: 0 })))
        const candidates: { score: number; x: number; z: number }[] = []
        for (let gx = 0; gx < ctx.sizeX; gx += cell) {
            for (let gz = 0; gz < ctx.sizeZ; gz += cell) {
                const x = clamp(gx + Math.floor(cell / 2) + ctx.randInt(-jitter, jitter, sc.id, gx, gz, 'x'), 0, ctx.sizeX - 1)
                const z = clamp(gz + Math.floor(cell / 2) + ctx.randInt(-jitter, jitter, sc.id, gx, gz, 'z'), 0, ctx.sizeZ - 1)
                candidates.push({ score: ctx.rand01(sc.id, gx, gz, 'score'), x: Math.floor(x), z: Math.floor(z) })
            }
        }
        candidates.sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z)

        let placed = 0
        for (const candidate of candidates) {
            if (placed >= count) break
            const choice = chooseScatterAsset(ctx, choices, sc.id, candidate.x, candidate.z)
            const asset = assetForChoice(ctx, assetCache, choice.resolved)
            const skipReason = scatterCandidateAllowed(ctx, grid, mask, asset, choice.resolved.kind, candidate.x, candidate.z)
            if (skipReason) {
                noteSkip(skipReason)
                continue
            }
            const id = `${sc.id}_${String(placed).padStart(3, '0')}`
            const rotation = rotations[ctx.randInt(0, rotations.length - 1, sc.id, candidate.x, candidate.z, 'rotation')]!
            if (placeResolvedStructure(ctx, grid, {
                id,
                path,
                assetId: choice.id,
                asset,
                assetKind: choice.resolved.kind,
                sourceKind: choice.resolved.sourceKind,
                required: false,
                x: candidate.x,
                z: candidate.z,
                autoY: { strategy: 'center' },
                rotation,
                allowOwner: null,
                props,
                zones: [],
            })) {
                placed += 1
            } else {
                noteSkip('placement')
            }
        }

        const skipped = Object.values(skippedByReason).reduce((sum, value) => sum + value, 0)
        ctx.report.placements.push({
            id: sc.id,
            kind: 'scatter_summary',
            requested: count,
            candidates: candidates.length,
            placed,
            skipped,
            skippedByReason,
            warningCount: ctx.report.warnings.length - warningStart,
        })
        if (placed < count) {
            ctx.warning({
                code: 'placement_failed',
                message: `Scatter "${sc.id}" placed ${placed} of ${count} requested items.`,
                path,
                details: { requested: count, placed, skipped, skippedByReason },
            })
        }
    }
}

function placeStructureGroup(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    spec: StructurePlacementSpec,
    path: string,
    props: EditorProp[],
    zones: Zone[],
): boolean {
    const point = resolveStructurePoint(ctx, spec, path)
    if (!point) return false
    const items = spec.items
    if (!Array.isArray(items)) {
        ctx.error({
            code: 'invalid_feature',
            message: `Structure group "${spec.id}" must declare an items array.`,
            path: `${path}.items`,
            details: { id: spec.id, items },
        })
        return false
    }

    const baseRotation = readRotation(ctx, spec.rotation, `${path}.rotation`)
    const groupY = surfaceY(grid, point.x, point.z) + 1
    ctx.resolveObject(spec.id, { x: point.x + 0.5, y: groupY, z: point.z + 0.5 })

    let placed = 0
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        const itemPath = `${path}.items[${i}]`
        if (!isRecord(item)) {
            ctx.error({
                code: 'invalid_feature',
                message: `${itemPath} must be an object.`,
                path: itemPath,
                details: { value: item },
            })
            continue
        }
        const child = item as StructureGroupItemSpec
        if (typeof child.id !== 'string' || child.id.trim().length === 0) {
            ctx.error({
                code: 'missing_id',
                message: `${itemPath}.id must be a stable non-empty id.`,
                path: `${itemPath}.id`,
                details: { value: child.id },
            })
            continue
        }
        const offset = ctx.vec2(child.offset_xz, `${itemPath}.offset_xz`)
        if (!offset) continue
        const rotatedOffset = rotateOffset(Math.round(offset[0]), Math.round(offset[1]), baseRotation)
        const required = typeof child.required === 'boolean' ? child.required : spec.required !== false
        const childId = `${spec.id}.${child.id.trim()}`
        const resolved = resolveWorldgenAsset(ctx, child.asset, `${itemPath}.asset`, childId, required, child.params)
        if (!resolved) continue
        const asset = generateStructureAsset(resolved.source, { palette: ctx.chunks.palette, structuralOnly: resolved.structuralOnly })
        const childAutoY = readAutoY(child.auto_y !== undefined ? child.auto_y : spec.auto_y)
        const rotation = normalizeRotation(baseRotation + readRotation(ctx, child.rotation, `${itemPath}.rotation`))
        if (placeResolvedStructure(ctx, grid, {
            id: childId,
            path: itemPath,
            assetId: resolved.id,
            asset,
            assetKind: resolved.kind,
            sourceKind: resolved.sourceKind,
            required,
            x: point.x + rotatedOffset.x,
            z: point.z + rotatedOffset.z,
            autoY: childAutoY,
            rotation,
            allowOwner: point.allowOwner,
            props,
            zones,
        })) {
            placed += 1
        }
    }

    ctx.report.placements.push({
        id: spec.id,
        kind: 'structure_group',
        x: point.x,
        y: groupY,
        z: point.z,
        rotation: baseRotation,
        childCount: items.length,
        placed,
    })
    return placed === items.length
}

function placeOneStructure(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    spec: StructurePlacementSpec,
    path: string,
    props: EditorProp[],
    zones: Zone[],
): boolean {
    const required = spec.required !== false
    const resolved = resolveWorldgenAsset(ctx, spec.asset, `${path}.asset`, spec.id, required, spec.params)
    if (!resolved) return false
    const point = resolveStructurePoint(ctx, spec, path)
    if (!point) return false
    const asset = generateStructureAsset(resolved.source, { palette: ctx.chunks.palette, structuralOnly: resolved.structuralOnly })
    return placeResolvedStructure(ctx, grid, {
        id: spec.id,
        path,
        assetId: resolved.id,
        asset,
        assetKind: resolved.kind,
        sourceKind: resolved.sourceKind,
        required,
        x: point.x,
        z: point.z,
        autoY: readAutoY(spec.auto_y),
        rotation: readRotation(ctx, spec.rotation, `${path}.rotation`),
        allowOwner: point.allowOwner,
        props,
        zones,
    })
}

function placeResolvedStructure(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    request: StructurePlacementRequest,
): boolean {
    const measure = measureStructurePlacement(request.asset, {
        origin: { x: request.x, y: 0, z: request.z },
        rotation: request.rotation,
        anchor: 'bottom-center',
    })
    if (
        measure.bounds.minX < 0 ||
        measure.bounds.minZ < 0 ||
        measure.bounds.maxX >= ctx.sizeX ||
        measure.bounds.maxZ >= ctx.sizeZ
    ) {
        return placementProblem(ctx, request.required, request.path, `Structure "${request.id}" visual bounds leave world bounds.`, {
            id: request.id,
            bounds: measure.bounds,
        })
    }
    const logicalFootprint = reservationFootprint(request.asset, request.assetKind)
    const sample = sampleFootprint(ctx, grid, request.x, request.z, logicalFootprint.width, logicalFootprint.depth)
    if (!sample) {
        return placementProblem(ctx, request.required, request.path, `Structure "${request.id}" footprint leaves world bounds.`, { id: request.id })
    }

    const strategy = typeof request.autoY.strategy === 'string' ? request.autoY.strategy : 'surface_max'
    const terraform = typeof request.autoY.terraform === 'string' ? request.autoY.terraform : 'none'
    const minY = Math.min(...sample.heights)
    const maxY = Math.max(...sample.heights)
    const centerY = surfaceY(grid, request.x, request.z)
    const terrainDelta = maxY - minY
    const maxDelta = typeof request.autoY.max_terrain_delta === 'number' ? request.autoY.max_terrain_delta : null
    if (maxDelta !== null && terrainDelta > maxDelta && terraform !== 'flatten_footprint') {
        return placementProblem(ctx, request.required, request.path, `Terrain under "${request.id}" is too uneven.`, {
            id: request.id,
            terrainDelta,
            maxDelta,
        })
    }

    const baseSurfaceY = strategy === 'center' ? centerY : strategy === 'surface_min' ? minY : maxY
    const material = ctx.material(request.autoY.material, 'grass', `${request.path}.auto_y.material`)
    if (terraform === 'flatten_footprint') {
        for (const cell of sample.cells) writeTerrainColumn(ctx, grid, cell.x, cell.z, baseSurfaceY, material)
    }

    if (!ctx.reserveFootprint(request.id, request.x, request.z, logicalFootprint.width, logicalFootprint.depth, request.allowOwner)) {
        return placementProblem(ctx, request.required, request.path, `Footprint is not free for "${request.id}".`, {
            id: request.id,
            x: request.x,
            z: request.z,
            footprint: logicalFootprint,
        })
    }

    const transform = {
        origin: { x: request.x, y: baseSurfaceY + 1, z: request.z },
        rotation: request.rotation,
        anchor: 'bottom-center' as const,
    }
    const result = placeStructureAsset(ctx.chunks, request.asset, transform)
    ctx.writtenVoxels += result.changedVoxels
    const recoveredProps = structurePropPlacements(request.asset, transform, `worldgen:${request.id}`)
    request.props.push(...recoveredProps)
    const access = structureAccessPoint(request.asset, transform, request.assetKind)
    ctx.resolveObject(request.id, access)
    ctx.report.placements.push({
        id: request.id,
        kind: 'structure',
        assetId: request.assetId,
        assetKind: request.assetKind,
        sourceKind: request.sourceKind,
        x: request.x,
        y: transform.origin.y,
        z: request.z,
        rotation: request.rotation,
        access,
        changedVoxels: result.changedVoxels,
        propCount: recoveredProps.length,
        auto_y: {
            strategy,
            center_surface_y: centerY,
            footprint_min_surface_y: minY,
            footprint_max_surface_y: maxY,
            terrain_delta: terrainDelta,
            max_terrain_delta: maxDelta,
            chosen_surface_y: baseSurfaceY,
            terraform,
        },
        visualBounds: result.bounds,
        reservedFootprint: logicalFootprint,
    })
    if (request.assetKind === 'portal') request.zones.push(inactivePortalMarkerZone(request.id, access))
    return true
}

function readScatterAssetChoices(ctx: WorldgenCompileContext, sc: ScatterSpec, path: string): ScatterAssetChoice[] {
    const assets = sc.assets
    if (Array.isArray(assets)) {
        if (assets.length === 0) {
            ctx.error({
                code: 'invalid_feature',
                message: `${path}.assets must not be empty.`,
                path: `${path}.assets`,
            })
            return []
        }
        const choices: ScatterAssetChoice[] = []
        for (let i = 0; i < assets.length; i += 1) {
            const entry = assets[i]
            const itemPath = `${path}.assets[${i}]`
            if (!isRecord(entry)) {
                ctx.error({
                    code: 'invalid_feature',
                    message: `${itemPath} must be an object.`,
                    path: itemPath,
                    details: { value: entry },
                })
                continue
            }
            const choice = readScatterAssetChoice(ctx, entry as ScatterAssetSpec, itemPath, `${sc.id}:${i}`)
            if (choice) choices.push(choice)
        }
        return choices
    }
    if (assets !== undefined) {
        ctx.error({
            code: 'invalid_feature',
            message: `${path}.assets must be an array when provided.`,
            path: `${path}.assets`,
            details: { value: assets },
        })
        return []
    }
    const resolved = resolveWorldgenAsset(ctx, sc.asset, `${path}.asset`, sc.id, false, sc.params)
    return resolved ? [{ id: resolved.id, weight: 1, resolved }] : []
}

function readScatterAssetChoice(
    ctx: WorldgenCompileContext,
    entry: ScatterAssetSpec,
    path: string,
    ownerId: string,
): ScatterAssetChoice | null {
    const weight = entry.weight === undefined ? 1 : entry.weight
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
        ctx.error({
            code: 'invalid_feature',
            message: `${path}.weight must be a positive finite number.`,
            path: `${path}.weight`,
            details: { value: entry.weight },
        })
        return null
    }
    const resolved = resolveWorldgenAsset(ctx, entry.asset, `${path}.asset`, ownerId, false, entry.params)
    return resolved ? { id: resolved.id, weight, resolved } : null
}

function chooseScatterAsset(ctx: WorldgenCompileContext, choices: readonly ScatterAssetChoice[], id: string, x: number, z: number): ScatterAssetChoice {
    const total = choices.reduce((sum, choice) => sum + choice.weight, 0)
    const target = ctx.rand01(id, x, z, 'asset') * total
    let cursor = 0
    for (const choice of choices) {
        cursor += choice.weight
        if (target <= cursor) return choice
    }
    return choices[choices.length - 1]!
}

function assetForChoice(
    ctx: WorldgenCompileContext,
    cache: Map<string, StructureAsset>,
    resolved: ResolvedWorldgenAsset,
): StructureAsset {
    const key = structureSourceKey(resolved.source, resolved.structuralOnly)
    let asset = cache.get(key)
    if (!asset) {
        asset = generateStructureAsset(resolved.source, { palette: ctx.chunks.palette, structuralOnly: resolved.structuralOnly })
        cache.set(key, asset)
    }
    return asset
}

function scatterCandidateAllowed(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    mask: ScatterMask,
    asset: StructureAsset,
    assetKind: WorldgenAssetKind,
    x: number,
    z: number,
): SkipReason | null {
    if (!ctx.inXZ(x, z)) return 'bounds'
    if (mask.invalid) return 'mask'
    const logicalFootprint = reservationFootprint(asset, assetKind)
    if (mask.avoidReserved && !ctx.isFootprintFree(x, z, logicalFootprint.width, logicalFootprint.depth)) return 'reserved'
    if (mask.minDistanceToRoad > 0 && ctx.roadCells.size > 0) {
        const minD2 = mask.minDistanceToRoad * mask.minDistanceToRoad
        for (const cell of ctx.roadCells) {
            const [rx, rz] = cell.split(',').map(Number)
            if (((rx ?? 0) - x) ** 2 + ((rz ?? 0) - z) ** 2 < minD2) return 'road'
        }
    }
    if (mask.slopeLte !== null && slopeAt(grid, x, z) > mask.slopeLte) return 'slope'
    if (mask.elevationGte !== null && surfaceY(grid, x, z) < mask.elevationGte) return 'elevation'
    if (mask.elevationLte !== null && surfaceY(grid, x, z) > mask.elevationLte) return 'elevation'
    return null
}

function readScatterMask(ctx: WorldgenCompileContext, sc: ScatterSpec, path: string): ScatterMask {
    const out: ScatterMask = {
        avoidReserved: false,
        minDistanceToRoad: 0,
        slopeLte: null,
        elevationGte: null,
        elevationLte: null,
        invalid: false,
    }
    if (sc.mask === undefined) return out
    if (!isRecord(sc.mask)) {
        ctx.error({
            code: 'invalid_feature',
            message: `${path}.mask must be an object.`,
            path: `${path}.mask`,
            details: { value: sc.mask },
        })
        out.invalid = true
        return out
    }
    if (sc.mask.avoid_reserved !== undefined) {
        if (typeof sc.mask.avoid_reserved === 'boolean') out.avoidReserved = sc.mask.avoid_reserved
        else {
            invalidMaskField(ctx, path, 'avoid_reserved', sc.mask.avoid_reserved, 'a boolean')
            out.invalid = true
        }
    }
    const minRoad = readOptionalMaskNumber(ctx, sc.mask, path, 'min_distance_to_road', 0)
    if (minRoad.invalid) out.invalid = true
    else out.minDistanceToRoad = minRoad.value ?? 0
    const slope = readOptionalMaskNumber(ctx, sc.mask, path, 'slope_lte')
    if (slope.invalid) out.invalid = true
    else out.slopeLte = slope.value
    const elevationGte = readOptionalMaskNumber(ctx, sc.mask, path, 'elevation_gte')
    if (elevationGte.invalid) out.invalid = true
    else out.elevationGte = elevationGte.value
    const elevationLte = readOptionalMaskNumber(ctx, sc.mask, path, 'elevation_lte')
    if (elevationLte.invalid) out.invalid = true
    else out.elevationLte = elevationLte.value
    return out
}

function readOptionalMaskNumber(
    ctx: WorldgenCompileContext,
    mask: Record<string, unknown>,
    path: string,
    key: string,
    min?: number,
): { value: number | null; invalid: boolean } {
    const value = mask[key]
    if (value === undefined) return { value: null, invalid: false }
    if (typeof value === 'number' && Number.isFinite(value) && (min === undefined || value >= min)) return { value, invalid: false }
    invalidMaskField(ctx, path, key, value, min === undefined ? 'a finite number' : `a finite number >= ${min}`)
    return { value: null, invalid: true }
}

function invalidMaskField(ctx: WorldgenCompileContext, path: string, key: string, value: unknown, expected: string): void {
    ctx.error({
        code: 'invalid_feature',
        message: `${path}.mask.${key} must be ${expected}.`,
        path: `${path}.mask.${key}`,
        details: { value },
    })
}

function readScatterRotations(ctx: WorldgenCompileContext, value: unknown, path: string): StructureRotation[] {
    if (value === undefined) return [0]
    if (!Array.isArray(value)) {
        ctx.error({
            code: 'invalid_feature',
            message: `${path} must be an array of 0, 90, 180, or 270.`,
            path,
            details: { value },
        })
        return [0]
    }
    const rotations: StructureRotation[] = []
    for (let i = 0; i < value.length; i += 1) {
        if (value[i] === 0 || value[i] === 90 || value[i] === 180 || value[i] === 270) rotations.push(value[i])
        else {
            ctx.error({
                code: 'invalid_feature',
                message: `${path}[${i}] must be one of 0, 90, 180, or 270.`,
                path: `${path}[${i}]`,
                details: { value: value[i] },
            })
        }
    }
    if (rotations.length === 0) {
        ctx.error({
            code: 'invalid_feature',
            message: `${path} must include at least one valid rotation.`,
            path,
            details: { value },
        })
        return [0]
    }
    return rotations
}

function resolveStructurePoint(
    ctx: WorldgenCompileContext,
    spec: StructurePlacementSpec,
    path: string,
): { x: number; z: number; allowOwner: string | null } | null {
    if (typeof spec.place_at === 'string') {
        const anchor = ctx.report.resolvedAnchors[spec.place_at]
        if (!anchor) {
            ctx.error({
                code: 'missing_reference',
                message: `Structure "${spec.id}" references missing anchor "${spec.place_at}".`,
                path: `${path}.place_at`,
                details: { id: spec.id, place_at: spec.place_at },
            })
            return null
        }
        return { x: Math.floor(anchor.x), z: Math.floor(anchor.z), allowOwner: spec.place_at }
    }
    const point = ctx.vec2(spec.place_at_xz, `${path}.place_at_xz`)
    if (!point) return null
    return { x: Math.round(point[0]), z: Math.round(point[1]), allowOwner: null }
}

function readAutoY(value: unknown): Record<string, unknown> {
    if (isRecord(value)) return value
    if (value === true) return { strategy: 'surface_max' }
    return {}
}

function reservationFootprint(asset: StructureAsset, kind: WorldgenAssetKind): { width: number; depth: number } {
    if (kind === 'tree') return { width: Math.min(asset.footprint.width, 5), depth: Math.min(asset.footprint.depth, 5) }
    return asset.footprint
}

function placementProblem(
    ctx: WorldgenCompileContext,
    required: boolean,
    path: string,
    message: string,
    details: unknown,
): false {
    const diagnostic = { code: 'placement_failed', message, path, details }
    if (required) ctx.error(diagnostic)
    else ctx.warning(diagnostic)
    return false
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

function structureAccessPoint(asset: StructureAsset, transform: { origin: VoxelCoord; rotation: StructureRotation }, kind: WorldgenAssetKind): VoxelCoord {
    const front = kind === 'tree' ? 0 : Math.floor(asset.footprint.depth / 2) + 1
    const offset = rotateOffset(0, front, transform.rotation)
    return { x: transform.origin.x + offset.x + 0.5, y: transform.origin.y, z: transform.origin.z + offset.z + 0.5 }
}

function rotateOffset(dx: number, dz: number, rotation: StructureRotation): { x: number; z: number } {
    switch (rotation) {
        case 90: return { x: dz, z: -dx }
        case 180: return { x: -dx, z: -dz }
        case 270: return { x: -dz, z: dx }
        case 0:
        default: return { x: dx, z: dz }
    }
}

function readRotation(ctx: WorldgenCompileContext, value: unknown, path: string): StructureRotation {
    if (value === undefined) return 0
    if (value === 0 || value === 90 || value === 180 || value === 270) return value
    ctx.error({
        code: 'invalid_feature',
        message: `${path} must be one of 0, 90, 180, or 270.`,
        path,
        details: { value },
    })
    return 0
}

function normalizeRotation(value: number): StructureRotation {
    const normalized = ((value % 360) + 360) % 360
    return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0
}

function readNestedNumber(source: unknown, objectKey: string, fieldKey: string): unknown {
    if (!isRecord(source)) return undefined
    const object = source[objectKey]
    return isRecord(object) ? object[fieldKey] : undefined
}

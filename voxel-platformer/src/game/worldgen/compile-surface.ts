import { ChunkManager } from '../../engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../../engine/voxel/palette'
import { findPath } from '../../engine/voxel/voxel-path'
import type { Zone } from '../../engine/ecs/zones'
import type { EditorProp } from '../props/prop-types'
import { defineLevel, outdoorDay } from '../level-builder'
import {
    generateStructureAsset,
    measureStructurePlacement,
    placeStructureAsset,
    prefabSource,
    proceduralSource,
    structurePropPlacements,
    type StructureAsset,
    type StructureRotation,
    type StructureSource,
} from '../../procedural-structures'
import type {
    AnchorSpec,
    NormalizedWorldSpec,
    ScatterSpec,
    StructurePlacementSpec,
    SurfaceFeatureSpec,
    Vec2Tuple,
    VoxelCoord,
    WorldgenCompileResult,
    WorldgenReport,
    WorldgenSurfaceCompileOptions,
} from './spec-types'
import { createWorldgenReport, finalizeWorldgenReport, setWorldgenMetricCounts } from './report'
import { hash32, hashHex, stableJson } from './rng'
import { WorldgenCompileContext, clamp, footprintBounds, lerp, smoothstep } from './compile-context'

interface SurfaceGrid {
    readonly size: number
    readonly sizeY: number
    readonly height: Int16Array
    readonly material: Uint16Array
}

interface PointDistance {
    dist: number
    segment: number
    t: number
    cx: number
    cz: number
}

interface ResolvedAsset {
    source: StructureSource
    structuralOnly: boolean
    kind: 'portal' | 'house' | 'tree' | 'generic'
}

const SUPPORTED_FEATURES = new Set(['cliff_band', 'road_spline', 'flatten_disc', 'mountain_peak'])

export function compileSurfaceWorld(
    spec: NormalizedWorldSpec,
    opts: WorldgenSurfaceCompileOptions = {},
): WorldgenCompileResult {
    const report = createWorldgenReport(spec.world.id, hashHex(stableJson(spec)))
    const chunks = opts.chunks ?? new ChunkManager(DEFAULT_PALETTE)
    const ctx = new WorldgenCompileContext(spec, report, chunks)

    if (spec.world.type !== 'surface') {
        ctx.error({
            code: 'unsupported_world_type',
            message: `Phase 3 surface compiler only supports surface worlds, got "${spec.world.type}".`,
            path: '$.world.type',
            details: { type: spec.world.type },
        })
        return finish(ctx, emptyMeta(spec))
    }

    if (ctx.sizeX !== ctx.sizeZ) {
        ctx.error({
            code: 'unsupported_world_shape',
            message: 'Phase 3 surface compiler requires square X/Z worlds because LevelMeta.size is scalar.',
            path: '$.world.size',
            details: { size: spec.world.size },
        })
        return finish(ctx, emptyMeta(spec))
    }

    const grid = createSurfaceGrid(ctx)
    compileBaseHeightfield(ctx, grid)
    if (shouldStop(ctx, opts)) return finish(ctx, emptyMeta(spec))
    applySurfaceFeatures(ctx, grid)
    if (shouldStop(ctx, opts)) return finish(ctx, emptyMeta(spec))
    resolveAnchors(ctx, grid)
    if (shouldStop(ctx, opts)) return finish(ctx, emptyMeta(spec))

    ctx.chunks.withBulkEdit(() => {
        writeInitialTerrain(ctx, grid)
    })

    const props: EditorProp[] = []
    const zones: Zone[] = []
    placeStructures(ctx, grid, props, zones)
    if (shouldStop(ctx, opts)) return finish(ctx, emptyMeta(spec))
    scatterStructures(ctx, grid, props)
    if (shouldStop(ctx, opts)) return finish(ctx, emptyMeta(spec))
    validateRequiredPaths(ctx)
    if (shouldStop(ctx, opts)) return finish(ctx, emptyMeta(spec))

    const spawn = ctx.report.resolvedAnchors.spawn ?? {
        x: Math.floor(ctx.sizeX / 2) + 0.5,
        y: surfaceY(grid, Math.floor(ctx.sizeX / 2), Math.floor(ctx.sizeZ / 2)) + 1,
        z: Math.floor(ctx.sizeZ / 2) + 0.5,
    }
    if (!ctx.report.resolvedAnchors.spawn) {
        ctx.warning({
            code: 'missing_reference',
            message: 'No "spawn" anchor was declared; using world center.',
            path: '$.anchors',
        })
    }

    const meta = defineLevel({
        name: spec.world.name,
        size: ctx.sizeX,
        spawn,
        zones,
        props,
        ambient: outdoorDay({ timeOfDay: 10, cycleEnabled: true }),
    })

    return finish(ctx, meta)
}

function createSurfaceGrid(ctx: WorldgenCompileContext): SurfaceGrid {
    const count = ctx.sizeX * ctx.sizeZ
    return {
        size: ctx.sizeX,
        sizeY: ctx.sizeY,
        height: new Int16Array(count),
        material: new Uint16Array(count),
    }
}

function compileBaseHeightfield(ctx: WorldgenCompileContext, grid: SurfaceGrid): void {
    const terrain = ctx.spec.terrain
    const base = ctx.number(terrain?.base_height, ctx.spec.world.defaultGroundY ?? 8, '$.terrain.base_height')
    const noise = terrain?.noise ?? {}
    const amplitude = ctx.number(noise.amplitude, 0, '$.terrain.noise.amplitude', { min: 0 })
    const scale = ctx.number(noise.scale, 18, '$.terrain.noise.scale', { min: 0.001 })
    const octaves = ctx.number(noise.octaves, 3, '$.terrain.noise.octaves', { min: 1, integer: true })

    for (let z = 0; z < ctx.sizeZ; z += 1) {
        for (let x = 0; x < ctx.sizeX; x += 1) {
            const n = amplitude > 0 ? signedValueNoise2D(ctx.seed, x, z, scale, octaves) : 0
            setSurface(grid, x, z, ctx.clampSurfaceY(base + Math.round(n * amplitude)), BLOCK.grass)
        }
    }
}

function applySurfaceFeatures(ctx: WorldgenCompileContext, grid: SurfaceGrid): void {
    const features = ctx.spec.terrain?.features ?? []
    for (let i = 0; i < features.length; i += 1) {
        const feature = features[i]!
        const path = `$.terrain.features[${i}]`
        if (!SUPPORTED_FEATURES.has(feature.type)) {
            ctx.error({
                code: 'unsupported_feature',
                message: `Unsupported surface feature type "${feature.type}".`,
                path: `${path}.type`,
                details: { id: feature.id, type: feature.type },
            })
            continue
        }
        switch (feature.type) {
            case 'cliff_band':
                applyCliffBand(ctx, grid, feature, path)
                break
            case 'road_spline':
                applyRoadSpline(ctx, grid, feature, path)
                break
            case 'flatten_disc':
                applyFlattenDiscFeature(ctx, grid, feature, path)
                break
            case 'mountain_peak':
                applyMountainPeak(ctx, grid, feature, path)
                break
        }
    }
}

function applyCliffBand(ctx: WorldgenCompileContext, grid: SurfaceGrid, feature: SurfaceFeatureSpec, path: string): void {
    const from = ctx.vec2(feature.from, `${path}.from`)
    const to = ctx.vec2(feature.to, `${path}.to`)
    if (!from || !to) return

    const width = ctx.number(feature.width, 6, `${path}.width`, { min: 0.001 })
    const height = ctx.number(feature.height, 8, `${path}.height`, { min: 0 })
    const face = ctx.string(feature.face, 'south', `${path}.face`)
    const block = ctx.material(feature.material, 'stone', `${path}.material`)

    for (let z = 0; z < ctx.sizeZ; z += 1) {
        for (let x = 0; x < ctx.sizeX; x += 1) {
            const r = pointSegmentDistance(x, z, from, to)
            if (!isHighSide(x, z, r, face)) continue
            const add = r.dist >= width ? height : Math.round(height * (r.dist / width))
            const top = ctx.clampSurfaceY(surfaceY(grid, x, z) + add)
            setSurface(grid, x, z, top, r.dist <= width + 1 ? block : surfaceBlock(grid, x, z))
        }
    }
}

function applyRoadSpline(ctx: WorldgenCompileContext, grid: SurfaceGrid, feature: SurfaceFeatureSpec, path: string): void {
    const points = readPointList(ctx, feature.points, `${path}.points`)
    if (points.length < 2) return

    const width = ctx.number(feature.width, 2, `${path}.width`, { min: 0.001 })
    const shoulder = ctx.number(feature.shoulder, 2, `${path}.shoulder`, { min: 0 })
    const block = ctx.material(feature.material, 'sand', `${path}.material`)
    const edgeBlock = typeof feature.edge_material === 'string'
        ? ctx.material(feature.edge_material, 'sand', `${path}.edge_material`)
        : surfaceBlock(grid, Math.round(points[0]![0]), Math.round(points[0]![1]))
    const smoothing = ctx.number(feature.profile_smoothing_iterations, 0, `${path}.profile_smoothing_iterations`, { min: 0, integer: true })
    const heights = points.map(([x, z]) => surfaceY(grid, Math.round(x), Math.round(z)))

    for (let i = 0; i < smoothing; i += 1) {
        const next = heights.slice()
        for (let p = 1; p < heights.length - 1; p += 1) {
            next[p] = Math.round((heights[p - 1]! + heights[p]! * 2 + heights[p + 1]!) / 4)
        }
        for (let p = 1; p < heights.length - 1; p += 1) heights[p] = next[p]!
    }

    for (let z = 0; z < ctx.sizeZ; z += 1) {
        for (let x = 0; x < ctx.sizeX; x += 1) {
            const r = pointPolylineDistance(x, z, points)
            if (r.dist > width + shoulder) continue
            const roadY = ctx.clampSurfaceY(lerp(heights[r.segment]!, heights[r.segment + 1]!, smoothstep(r.t)))
            if (r.dist <= width) {
                setSurface(grid, x, z, roadY, block)
                ctx.roadCells.add(ctx.reservationKey(x, z))
            } else {
                const t = shoulder <= 0 ? 1 : (r.dist - width) / shoulder
                setSurface(grid, x, z, ctx.clampSurfaceY(lerp(roadY, surfaceY(grid, x, z), smoothstep(t))), edgeBlock)
            }
        }
    }
}

function applyFlattenDiscFeature(ctx: WorldgenCompileContext, grid: SurfaceGrid, feature: SurfaceFeatureSpec, path: string): void {
    const center = ctx.vec2(feature.center ?? feature.center_xz, `${path}.center`)
    if (!center) return
    applyFlattenDisc(ctx, grid, {
        center,
        radius: ctx.number(feature.radius, 8, `${path}.radius`, { min: 0.001 }),
        blend: ctx.number(feature.blend ?? feature.shoulder, 3, `${path}.blend`, { min: 0 }),
        height: typeof feature.height === 'number' ? feature.height : undefined,
        material: ctx.material(feature.material, 'grass', `${path}.material`),
    })
}

function applyMountainPeak(ctx: WorldgenCompileContext, grid: SurfaceGrid, feature: SurfaceFeatureSpec, path: string): void {
    const center = ctx.vec2(feature.center_xz ?? feature.center, `${path}.center`)
    if (!center) return

    const radius = ctx.number(feature.radius, 32, `${path}.radius`, { min: 0.001 })
    const height = ctx.number(feature.height, 24, `${path}.height`, { min: 0 })
    const profileName = ctx.string(feature.profile, 'sharp', `${path}.profile`)
    const profile = profileName === 'rounded' ? 1.7 : profileName === 'mesa' ? 0.85 : 2.35
    const roughness = ctx.number(feature.roughness, 0.18, `${path}.roughness`, { min: 0 })
    const noiseScale = ctx.number(feature.noise_scale, 18, `${path}.noise_scale`, { min: 0.001 })
    const snowline = typeof feature.snowline === 'number' ? feature.snowline : Infinity
    const block = ctx.material(feature.material, 'stone', `${path}.material`)

    for (let z = 0; z < ctx.sizeZ; z += 1) {
        for (let x = 0; x < ctx.sizeX; x += 1) {
            const dx = x - center[0]
            const dz = z - center[1]
            const d = Math.hypot(dx, dz)
            if (d > radius) continue
            const t = clamp(d / radius, 0, 1)
            const n = signedValueNoise2D(`${ctx.seed}/${feature.id}/mountain`, x, z, noiseScale, 3)
            const falloff = Math.pow(1 - smoothstep(t), profile)
            const add = Math.round(height * falloff + n * roughness * height * (1 - t))
            const top = ctx.clampSurfaceY(surfaceY(grid, x, z) + add)
            const material = top >= snowline ? BLOCK.stone2 : add > height * 0.28 || t < 0.42 ? block : surfaceBlock(grid, x, z)
            setSurface(grid, x, z, top, material)
        }
    }
}

function resolveAnchors(ctx: WorldgenCompileContext, grid: SurfaceGrid): void {
    const anchors = ctx.spec.anchors ?? []
    for (let i = 0; i < anchors.length; i += 1) {
        const anchor = anchors[i]!
        const path = `$.anchors[${i}]`
        const point = ctx.vec2(anchor.place_at_xz, `${path}.place_at_xz`)
        if (!point) {
            ctx.error({
                code: 'invalid_anchor',
                message: `Anchor "${anchor.id}" must declare place_at_xz in Phase 3.`,
                path,
                details: { id: anchor.id },
            })
            continue
        }
        const x = Math.round(point[0])
        const z = Math.round(point[1])
        if (!ctx.inXZ(x, z)) {
            ctx.error({
                code: 'invalid_anchor',
                message: `Anchor "${anchor.id}" is outside the world bounds.`,
                path,
                details: { id: anchor.id, x, z },
            })
            continue
        }
        applyAnchorPatch(ctx, grid, anchor, path, x, z)
        const y = surfaceY(grid, x, z) + 1
        const reserve = readReserve(anchor.reserve)
        if (reserve && !ctx.reserveFootprint(anchor.id, x, z, reserve[0], reserve[2])) {
            ctx.error({
                code: 'invalid_anchor',
                message: `Anchor "${anchor.id}" reservation overlaps another reservation or leaves world bounds.`,
                path: `${path}.reserve`,
                details: { reserve },
            })
            continue
        }
        ctx.resolveAnchor(anchor.id, { x: x + 0.5, y, z: z + 0.5 })
        ctx.report.placements.push({ id: anchor.id, kind: 'anchor', x, y, z, reserve })
    }
}

function applyAnchorPatch(ctx: WorldgenCompileContext, grid: SurfaceGrid, anchor: AnchorSpec, path: string, x: number, z: number): void {
    const patch = anchor.terrain_patch
    if (!isRecord(patch)) return
    if (patch.type !== 'flatten_disc') {
        ctx.error({
            code: 'unsupported_feature',
            message: `Unsupported anchor terrain_patch type "${String(patch.type)}".`,
            path: `${path}.terrain_patch.type`,
            details: { id: anchor.id, type: patch.type },
        })
        return
    }
    applyFlattenDisc(ctx, grid, {
        center: [x, z],
        radius: ctx.number(patch.radius, 4, `${path}.terrain_patch.radius`, { min: 0.001 }),
        blend: ctx.number(patch.blend ?? patch.shoulder, 2, `${path}.terrain_patch.blend`, { min: 0 }),
        height: surfaceY(grid, x, z),
        material: ctx.material(patch.material, 'stone', `${path}.terrain_patch.material`),
    })
}

function writeInitialTerrain(ctx: WorldgenCompileContext, grid: SurfaceGrid): void {
    for (let z = 0; z < ctx.sizeZ; z += 1) {
        for (let x = 0; x < ctx.sizeX; x += 1) writeTerrainColumn(ctx, grid, x, z, surfaceY(grid, x, z), surfaceBlock(grid, x, z))
    }
}

function writeTerrainColumn(ctx: WorldgenCompileContext, grid: SurfaceGrid, x: number, z: number, topY: number, topBlock: number): void {
    const oldY = surfaceY(grid, x, z)
    const nextY = ctx.clampSurfaceY(topY)
    const soilY = Math.max(0, nextY - 1)
    const clearFrom = Math.max(oldY, nextY) + 1
    for (let y = clearFrom; y < ctx.sizeY; y += 1) ctx.setVoxel(x, y, z, BLOCK.air)
    for (let y = 0; y < nextY; y += 1) ctx.setVoxel(x, y, z, y === soilY ? BLOCK.dirt : BLOCK.stone)
    ctx.setVoxel(x, nextY, z, topBlock)
    setSurface(grid, x, z, nextY, topBlock)
}

function placeStructures(ctx: WorldgenCompileContext, grid: SurfaceGrid, props: EditorProp[], zones: Zone[]): void {
    const structures = ctx.spec.structures ?? []
    for (let i = 0; i < structures.length; i += 1) {
        placeOneStructure(ctx, grid, structures[i]!, `$.structures[${i}]`, props, zones, null)
    }
}

function scatterStructures(ctx: WorldgenCompileContext, grid: SurfaceGrid, props: EditorProp[]): void {
    const scatter = ctx.spec.scatter ?? []
    for (let i = 0; i < scatter.length; i += 1) {
        const sc = scatter[i]!
        const path = `$.scatter[${i}]`
        const count = Math.max(0, Math.floor(ctx.number(sc.count, 0, `${path}.count`, { min: 0 })))
        if (count <= 0) {
            ctx.report.placements.push({ id: sc.id, kind: 'scatter_summary', requested: count, placed: 0, skipped: 0 })
            continue
        }
        const resolved = resolveAsset(ctx, sc.asset, path, sc.id, false)
        if (!resolved) continue
        const asset = generateStructureAsset(resolved.source, { palette: ctx.chunks.palette, structuralOnly: resolved.structuralOnly })
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
        let skipped = 0
        for (const candidate of candidates) {
            if (placed >= count) break
            if (!scatterCandidateAllowed(ctx, grid, sc, path, asset, resolved.kind, candidate.x, candidate.z)) {
                skipped += 1
                continue
            }
            const id = `${sc.id}_${String(placed).padStart(3, '0')}`
            if (placeResolvedStructure(ctx, grid, {
                id,
                path,
                asset,
                assetKind: resolved.kind,
                required: false,
                x: candidate.x,
                z: candidate.z,
                autoY: { strategy: 'center' },
                rotation: 0,
                allowOwner: null,
                props,
                zones: [],
            })) {
                placed += 1
            } else {
                skipped += 1
            }
        }
        ctx.report.placements.push({ id: sc.id, kind: 'scatter_summary', requested: count, placed, skipped })
        if (placed < count) {
            ctx.warning({
                code: 'placement_failed',
                message: `Scatter "${sc.id}" placed ${placed} of ${count} requested items.`,
                path,
                details: { requested: count, placed, skipped },
            })
        }
    }
}

function placeOneStructure(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    spec: StructurePlacementSpec,
    path: string,
    props: EditorProp[],
    zones: Zone[],
    overrideId: string | null,
): boolean {
    const id = overrideId ?? spec.id
    const resolved = resolveAsset(ctx, spec.asset, path, id, spec.required !== false)
    if (!resolved) return false
    const point = resolveStructurePoint(ctx, spec, path)
    if (!point) return false
    const asset = generateStructureAsset(resolved.source, { palette: ctx.chunks.palette, structuralOnly: resolved.structuralOnly })
    return placeResolvedStructure(ctx, grid, {
        id,
        path,
        asset,
        assetKind: resolved.kind,
        required: spec.required !== false,
        x: point.x,
        z: point.z,
        autoY: isRecord(spec.auto_y) ? spec.auto_y : spec.auto_y === true ? { strategy: 'surface_max' } : {},
        rotation: readRotation(ctx, spec.rotation, `${path}.rotation`),
        allowOwner: point.allowOwner,
        props,
        zones,
    })
}

function placeResolvedStructure(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    request: {
        id: string
        path: string
        asset: StructureAsset
        assetKind: ResolvedAsset['kind']
        required: boolean
        x: number
        z: number
        autoY: Record<string, unknown>
        rotation: StructureRotation
        allowOwner: string | null
        props: EditorProp[]
        zones: Zone[]
    },
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
    request.props.push(...structurePropPlacements(request.asset, transform, `worldgen:${request.id}`))
    const access = structureAccessPoint(request.asset, transform, request.assetKind)
    ctx.resolveObject(request.id, access)
    ctx.report.placements.push({
        id: request.id,
        kind: 'structure',
        assetKind: request.assetKind,
        x: request.x,
        y: transform.origin.y,
        z: request.z,
        access,
        changedVoxels: result.changedVoxels,
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

function resolveAsset(
    ctx: WorldgenCompileContext,
    assetId: unknown,
    path: string,
    id: string,
    required: boolean,
): ResolvedAsset | null {
    if (typeof assetId !== 'string' || assetId.trim().length === 0) {
        const diagnostic = {
            code: 'unsupported_structure_asset',
            message: `Structure "${id}" must declare an asset id.`,
            path: `${path}.asset`,
            details: { id, asset: assetId },
        }
        if (required) ctx.error(diagnostic)
        else ctx.warning(diagnostic)
        return null
    }
    const asset = assetId.trim()
    if (asset === 'fixed.portal.blue_stone' || asset === 'prefab.portal-gate') {
        return { source: prefabSource('portal-gate'), structuralOnly: false, kind: 'portal' }
    }
    if (asset === 'proc.house.hermit_cottage') {
        return {
            source: proceduralSource('house', ctx.key(id, asset), {
                house: {
                    scale: 'folk',
                    style: 'cottage',
                    width: 7,
                    depth: 6,
                    floors: 1,
                    floorHeight: 3,
                    roofStyle: 'gable',
                    sideWing: false,
                    porch: true,
                    chimney: true,
                },
            }),
            structuralOnly: true,
            kind: 'house',
        }
    }
    if (asset === 'proc.tree.pine') {
        return {
            source: prefabSource('compact-pine'),
            structuralOnly: false,
            kind: 'tree',
        }
    }
    const diagnostic = {
        code: 'unsupported_structure_asset',
        message: `Unsupported Phase 3 structure asset "${asset}".`,
        path: `${path}.asset`,
        details: { id, asset },
    }
    if (required) ctx.error(diagnostic)
    else ctx.warning(diagnostic)
    return null
}

function scatterCandidateAllowed(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    sc: ScatterSpec,
    path: string,
    asset: StructureAsset,
    assetKind: ResolvedAsset['kind'],
    x: number,
    z: number,
): boolean {
    if (!ctx.inXZ(x, z)) return false
    const mask = isRecord(sc.mask) ? sc.mask : {}
    const logicalFootprint = reservationFootprint(asset, assetKind)
    if (mask.avoid_reserved === true && !ctx.isFootprintFree(x, z, logicalFootprint.width, logicalFootprint.depth)) return false
    if (typeof mask.min_distance_to_road === 'number' && mask.min_distance_to_road > 0 && ctx.roadCells.size > 0) {
        const minD2 = mask.min_distance_to_road * mask.min_distance_to_road
        for (const cell of ctx.roadCells) {
            const [rx, rz] = cell.split(',').map(Number)
            if (((rx ?? 0) - x) ** 2 + ((rz ?? 0) - z) ** 2 < minD2) return false
        }
    }
    if (typeof mask.slope_lte === 'number' && slopeAt(grid, x, z) > mask.slope_lte) return false
    if (typeof mask.elevation_gte === 'number' && surfaceY(grid, x, z) < mask.elevation_gte) return false
    if (typeof mask.elevation_lte === 'number' && surfaceY(grid, x, z) > mask.elevation_lte) return false
    if (mask.avoid_reserved !== undefined && typeof mask.avoid_reserved !== 'boolean') {
        ctx.error({
            code: 'invalid_feature',
            message: `${path}.mask.avoid_reserved must be a boolean.`,
            path: `${path}.mask.avoid_reserved`,
            details: { value: mask.avoid_reserved },
        })
        return false
    }
    return true
}

function reservationFootprint(asset: StructureAsset, kind: ResolvedAsset['kind']): { width: number; depth: number } {
    if (kind === 'tree') return { width: Math.min(asset.footprint.width, 5), depth: Math.min(asset.footprint.depth, 5) }
    return asset.footprint
}

function validateRequiredPaths(ctx: WorldgenCompileContext): void {
    const rules = ctx.spec.validation?.require_paths ?? []
    for (let i = 0; i < rules.length; i += 1) {
        const rule = rules[i]!
        const path = `$.validation.require_paths[${i}]`
        const from = resolveValidationPoint(ctx, rule.from)
        const to = resolveValidationPoint(ctx, rule.to)
        const report = {
            rule: rule.id ?? `${rule.from}->${rule.to}`,
            ok: false,
            from: rule.from,
            to: rule.to,
            actor: rule.actor ?? 'player_basic',
        }
        if (!from || !to) {
            const diagnostic = {
                code: 'missing_reference',
                message: `Validation path "${report.rule}" references an unresolved anchor or object.`,
                path,
                details: { from: rule.from, to: rule.to },
            }
            if (rule.optional) ctx.warning(diagnostic)
            else ctx.error(diagnostic)
            ctx.report.validation.push(report)
            continue
        }
        const found = findPath(ctx.chunks, voxelPoint(from), voxelPoint(to), {
            maxStepUp: 1,
            maxDrop: 3,
            maxNodes: Math.max(4096, ctx.sizeX * ctx.sizeZ * 4),
            surfaceSearchRange: ctx.sizeY,
        })
        if (!found) {
            const diagnostic = {
                code: 'validation_failed',
                message: `Required path "${report.rule}" did not validate.`,
                path,
                details: { from, to },
            }
            if (rule.optional) ctx.warning(diagnostic)
            else ctx.error(diagnostic)
            ctx.report.validation.push(report)
            continue
        }
        ctx.report.validation.push({ ...report, ok: true, pathLength: found.length })
    }
}

function resolveValidationPoint(ctx: WorldgenCompileContext, id: string): VoxelCoord | null {
    return ctx.report.resolvedAnchors[id] ?? ctx.report.resolvedObjects[id] ?? null
}

function emptyMeta(spec: NormalizedWorldSpec) {
    const size = spec.world.size[0] ?? 1
    return defineLevel({
        name: spec.world.name,
        size,
        spawn: { x: 0.5, y: 1, z: 0.5 },
        zones: [],
        props: [],
    })
}

function shouldStop(ctx: WorldgenCompileContext, opts: WorldgenSurfaceCompileOptions): boolean {
    return opts.failFast === true && ctx.report.errors.length > 0
}

function finish(ctx: WorldgenCompileContext, meta: ReturnType<typeof defineLevel>): WorldgenCompileResult {
    ctx.report.worldHash = hashWorldOutput(ctx.chunks, meta)
    setWorldgenMetricCounts(ctx.report, {
        size: ctx.spec.world.size,
        chunkCount: ctx.chunks.chunkCount(),
        writtenVoxels: countNonAir(ctx.chunks),
        anchorCount: ctx.spec.anchors?.length ?? 0,
        terrainFeatureCount: ctx.spec.terrain?.features?.length ?? 0,
        carverCount: ctx.spec.carvers?.length ?? 0,
        connectorCount: ctx.spec.connectors?.length ?? 0,
        pathCount: ctx.spec.paths?.length ?? 0,
        structureCount: ctx.spec.structures?.length ?? 0,
        scatterRuleCount: ctx.spec.scatter?.length ?? 0,
        validationRuleCount: ctx.spec.validation?.require_paths?.length ?? 0,
        npcCount: ctx.spec.content?.npcs?.length ?? 0,
        zoneCount: (ctx.spec.content?.zones?.length ?? 0) + meta.zones.length,
        scriptCount: (ctx.spec.content?.quests?.length ?? 0) + (ctx.spec.content?.shops?.length ?? 0),
    })
    finalizeWorldgenReport(ctx.report)
    return { chunks: ctx.chunks, meta, report: ctx.report }
}

function applyFlattenDisc(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    opts: { center: Vec2Tuple; radius: number; blend: number; height?: number; material: number },
): void {
    const [cx, cz] = opts.center
    const ix = Math.round(cx)
    const iz = Math.round(cz)
    const target = ctx.clampSurfaceY(opts.height ?? surfaceY(grid, ix, iz))
    const r = opts.radius
    const blend = opts.blend
    const minX = Math.max(0, Math.floor(cx - r - blend))
    const maxX = Math.min(ctx.sizeX - 1, Math.ceil(cx + r + blend))
    const minZ = Math.max(0, Math.floor(cz - r - blend))
    const maxZ = Math.min(ctx.sizeZ - 1, Math.ceil(cz + r + blend))
    for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const d = Math.hypot(x - cx, z - cz)
            if (d <= r) setSurface(grid, x, z, target, opts.material)
            else if (blend > 0 && d <= r + blend) {
                const t = (d - r) / blend
                setSurface(grid, x, z, ctx.clampSurfaceY(lerp(target, surfaceY(grid, x, z), smoothstep(t))), surfaceBlock(grid, x, z))
            }
        }
    }
}

function sampleFootprint(ctx: WorldgenCompileContext, grid: SurfaceGrid, cx: number, cz: number, width: number, depth: number): {
    heights: number[]
    cells: { x: number; z: number }[]
} | null {
    const bounds = footprintBounds(cx, cz, width, depth)
    const heights: number[] = []
    const cells: { x: number; z: number }[] = []
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
            if (!ctx.inXZ(x, z)) return null
            heights.push(surfaceY(grid, x, z))
            cells.push({ x, z })
        }
    }
    return { heights, cells }
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

function structureAccessPoint(asset: StructureAsset, transform: { origin: VoxelCoord; rotation: StructureRotation }, kind: ResolvedAsset['kind']): VoxelCoord {
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

function readPointList(ctx: WorldgenCompileContext, value: unknown, path: string): Vec2Tuple[] {
    if (!Array.isArray(value)) {
        ctx.error({
            code: 'invalid_feature',
            message: `${path} must be an array of [x, z] tuples.`,
            path,
            details: { value },
        })
        return []
    }
    const out: Vec2Tuple[] = []
    for (let i = 0; i < value.length; i += 1) {
        const point = ctx.vec2(value[i], `${path}[${i}]`)
        if (point) out.push(point)
    }
    return out
}

function readReserve(value: unknown): [number, number, number] | null {
    if (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every((part) => Number.isFinite(part) && Number(part) > 0)
    ) {
        return [Math.floor(Number(value[0])), Math.floor(Number(value[1])), Math.floor(Number(value[2]))]
    }
    return null
}

function readNestedNumber(source: unknown, objectKey: string, fieldKey: string): unknown {
    if (!isRecord(source)) return undefined
    const object = source[objectKey]
    return isRecord(object) ? object[fieldKey] : undefined
}

function pointSegmentDistance(x: number, z: number, from: Vec2Tuple, to: Vec2Tuple): PointDistance {
    const ax = from[0]
    const az = from[1]
    const bx = to[0]
    const bz = to[1]
    const vx = bx - ax
    const vz = bz - az
    const len2 = vx * vx + vz * vz
    const t = len2 <= 0.000001 ? 0 : clamp(((x - ax) * vx + (z - az) * vz) / len2, 0, 1)
    const cx = ax + vx * t
    const cz = az + vz * t
    return { dist: Math.hypot(x - cx, z - cz), segment: 0, t, cx, cz }
}

function pointPolylineDistance(x: number, z: number, points: readonly Vec2Tuple[]): PointDistance {
    let best: PointDistance | null = null
    for (let i = 0; i < points.length - 1; i += 1) {
        const r = pointSegmentDistance(x, z, points[i]!, points[i + 1]!)
        const candidate = { ...r, segment: i }
        if (!best || candidate.dist < best.dist) best = candidate
    }
    return best ?? { dist: Infinity, segment: 0, t: 0, cx: x, cz: z }
}

function isHighSide(x: number, z: number, r: PointDistance, face: string): boolean {
    switch (face) {
        case 'north': return z > r.cz
        case 'east': return x < r.cx
        case 'west': return x > r.cx
        case 'south':
        default: return z < r.cz
    }
}

function signedValueNoise2D(seed: string, x: number, z: number, scale = 18, octaves = 3): number {
    let total = 0
    let amp = 1
    let totalAmp = 0
    let frequency = 1 / Math.max(scale, 0.001)
    for (let octave = 0; octave < octaves; octave += 1) {
        const fx = x * frequency
        const fz = z * frequency
        const ix = Math.floor(fx)
        const iz = Math.floor(fz)
        const tx = smoothstep(fx - ix)
        const tz = smoothstep(fz - iz)
        const corner = (cx: number, cz: number) => hash32(seed, 'noise2', octave, cx, cz) / 4294967296 * 2 - 1
        const v00 = corner(ix, iz)
        const v10 = corner(ix + 1, iz)
        const v01 = corner(ix, iz + 1)
        const v11 = corner(ix + 1, iz + 1)
        total += lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz) * amp
        totalAmp += amp
        amp *= 0.5
        frequency *= 2
    }
    return total / Math.max(totalAmp, 0.0001)
}

function slopeAt(grid: SurfaceGrid, x: number, z: number): number {
    const y = surfaceY(grid, x, z)
    let slope = 0
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx
        const nz = z + dz
        if (nx < 0 || nz < 0 || nx >= grid.size || nz >= grid.size) continue
        slope = Math.max(slope, Math.abs(surfaceY(grid, nx, nz) - y))
    }
    return slope
}

function surfaceIndex(grid: SurfaceGrid, x: number, z: number): number {
    return x + z * grid.size
}

function surfaceY(grid: SurfaceGrid, x: number, z: number): number {
    const xx = clamp(Math.floor(x), 0, grid.size - 1)
    const zz = clamp(Math.floor(z), 0, grid.size - 1)
    return grid.height[surfaceIndex(grid, xx, zz)]!
}

function surfaceBlock(grid: SurfaceGrid, x: number, z: number): number {
    const xx = clamp(Math.floor(x), 0, grid.size - 1)
    const zz = clamp(Math.floor(z), 0, grid.size - 1)
    return grid.material[surfaceIndex(grid, xx, zz)]!
}

function setSurface(grid: SurfaceGrid, x: number, z: number, y: number, block: number): void {
    const idx = surfaceIndex(grid, x, z)
    grid.height[idx] = Math.round(y)
    grid.material[idx] = block
}

function voxelPoint(point: VoxelCoord): { x: number; y: number; z: number } {
    return { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z) }
}

function countNonAir(chunks: ChunkManager): number {
    let total = 0
    for (const chunk of chunks.allChunks()) total += chunk.nonAirCount
    return total
}

function hashWorldOutput(chunks: ChunkManager, meta: unknown): string {
    let h = hash32('worldgen-output', stableJson(meta))
    const sorted = [...chunks.allChunks()].sort((a, b) => a.cx - b.cx || a.cy - b.cy || a.cz - b.cz)
    for (const chunk of sorted) {
        h = mixHash(h, chunk.cx)
        h = mixHash(h, chunk.cy)
        h = mixHash(h, chunk.cz)
        for (let i = 0; i < chunk.data.length; i += 1) h = mixHash(h, chunk.data[i]!)
    }
    return h.toString(16).padStart(8, '0')
}

function mixHash(current: number, value: number): number {
    let h = current >>> 0
    h ^= value & 0xffff
    h = Math.imul(h, 16777619) >>> 0
    h ^= value >>> 16
    h = Math.imul(h, 16777619) >>> 0
    return h >>> 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

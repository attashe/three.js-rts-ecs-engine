import { BLOCK } from '../../engine/voxel/palette'
import { isRecord } from './worldgen-util'
import { outdoorDay } from '../level-builder'
import type {
    AnchorSpec,
    NormalizedWorldSpec,
    SurfaceFeatureSpec,
    Vec2Tuple,
    VoxelCoord,
    WorldgenCompileResult,
    WorldgenCompileOptions,
} from './spec-types'
import { createWorldgenReport } from './report'
import { hash32, hashHex, stableJson } from './rng'
import { WorldgenCompileContext, clamp, lerp, smoothstep } from './compile-context'
import { emptyWorldgenMeta, finishWorldgenCompile, shouldStopWorldgen, worldgenChunks } from './compile-result'
import { WorldgenLevelDraft } from './level-draft'
import {
    createSurfaceGrid,
    setSurface,
    surfaceBlock,
    surfaceY,
    writeTerrainColumn,
    type SurfaceGrid,
} from './surface-grid'
import { placeStructures, scatterStructures } from './surface-structures'
import { resolveContent } from './resolve-content'
import { validateRequiredPaths } from './validate'

interface PointDistance {
    dist: number
    segment: number
    t: number
    cx: number
    cz: number
}

const SUPPORTED_FEATURES = new Set(['cliff_band', 'road_spline', 'flatten_disc', 'mountain_peak'])
const DEFAULT_ROAD_PROFILE_SMOOTHING = 2
const DEFAULT_ROAD_GRADE_RELAXATION = 4
const DEFAULT_ROAD_MAX_STEP = 1
const SURFACE_BORDER_WALL_HEIGHT = 3

export function compileSurfaceWorld(
    spec: NormalizedWorldSpec,
    opts: WorldgenCompileOptions = {},
): WorldgenCompileResult {
    const report = createWorldgenReport(spec.world.id, hashHex(stableJson(spec)))
    const chunks = worldgenChunks(opts)
    const ctx = new WorldgenCompileContext(spec, report, chunks)

    if (spec.world.type !== 'surface') {
        ctx.error({
            code: 'unsupported_world_type',
            message: `Phase 3 surface compiler only supports surface worlds, got "${spec.world.type}".`,
            path: '$.world.type',
            details: { type: spec.world.type },
        })
        return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    }

    const grid = createSurfaceGrid(ctx)
    compileBaseHeightfield(ctx, grid)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    applySurfaceFeatures(ctx, grid)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    resolveAnchors(ctx, grid)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    warnOnCeilingClamp(ctx)

    ctx.chunks.withBulkEdit(() => {
        writeInitialTerrain(ctx, grid)
    })

    const draft = new WorldgenLevelDraft({
        name: spec.world.name,
        size: Math.max(ctx.sizeX, ctx.sizeZ),
        sizeX: ctx.sizeX,
        sizeZ: ctx.sizeZ,
        spawn: surfaceSpawn(ctx, grid),
        ambientWeather: outdoorDay({ timeOfDay: 10, cycleEnabled: true }),
    })

    placeStructures(ctx, grid, draft.props, draft.zones)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    scatterStructures(ctx, grid, draft.props)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    resolveContent(ctx, draft, { standYAtXZ: (x, z) => surfaceY(grid, x, z) + 1 })
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    validateRequiredPaths(ctx)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))

    return finishWorldgenCompile(ctx, draft.toMeta())
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
    const smoothing = ctx.number(
        feature.profile_smoothing_iterations,
        DEFAULT_ROAD_PROFILE_SMOOTHING,
        `${path}.profile_smoothing_iterations`,
        { min: 0, integer: true },
    )
    const maxStep = ctx.number(feature.max_step, DEFAULT_ROAD_MAX_STEP, `${path}.max_step`, { min: 0, integer: true })
    const gradeRelaxation = ctx.number(
        feature.grade_relaxation_iterations,
        DEFAULT_ROAD_GRADE_RELAXATION,
        `${path}.grade_relaxation_iterations`,
        { min: 0, integer: true },
    )
    const heights = points.map(([x, z]) => surfaceY(grid, Math.round(x), Math.round(z)))
    const gradeCells: { x: number; z: number }[] = []
    const gradeCellKeys = new Set<string>()

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
                rememberRoadGradeCell(ctx, gradeCells, gradeCellKeys, x, z)
            } else {
                const t = shoulder <= 0 ? 1 : (r.dist - width) / shoulder
                setSurface(grid, x, z, ctx.clampSurfaceY(lerp(roadY, surfaceY(grid, x, z), smoothstep(t))), edgeBlock)
                if (r.dist <= width + Math.min(1, shoulder)) rememberRoadGradeCell(ctx, gradeCells, gradeCellKeys, x, z)
            }
        }
    }

    relaxRoadGrade(ctx, grid, gradeCells, gradeRelaxation, maxStep)
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

function warnOnCeilingClamp(ctx: WorldgenCompileContext): void {
    if (ctx.surfaceCeilingHits <= 0) return
    const ceiling = Math.max(0, ctx.sizeY - 8)
    ctx.warning({
        code: 'surface_clamped',
        message: `${ctx.surfaceCeilingHits} surface column(s) were clamped to the world ceiling (y=${ceiling}); `
            + 'increase world.size Y or lower feature heights to avoid truncated terrain.',
        path: '$.world.size',
        details: { hits: ctx.surfaceCeilingHits, ceiling, sizeY: ctx.sizeY },
    })
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
    writeSurfaceBorderWalls(ctx, grid)
}

function surfaceSpawn(ctx: WorldgenCompileContext, grid: SurfaceGrid): VoxelCoord {
    const spawn = ctx.report.resolvedAnchors.spawn
    if (spawn) return spawn
    ctx.warning({
        code: 'missing_reference',
        message: 'No "spawn" anchor was declared; using world center.',
        path: '$.anchors',
    })
    const x = Math.floor(ctx.sizeX / 2)
    const z = Math.floor(ctx.sizeZ / 2)
    return {
        x: x + 0.5,
        y: surfaceY(grid, x, z) + 1,
        z: z + 0.5,
    }
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

function rememberRoadGradeCell(
    ctx: WorldgenCompileContext,
    cells: { x: number; z: number }[],
    keys: Set<string>,
    x: number,
    z: number,
): void {
    const key = ctx.reservationKey(x, z)
    if (keys.has(key)) return
    keys.add(key)
    cells.push({ x, z })
}

function relaxRoadGrade(
    ctx: WorldgenCompileContext,
    grid: SurfaceGrid,
    cells: readonly { x: number; z: number }[],
    iterations: number,
    maxStep: number,
): void {
    if (cells.length === 0 || iterations <= 0) return
    const members = new Set(cells.map(({ x, z }) => ctx.reservationKey(x, z)))
    for (let i = 0; i < iterations; i += 1) {
        const next = new Map<string, number>()
        for (const cell of cells) {
            const y = surfaceY(grid, cell.x, cell.z)
            let target = y
            let neighborCount = 0
            let neighborTotal = 0
            let lo = -Infinity
            let hi = Infinity
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                const nx = cell.x + dx
                const nz = cell.z + dz
                const nkey = ctx.reservationKey(nx, nz)
                if (!members.has(nkey)) continue
                const ny = surfaceY(grid, nx, nz)
                neighborCount += 1
                neighborTotal += ny
                lo = Math.max(lo, ny - maxStep)
                hi = Math.min(hi, ny + maxStep)
            }
            if (neighborCount > 0) {
                target = lo <= hi ? clamp(y, lo, hi) : Math.round((lo + hi) / 2)
                const localAverage = Math.round((target * 2 + neighborTotal / neighborCount) / 3)
                target = lo <= hi ? clamp(localAverage, lo, hi) : localAverage
            }
            next.set(ctx.reservationKey(cell.x, cell.z), ctx.clampSurfaceY(target))
        }
        for (const cell of cells) {
            const y = next.get(ctx.reservationKey(cell.x, cell.z))
            if (y === undefined) continue
            setSurface(grid, cell.x, cell.z, y, surfaceBlock(grid, cell.x, cell.z))
        }
    }
}

function writeSurfaceBorderWalls(ctx: WorldgenCompileContext, grid: SurfaceGrid): void {
    const write = (x: number, z: number): void => {
        const fromY = surfaceY(grid, x, z) + 1
        const toY = Math.min(ctx.sizeY - 1, fromY + SURFACE_BORDER_WALL_HEIGHT - 1)
        for (let y = fromY; y <= toY; y += 1) ctx.setVoxel(x, y, z, BLOCK.noWalk)
    }
    for (let x = 0; x < ctx.sizeX; x += 1) {
        write(x, 0)
        write(x, ctx.sizeZ - 1)
    }
    for (let z = 1; z < ctx.sizeZ - 1; z += 1) {
        write(0, z)
        write(ctx.sizeX - 1, z)
    }
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

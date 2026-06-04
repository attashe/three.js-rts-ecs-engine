import type { Zone } from '../../engine/ecs/zones'
import { isRecord } from './worldgen-util'
import { BLOCK, isCollidable, isPathSurface } from '../../engine/voxel/palette'
import {
    generateStructureAsset,
    measureStructurePlacement,
    placeStructureAsset,
    prefabSource,
    structurePropPlacements,
    type StructureAsset,
} from '../../procedural-structures'
import type {
    CarverSpec,
    ConnectorSpec,
    NormalizedWorldSpec,
    PathSpec,
    ScatterSpec,
    StructurePlacementSpec,
    Vec2Tuple,
    Vec3Tuple,
    VoxelCoord,
    WorldgenCompileOptions,
    WorldgenCompileResult,
} from './spec-types'
import { createWorldgenReport } from './report'
import { hashHex, stableJson } from './rng'
import { WorldgenCompileContext, clamp, lerp } from './compile-context'
import { emptyWorldgenMeta, finishWorldgenCompile, shouldStopWorldgen, worldgenChunks } from './compile-result'
import { WorldgenLevelDraft } from './level-draft'
import { resolveContent } from './resolve-content'
import { validateRequiredPaths } from './validate'

interface UndergroundFeature {
    id: string
    cells: Set<string>
    floor: Set<string>
    wall: Set<string>
    ceiling: Set<string>
    bounds: Bounds3 | null
    meta: {
        type?: string
        center?: Vec3Tuple
        bottom?: Vec3Tuple
        floorY?: number
        size?: Vec3Tuple
        spline?: Vec3Tuple[]
    }
}

interface UndergroundState {
    features: Map<string, UndergroundFeature>
}

interface Bounds3 {
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
}

interface SurfaceCandidate {
    x: number
    y: number
    z: number
    kind: string
    score: number
    normal?: { x: number; z: number }
}

const SUPPORTED_CARVERS = new Set(['vertical_shaft', 'chamber_ellipsoid', 'rect_room', 'dwarf_room', 'mine_tunnel_network', 'underground_canyon'])
const SUPPORTED_CONNECTORS = new Set(['noise_tube'])
const MARKER_ASSETS = new Set(['marker.spawn', 'marker.player'])
const PORTAL_ASSET = 'fixed.portal.blue_stone'
const BRIDGE_ASSET = 'fixed.bridge.broken_stone'
const SHRINE_ASSET = 'fixed.shrine.moonstone'
const DWARF_ROOM_ASSETS = new Set(['fixed.room.dwarf_living', 'fixed.room.dwarf_forge', 'fixed.room.dwarf_storage'])

export function compileUndergroundWorld(
    spec: NormalizedWorldSpec,
    opts: WorldgenCompileOptions = {},
): WorldgenCompileResult {
    const report = createWorldgenReport(spec.world.id, hashHex(stableJson(spec)))
    const chunks = worldgenChunks(opts)
    const ctx = new WorldgenCompileContext(spec, report, chunks)
    const state: UndergroundState = { features: new Map() }

    if (spec.world.type !== 'underground') {
        ctx.error({
            code: 'unsupported_world_type',
            message: `Phase 6 underground compiler only supports underground worlds, got "${spec.world.type}".`,
            path: '$.world.type',
            details: { type: spec.world.type },
        })
        return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    }
    ctx.chunks.withBulkEdit(() => {
        fillUnderground(ctx)
        applyStrata(ctx)
        applyCarvers(ctx, state)
        applyConnectors(ctx, state)
        applyMainPaths(ctx, state)
        refreshAllFeatureSurfaces(ctx, state)
    })
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))

    const draft = new WorldgenLevelDraft({
        name: spec.world.name,
        size: Math.max(ctx.sizeX, ctx.sizeZ),
        sizeX: ctx.sizeX,
        sizeZ: ctx.sizeZ,
        spawn: undergroundFallbackSpawn(ctx, state),
    })

    placeUndergroundStructures(ctx, state, draft)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    scatterUnderground(ctx, state)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    draft.spawn = undergroundSpawn(ctx, state)

    resolveContent(ctx, draft, {
        standYAtXZ: (x, z) => findBestSurfaceNear(ctx, state, x, z, { kind: 'floor', yRange: [1, ctx.sizeY - 2], searchRadius: 4 })?.y ?? 1,
    })
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    validateRequiredPaths(ctx)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))

    return finishWorldgenCompile(ctx, draft.toMeta())
}

function fillUnderground(ctx: WorldgenCompileContext): void {
    const volume = ctx.spec.volume ?? {}
    const initial = typeof volume.initial === 'string' ? volume.initial : 'solid'
    if (initial !== 'solid') {
        ctx.error({
            code: 'unsupported_feature',
            message: `Unsupported underground volume.initial "${initial}".`,
            path: '$.volume.initial',
            details: { initial },
        })
    }
    const block = ctx.material(volume.default_material, 'stone2', '$.volume.default_material')
    for (let y = 0; y < ctx.sizeY; y += 1) {
        for (let z = 0; z < ctx.sizeZ; z += 1) {
            for (let x = 0; x < ctx.sizeX; x += 1) ctx.setVoxel(x, y, z, block)
        }
    }
}

function applyStrata(ctx: WorldgenCompileContext): void {
    const strata = ctx.spec.volume?.strata ?? []
    for (let i = 0; i < strata.length; i += 1) {
        const layer = strata[i]!
        const path = `$.volume.strata[${i}]`
        const range = readYRange(ctx, layer.y, `${path}.y`, 0, ctx.sizeY - 1)
        const block = ctx.material(layer.material, 'stone2', `${path}.material`)
        for (let y = range.min; y <= range.max; y += 1) {
            for (let z = 0; z < ctx.sizeZ; z += 1) {
                for (let x = 0; x < ctx.sizeX; x += 1) ctx.setVoxel(x, y, z, block)
            }
        }
    }
}

function applyCarvers(ctx: WorldgenCompileContext, state: UndergroundState): void {
    const carvers = ctx.spec.carvers ?? []
    for (let i = 0; i < carvers.length; i += 1) {
        const carver = carvers[i]!
        const path = `$.carvers[${i}]`
        if (!SUPPORTED_CARVERS.has(carver.type)) {
            ctx.error({
                code: 'unsupported_feature',
                message: `Unsupported underground carver type "${carver.type}".`,
                path: `${path}.type`,
                details: { id: carver.id, type: carver.type },
            })
            continue
        }
        switch (carver.type) {
            case 'vertical_shaft':
                carveVerticalShaft(ctx, state, carver, path)
                break
            case 'chamber_ellipsoid':
                carveEllipsoidChamber(ctx, state, carver, path)
                break
            case 'rect_room':
            case 'dwarf_room':
                carveRectRoom(ctx, state, carver, path)
                break
            case 'mine_tunnel_network':
                carveMineTunnelNetwork(ctx, state, carver, path)
                break
            case 'underground_canyon':
                carveUndergroundCanyon(ctx, state, carver, path)
                break
        }
    }
}

function applyConnectors(ctx: WorldgenCompileContext, state: UndergroundState): void {
    const connectors = ctx.spec.connectors ?? []
    for (let i = 0; i < connectors.length; i += 1) {
        const connector = connectors[i]!
        const path = `$.connectors[${i}]`
        if (!SUPPORTED_CONNECTORS.has(connector.type)) {
            ctx.error({
                code: 'unsupported_feature',
                message: `Unsupported underground connector type "${connector.type}".`,
                path: `${path}.type`,
                details: { id: connector.id, type: connector.type },
            })
            continue
        }
        carveNoiseTube(ctx, state, connector, path)
    }
}

function applyMainPaths(ctx: WorldgenCompileContext, state: UndergroundState): void {
    const paths = ctx.spec.main_paths ?? []
    for (let i = 0; i < paths.length; i += 1) stampWalkablePath(ctx, state, paths[i]!, `$.main_paths[${i}]`)
}

function carveVerticalShaft(ctx: WorldgenCompileContext, state: UndergroundState, feature: CarverSpec, path: string): void {
    const center = readVec2(ctx, feature.center_xz, `${path}.center_xz`)
    const yRange = readNumberRange(ctx, feature.y_range, `${path}.y_range`, [Math.max(1, ctx.sizeY - 16), ctx.sizeY - 2])
    if (!center || !yRange) return
    const [cx, cz] = center
    const minY = Math.max(1, Math.min(yRange[0], yRange[1]))
    const maxY = Math.min(ctx.sizeY - 2, Math.max(yRange[0], yRange[1]))
    const radius = ctx.number(feature.radius, 4, `${path}.radius`, { min: 1 })
    const roughness = ctx.number(feature.roughness, 0.15, `${path}.roughness`, { min: 0 })
    const f = ensureFeature(state, feature.id)
    const bounds = boundsAround(cx, (minY + maxY) / 2, cz, radius + 2, (maxY - minY) / 2 + 2, radius + 2)

    for (let y = minY; y <= maxY; y += 1) {
        for (let z = Math.floor(cz - radius - 1); z <= Math.ceil(cz + radius + 1); z += 1) {
            for (let x = Math.floor(cx - radius - 1); x <= Math.ceil(cx + radius + 1); x += 1) {
                if (!ctx.inXYZ(x, y, z)) continue
                const n = signedNoise(ctx, feature.id, x, y, z, 8) * roughness
                if (Math.hypot(x - cx, z - cz) <= radius + n) carveAir(ctx, f, x, y, z)
            }
        }
    }

    if (feature.stairs === 'spiral') {
        for (let y = minY; y <= maxY; y += 1) {
            const t = (y - minY) / Math.max(1, maxY - minY)
            const angle = t * Math.PI * 4
            const sx = Math.round(cx + Math.cos(angle) * (radius - 1))
            const sz = Math.round(cz + Math.sin(angle) * (radius - 1))
            for (let dz = -1; dz <= 1; dz += 1) {
                for (let dx = -1; dx <= 1; dx += 1) {
                    if (Math.abs(dx) + Math.abs(dz) > 1) continue
                    stampFloorCell(ctx, f, sx + dx, y, sz + dz, BLOCK.stone)
                }
            }
        }
    }

    f.meta.type = feature.type
    f.meta.center = [Math.round(cx), minY, Math.round(cz)]
    f.meta.bottom = [Math.round(cx), minY, Math.round(cz)]
    f.bounds = mergeBounds(f.bounds, bounds)
    ctx.report.placements.push({ id: feature.id, kind: 'carver', type: feature.type, center_xz: center, y_range: [minY, maxY] })
}

function carveEllipsoidChamber(ctx: WorldgenCompileContext, state: UndergroundState, feature: CarverSpec, path: string): void {
    const center = readVec3(ctx, feature.center, `${path}.center`)
    const radius = readVec3(ctx, feature.radius, `${path}.radius`)
    if (!center || !radius) return
    const [cx, cy, cz] = center
    const [rx, ry, rz] = radius.map((part) => Math.max(1, part)) as Vec3Tuple
    const roughness = ctx.number(feature.roughness, 0, `${path}.roughness`, { min: 0 })
    const f = ensureFeature(state, feature.id)
    const bounds = boundsAround(cx, cy, cz, rx + 2, ry + 2, rz + 2)

    for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
            for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
                if (!ctx.inXYZ(x, y, z)) continue
                const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2
                const threshold = 1 + signedNoise(ctx, feature.id, x, y, z, 9) * roughness * 0.35
                if (d <= threshold) carveAir(ctx, f, x, y, z)
            }
        }
    }

    if (feature.floor_flatten !== false) {
        const floor = isRecord(feature.floor_flatten) ? feature.floor_flatten : {}
        const floorY = ctx.number(feature.floor_y, Math.round(cy - ry * 0.55), `${path}.floor_y`, { min: 1, max: ctx.sizeY - 3, integer: true })
        const padRx = ctx.number(floor.radius_x, Math.max(4, rx * 0.55), `${path}.floor_flatten.radius_x`, { min: 1 })
        const padRz = ctx.number(floor.radius_z, Math.max(4, rz * 0.55), `${path}.floor_flatten.radius_z`, { min: 1 })
        for (let z = Math.floor(cz - padRz); z <= Math.ceil(cz + padRz); z += 1) {
            for (let x = Math.floor(cx - padRx); x <= Math.ceil(cx + padRx); x += 1) {
                if (((x - cx) / padRx) ** 2 + ((z - cz) / padRz) ** 2 <= 1) stampFloorCell(ctx, f, x, floorY, z, BLOCK.stone)
            }
        }
        f.meta.floorY = floorY
        f.meta.center = [Math.round(cx), floorY, Math.round(cz)]
    } else {
        f.meta.center = [Math.round(cx), Math.round(cy), Math.round(cz)]
    }

    f.meta.type = feature.type
    f.bounds = mergeBounds(f.bounds, bounds)
    ctx.report.placements.push({ id: feature.id, kind: 'carver', type: feature.type, center, radius })
}

function carveRectRoom(ctx: WorldgenCompileContext, state: UndergroundState, feature: CarverSpec, path: string): void {
    const center = readVec3(ctx, feature.center, `${path}.center`)
    const size = readVec3(ctx, feature.size ?? feature.dimensions, `${path}.size`)
    if (!center || !size) return
    const [cx, floorYRaw, cz] = center
    const floorY = clamp(Math.round(floorYRaw), 1, ctx.sizeY - 3)
    const [wRaw, hRaw, dRaw] = size
    const width = Math.max(3, Math.round(wRaw))
    const height = Math.max(3, Math.round(hRaw))
    const depth = Math.max(3, Math.round(dRaw))
    const floorBlock = ctx.material(feature.floor_material ?? feature.material, 'stone', `${path}.floor_material`)
    const minX = Math.floor(cx - width / 2)
    const maxX = minX + width - 1
    const minZ = Math.floor(cz - depth / 2)
    const maxZ = minZ + depth - 1
    const maxY = Math.min(ctx.sizeY - 2, floorY + height)
    const f = ensureFeature(state, feature.id)

    for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            stampFloorCell(ctx, f, x, floorY, z, floorBlock, maxY - floorY)
        }
    }

    if (feature.support_pillars !== false) {
        const pillars = [[minX + 1, minZ + 1], [maxX - 1, minZ + 1], [minX + 1, maxZ - 1], [maxX - 1, maxZ - 1]]
        for (const [px, pz] of pillars) {
            for (let y = floorY; y < maxY; y += 1) setSolid(ctx, px, y, pz, BLOCK.wood)
        }
    }
    if (feature.lanterns !== false) setSolid(ctx, Math.round(cx), Math.min(maxY - 1, floorY + Math.max(3, height - 1)), Math.round(cz), BLOCK.torch)

    f.meta.type = feature.type
    f.meta.center = [Math.round(cx), floorY, Math.round(cz)]
    f.meta.floorY = floorY
    f.meta.size = [width, height, depth]
    f.bounds = mergeBounds(f.bounds, { minX, maxX, minY: floorY - 1, maxY, minZ, maxZ })
    ctx.report.placements.push({ id: feature.id, kind: 'carver', type: feature.type, center, size: [width, height, depth] })
}

function carveMineTunnelNetwork(ctx: WorldgenCompileContext, state: UndergroundState, feature: CarverSpec, path: string): void {
    const corridors = readCorridors(ctx, feature.corridors ?? (feature.points ? [feature.points] : []), `${path}.corridors`)
    const f = ensureFeature(state, feature.id)
    const halfWidth = Math.max(1, Math.floor(ctx.number(feature.half_width, Math.max(1, Math.floor(ctx.number(feature.width, 5, `${path}.width`, { min: 1 }) / 2)), `${path}.half_width`, { min: 1 })))
    const height = Math.max(2, Math.floor(ctx.number(feature.height, 5, `${path}.height`, { min: 2 })))
    const floorBlock = ctx.material(feature.floor_material, 'stone', `${path}.floor_material`)
    const supportEvery = Math.max(0, Math.floor(ctx.number(feature.supports_every ?? feature.support_every, 7, `${path}.supports_every`, { min: 0 })))
    const lanternEvery = Math.max(0, Math.floor(ctx.number(feature.lantern_every, 11, `${path}.lantern_every`, { min: 0 })))
    let step = 0

    for (const corridor of corridors) {
        for (let i = 0; i < corridor.length - 1; i += 1) {
            const a = corridor[i]!
            const b = corridor[i + 1]!
            const length = distance3(a, b)
            const steps = Math.max(2, Math.ceil(length * 1.6))
            for (let s = 0; s <= steps; s += 1) {
                const t = s / steps
                const x = Math.round(lerp(a[0], b[0], t))
                const y = Math.round(lerp(a[1], b[1], t))
                const z = Math.round(lerp(a[2], b[2], t))
                stampTunnelCell(ctx, f, x, y, z, halfWidth, height, floorBlock)
                if (feature.rails !== false) setSolid(ctx, x, y, z, BLOCK.rail)
                if (supportEvery > 0 && step % supportEvery === 0) {
                    for (let py = y; py < y + height; py += 1) {
                        setSolid(ctx, x - halfWidth, py, z, BLOCK.wood)
                        setSolid(ctx, x + halfWidth, py, z, BLOCK.wood)
                    }
                }
                if (lanternEvery > 0 && step % lanternEvery === Math.floor(lanternEvery / 2)) setSolid(ctx, x, y + Math.max(2, height - 1), z, BLOCK.torch)
                step += 1
            }
        }
    }

    f.meta.type = feature.type
    f.meta.center = corridors[0]?.[0] ? [...corridors[0][0]] as Vec3Tuple : [0, 0, 0]
    ctx.report.placements.push({ id: feature.id, kind: 'carver', type: feature.type, corridorCount: corridors.length, halfWidth, height })
}

function carveUndergroundCanyon(ctx: WorldgenCompileContext, state: UndergroundState, feature: CarverSpec, path: string): void {
    const spline = readPointList3(ctx, feature.spline, `${path}.spline`)
    if (spline.length < 2) return
    const [widthA, widthB] = readNumberRange(ctx, feature.width, `${path}.width`, [18, 24]) ?? [18, 24]
    const widthBase = (widthA + widthB) / 2
    const widthNoise = Math.abs(widthB - widthA) / 2
    const depth = ctx.number(feature.depth, 18, `${path}.depth`, { min: 1 })
    const ceiling = ctx.number(feature.ceiling_height ?? feature.ceiling, 18, `${path}.ceiling_height`, { min: 1 })
    const f = ensureFeature(state, feature.id)
    const bounds = boundsForSpline(spline, widthBase + widthNoise + 4, Math.max(depth, ceiling) + 3)

    for (let z = bounds.minZ; z <= bounds.maxZ; z += 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
            const best = closestSplinePointXZ(spline, x, z)
            const localHalf = widthBase / 2 + signedNoise2(ctx, `${feature.id}:width`, best.globalT * 120, best.dist, 18) * widthNoise
            if (best.dist > localHalf + 3) continue
            for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
                if (!ctx.inXYZ(x, y, z)) continue
                const v = y >= best.y ? (y - best.y) / Math.max(ceiling, 1) : (best.y - y) / Math.max(depth, 1)
                const lateral = best.dist / Math.max(localHalf, 1)
                if (lateral * lateral + v * v <= 1) carveAir(ctx, f, x, y, z)
            }
        }
    }

    const ledgeWidth = isRecord(feature.ledges) && isRecord(feature.ledges.required_main_path)
        ? ctx.number(feature.ledges.required_main_path.width, 4, `${path}.ledges.required_main_path.width`, { min: 1 })
        : 4
    for (let i = 0; i <= 120; i += 1) {
        const t = i / 120
        const point = pointOnSpline3(spline, t)
        const tangent = splineTangentXZ(spline, t)
        const len = Math.hypot(tangent.x, tangent.z) || 1
        const nx = -tangent.z / len
        const nz = tangent.x / len
        const side = i < 66 ? -1 : 1
        for (let along = -1; along <= 1; along += 1) {
            for (let off = 0; off < ledgeWidth; off += 1) {
                const x = Math.round(point[0] + (tangent.x / len) * along + nx * side * (widthBase / 2 - off - 1))
                const y = Math.round(point[1])
                const z = Math.round(point[2] + (tangent.z / len) * along + nz * side * (widthBase / 2 - off - 1))
                stampFloorCell(ctx, f, x, y, z, BLOCK.stone)
            }
        }
    }

    if (isRecord(feature.crossing)) {
        const atT = ctx.number(feature.crossing.at_t, 0.5, `${path}.crossing.at_t`, { min: 0, max: 1 })
        const point = pointOnSpline3(spline, atT).map(Math.round) as Vec3Tuple
        const tangent = splineTangentXZ(spline, atT)
        const len = Math.hypot(tangent.x, tangent.z) || 1
        const nx = -tangent.z / len
        const nz = tangent.x / len
        for (let off = -Math.ceil(widthBase / 2); off <= Math.ceil(widthBase / 2); off += 1) {
            for (let thick = -1; thick <= 1; thick += 1) {
                const x = Math.round(point[0] + nx * off + (tangent.x / len) * thick)
                const z = Math.round(point[2] + nz * off + (tangent.z / len) * thick)
                stampFloorCell(ctx, f, x, point[1], z, BLOCK.plank)
            }
        }
        const socketId = typeof feature.crossing.id === 'string' && feature.crossing.id.trim().length > 0
            ? feature.crossing.id.trim()
            : `${feature.id}.bridge_socket`
        ctx.resolveObject(socketId, { x: point[0] + 0.5, y: point[1], z: point[2] + 0.5 })
    }

    f.meta.type = feature.type
    f.meta.spline = spline
    f.meta.center = pointOnSpline3(spline, 0.5).map(Math.round) as Vec3Tuple
    f.bounds = mergeBounds(f.bounds, bounds)
    ctx.report.placements.push({ id: feature.id, kind: 'carver', type: feature.type, spline, ledgeWidth })
}

function carveNoiseTube(ctx: WorldgenCompileContext, state: UndergroundState, feature: ConnectorSpec, path: string): void {
    const from = resolvePoint(ctx, state, feature.from, `${path}.from`)
    const to = resolvePoint(ctx, state, feature.to, `${path}.to`)
    const radius = readNumberRange(ctx, feature.radius, `${path}.radius`, [4, 5])
    if (!from || !to || !radius) return
    const [r0, r1] = radius
    const steps = Math.max(8, Math.ceil(distance3(from, to) * 1.4))
    const f = ensureFeature(state, feature.id)
    const verticalWander = ctx.number(feature.vertical_wander, 0, `${path}.vertical_wander`, { min: 0 })
    for (let i = 0; i <= steps; i += 1) {
        const t = i / steps
        const x = lerp(from[0], to[0], t) + signedNoise2(ctx, `${feature.id}:x`, t * 100, 0, 20) * verticalWander
        const floorY = Math.round(lerp(from[1], to[1], t))
        const z = lerp(from[2], to[2], t) + signedNoise2(ctx, `${feature.id}:z`, t * 100, 10, 20) * verticalWander
        const r = lerp(r0, r1, ctx.rand01(feature.id, i, 'radius'))
        carveSphere(ctx, f, x, floorY + r * 0.45, z, r)
        for (let dz = -Math.floor(r); dz <= Math.floor(r); dz += 1) {
            for (let dx = -Math.floor(r); dx <= Math.floor(r); dx += 1) {
                if (Math.hypot(dx, dz) <= r * 0.58) stampFloorCell(ctx, f, Math.round(x + dx), floorY, Math.round(z + dz), BLOCK.stone)
            }
        }
    }
    f.meta.type = feature.type
    f.meta.center = [Math.round((from[0] + to[0]) / 2), Math.round((from[1] + to[1]) / 2), Math.round((from[2] + to[2]) / 2)]
    ctx.report.placements.push({ id: feature.id, kind: 'connector', type: feature.type, from, to })
}

function stampWalkablePath(ctx: WorldgenCompileContext, state: UndergroundState, pathSpec: PathSpec, path: string): void {
    const waypoints = readPointList3(ctx, pathSpec.waypoints, `${path}.waypoints`)
    if (waypoints.length < 2) return
    const width = Math.max(1, Math.floor(ctx.number(pathSpec.width, 3, `${path}.width`, { min: 1 })))
    const carveRadius = ctx.number(pathSpec.carve_radius, Math.max(3, width + 1), `${path}.carve_radius`, { min: 1 })
    const floorBlock = ctx.material(pathSpec.floor_block ?? pathSpec.material, 'stone', `${path}.floor_block`)
    const f = ensureFeature(state, pathSpec.id)
    for (let i = 0; i < waypoints.length - 1; i += 1) {
        const a = waypoints[i]!
        const b = waypoints[i + 1]!
        const steps = Math.max(2, Math.ceil(distance3(a, b) * 1.8), Math.abs(Math.round(b[1] - a[1])) * 2)
        for (let s = 0; s <= steps; s += 1) {
            const t = s / steps
            const x = lerp(a[0], b[0], t)
            const y = lerp(a[1], b[1], t)
            const z = lerp(a[2], b[2], t)
            carveSphere(ctx, f, x, y + carveRadius * 0.45, z, carveRadius)
            for (let dz = -width; dz <= width; dz += 1) {
                for (let dx = -width; dx <= width; dx += 1) {
                    if (Math.hypot(dx, dz) <= width) stampFloorCell(ctx, f, Math.round(x + dx), Math.round(y), Math.round(z + dz), floorBlock)
                }
            }
        }
    }
    f.meta.type = 'guaranteed_path'
    f.meta.center = waypoints[Math.floor(waypoints.length / 2)]!
    ctx.report.placements.push({ id: pathSpec.id, kind: 'guaranteed_path', width, carveRadius, waypoints })
}

function placeUndergroundStructures(ctx: WorldgenCompileContext, state: UndergroundState, draft: WorldgenLevelDraft): void {
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

function scatterUnderground(ctx: WorldgenCompileContext, state: UndergroundState): void {
    const scatter = ctx.spec.scatter ?? []
    for (let i = 0; i < scatter.length; i += 1) {
        const spec = scatter[i]!
        const path = `$.scatter[${i}]`
        const count = Math.max(0, Math.floor(ctx.number(spec.count, 0, `${path}.count`, { min: 0 })))
        const asset = typeof spec.asset === 'string' ? spec.asset.trim() : ''
        if (!['proc.mushroom.glow_cluster', 'proc.crystal.wall_cluster', 'proc.stalactite'].includes(asset)) {
            ctx.warning({ code: 'unsupported_structure_asset', message: `Unsupported underground scatter asset "${asset}".`, path: `${path}.asset`, details: { id: spec.id, asset } })
            ctx.report.placements.push({ id: spec.id, kind: 'scatter_summary', requested: count, placed: 0, surface: spec.surface ?? 'floor', feature: spec.feature ?? 'any' })
            continue
        }
        const candidates = undergroundScatterCandidates(ctx, state, spec)
        candidates.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y || a.z - b.z)
        const minDistance = ctx.number(spec.min_distance, 1, `${path}.min_distance`, { min: 0 })
        const used: SurfaceCandidate[] = []
        let placed = 0
        for (const candidate of candidates) {
            if (placed >= count) break
            if (used.some((other) => distance3([other.x, other.y, other.z], [candidate.x, candidate.y, candidate.z]) < minDistance)) continue
            if (asset === 'proc.mushroom.glow_cluster') {
                setSolid(ctx, candidate.x, candidate.y, candidate.z, BLOCK.mushroom)
                setSolid(ctx, candidate.x, candidate.y + 1, candidate.z, BLOCK.torch)
            } else if (asset === 'proc.crystal.wall_cluster') {
                setSolid(ctx, candidate.x, candidate.y, candidate.z, BLOCK.glow)
            } else {
                const maxLength = Math.max(2, Math.floor(ctx.number(spec.max_length, 7, `${path}.max_length`, { min: 2 })))
                const length = ctx.randInt(2, maxLength, spec.id, placed, 'length')
                for (let y = candidate.y; y > candidate.y - length; y -= 1) setSolid(ctx, candidate.x, y, candidate.z, BLOCK.stone2)
            }
            used.push(candidate)
            placed += 1
        }
        ctx.report.placements.push({ id: spec.id, kind: 'scatter_summary', requested: count, placed, surface: spec.surface ?? 'floor', feature: spec.feature ?? 'any' })
        if (placed < count) ctx.warning({ code: 'placement_failed', message: `Underground scatter "${spec.id}" placed ${placed} of ${count}.`, path, details: { requested: count, placed } })
    }
}

function undergroundScatterCandidates(ctx: WorldgenCompileContext, state: UndergroundState, spec: ScatterSpec): SurfaceCandidate[] {
    const surfaceKind = typeof spec.surface === 'string' ? spec.surface : 'floor'
    const featureId = typeof spec.feature === 'string' ? spec.feature : ''
    const feature = featureId ? state.features.get(featureId) : null
    const out: SurfaceCandidate[] = []
    if (feature && (surfaceKind === 'floor' || surfaceKind === 'wall' || surfaceKind === 'ceiling')) {
        for (const key of feature[surfaceKind]) {
            const [x, y, z] = keyToCoord(key)
            out.push({ x, y, z, kind: surfaceKind, score: ctx.rand01(spec.id, x, y, z) })
        }
        return out
    }
    for (let z = 1; z < ctx.sizeZ - 1; z += 2) {
        for (let x = 1; x < ctx.sizeX - 1; x += 2) {
            for (let y = 1; y < ctx.sizeY - 2; y += 1) {
                const candidate = surfaceAt(ctx, x, y, z, surfaceKind, 2)
                if (candidate) out.push({ ...candidate, score: ctx.rand01(spec.id, x, y, z) })
            }
        }
    }
    return out
}

function refreshAllFeatureSurfaces(ctx: WorldgenCompileContext, state: UndergroundState): void {
    for (const feature of state.features.values()) refreshFeatureSurfaces(ctx, feature)
}

function refreshFeatureSurfaces(ctx: WorldgenCompileContext, feature: UndergroundFeature): void {
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

function findBestSurfaceNear(
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

function surfaceAt(ctx: WorldgenCompileContext, x: number, y: number, z: number, kind: string, requireAir: number): SurfaceCandidate | null {
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

function undergroundSpawn(ctx: WorldgenCompileContext, state: UndergroundState): VoxelCoord {
    const spawn = ctx.report.resolvedAnchors.spawn ?? ctx.report.resolvedObjects.spawn
    if (spawn) return spawn
    ctx.warning({ code: 'missing_reference', message: 'No underground spawn marker was resolved; using the first floor surface.', path: '$.structures' })
    return undergroundFallbackSpawn(ctx, state)
}

function undergroundFallbackSpawn(ctx: WorldgenCompileContext, state: UndergroundState): VoxelCoord {
    for (const feature of state.features.values()) {
        const first = feature.floor.values().next()
        if (!first.done) {
            const [x, y, z] = keyToCoord(first.value)
            return { x: x + 0.5, y, z: z + 0.5 }
        }
    }
    return { x: 0.5, y: 1, z: 0.5 }
}

function readSurfaceOptions(ctx: WorldgenCompileContext, value: unknown, path: string): { kind: string; yRange: [number, number]; searchRadius: number; requireAirAbove: number } {
    const source = isRecord(value) ? value : {}
    const kind = typeof source.kind === 'string' ? source.kind : 'floor'
    const range = readNumberRange(ctx, source.y_range, `${path}.y_range`, [1, ctx.sizeY - 2]) ?? [1, ctx.sizeY - 2]
    const searchRadius = Math.max(0, Math.floor(ctx.number(source.search_radius, 4, `${path}.search_radius`, { min: 0 })))
    const requireAirAbove = Math.max(1, Math.floor(ctx.number(source.require_air_above ?? source.require_air, 2, `${path}.require_air_above`, { min: 1 })))
    return { kind, yRange: [Math.max(1, Math.round(Math.min(range[0], range[1]))), Math.min(ctx.sizeY - 2, Math.round(Math.max(range[0], range[1])))], searchRadius, requireAirAbove }
}

function stampTunnelCell(ctx: WorldgenCompileContext, feature: UndergroundFeature, x: number, floorY: number, z: number, halfWidth: number, height: number, floorBlock: number): void {
    for (let dz = -halfWidth; dz <= halfWidth; dz += 1) {
        for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
            if (Math.abs(dx) + Math.abs(dz) > halfWidth + 1) continue
            stampFloorCell(ctx, feature, x + dx, floorY, z + dz, floorBlock, height)
        }
    }
}

function stampFloorCell(ctx: WorldgenCompileContext, feature: UndergroundFeature, x: number, floorY: number, z: number, floorBlock: number, airHeight = 3): void {
    if (!ctx.inXYZ(x, floorY, z)) return
    setSolid(ctx, x, floorY - 1, z, floorBlock)
    for (let y = floorY; y <= Math.min(ctx.sizeY - 2, floorY + airHeight); y += 1) carveAir(ctx, feature, x, y, z)
    feature.floor.add(coordKey(x, floorY, z))
    feature.bounds = mergeBounds(feature.bounds, { minX: x, maxX: x, minY: floorY - 1, maxY: Math.min(ctx.sizeY - 2, floorY + airHeight), minZ: z, maxZ: z })
}

function carveSphere(ctx: WorldgenCompileContext, feature: UndergroundFeature, cx: number, cy: number, cz: number, radius: number): void {
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

function carveAir(ctx: WorldgenCompileContext, feature: UndergroundFeature, x: number, y: number, z: number): void {
    if (!ctx.inXYZ(x, y, z)) return
    ctx.setVoxel(x, y, z, BLOCK.air)
    feature.cells.add(coordKey(x, y, z))
    feature.bounds = mergeBounds(feature.bounds, { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z })
}

function setSolid(ctx: WorldgenCompileContext, x: number, y: number, z: number, block: number): void {
    if (ctx.inXYZ(x, y, z)) ctx.setVoxel(x, y, z, block)
}

function flattenUndergroundFootprint(ctx: WorldgenCompileContext, x: number, y: number, z: number, width: number, depth: number): void {
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
    const block = assetId.includes('forge') ? BLOCK.metal : assetId.includes('storage') ? BLOCK.plank : BLOCK.wood
    for (let dx = -1; dx <= 1; dx += 1) setSolid(ctx, point.x + dx, point.y, point.z, block)
    if (assetId.includes('forge')) setSolid(ctx, point.x, point.y + 1, point.z, BLOCK.fire)
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

function ensureFeature(state: UndergroundState, id: string): UndergroundFeature {
    let feature = state.features.get(id)
    if (!feature) {
        feature = { id, cells: new Set(), floor: new Set(), wall: new Set(), ceiling: new Set(), bounds: null, meta: {} }
        state.features.set(id, feature)
    }
    return feature
}

function isPassableAt(ctx: WorldgenCompileContext, x: number, y: number, z: number): boolean {
    return ctx.inXYZ(x, y, z) && !isCollidable(ctx.chunks.palette, ctx.chunks.getVoxel(x, y, z))
}

function resolvePoint(ctx: WorldgenCompileContext, state: UndergroundState, value: unknown, path: string): Vec3Tuple | null {
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

function readVec2(ctx: WorldgenCompileContext, value: unknown, path: string): Vec2Tuple | null {
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, z] tuple.`, path, details: { value } })
    return null
}

function readVec3(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple | null {
    if (Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number, value[2] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, y, z] tuple.`, path, details: { value } })
    return null
}

function readNumberRange(ctx: WorldgenCompileContext, value: unknown, path: string, fallback: [number, number]): [number, number] | null {
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number]
    }
    if (typeof value === 'number' && Number.isFinite(value)) return [value, value]
    if (value === undefined) return fallback
    ctx.error({ code: 'invalid_feature', message: `${path} must be a number or [min, max] tuple.`, path, details: { value } })
    return null
}

function readYRange(ctx: WorldgenCompileContext, value: unknown, path: string, fallbackMin: number, fallbackMax: number): { min: number; max: number } {
    if (typeof value === 'string') {
        const parts = value.split('..').map((part) => Number(part.trim()))
        if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
            return clampYRange(ctx, parts[0]!, parts[1]!)
        }
    }
    const range = readNumberRange(ctx, value, path, [fallbackMin, fallbackMax])
    return range ? clampYRange(ctx, range[0], range[1]) : { min: fallbackMin, max: fallbackMax }
}

function clampYRange(ctx: WorldgenCompileContext, a: number, b: number): { min: number; max: number } {
    return { min: clamp(Math.round(Math.min(a, b)), 0, ctx.sizeY - 1), max: clamp(Math.round(Math.max(a, b)), 0, ctx.sizeY - 1) }
}

function readPointList3(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple[] {
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: `${path} must be an array of [x, y, z] tuples.`, path, details: { value } })
        return []
    }
    const out: Vec3Tuple[] = []
    for (let i = 0; i < value.length; i += 1) {
        const point = readVec3(ctx, value[i], `${path}[${i}]`)
        if (point) out.push(point)
    }
    return out
}

function readCorridors(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple[][] {
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: `${path} must be an array of point arrays.`, path, details: { value } })
        return []
    }
    const out: Vec3Tuple[][] = []
    for (let i = 0; i < value.length; i += 1) {
        const corridor = readPointList3(ctx, value[i], `${path}[${i}]`)
        if (corridor.length >= 2) out.push(corridor)
    }
    return out
}

function coordKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

function keyToCoord(key: string): Vec3Tuple {
    const [x, y, z] = key.split(',').map(Number)
    return [x ?? 0, y ?? 0, z ?? 0]
}

function boundsAround(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): Bounds3 {
    return { minX: Math.floor(cx - rx), maxX: Math.ceil(cx + rx), minY: Math.floor(cy - ry), maxY: Math.ceil(cy + ry), minZ: Math.floor(cz - rz), maxZ: Math.ceil(cz + rz) }
}

function mergeBounds(a: Bounds3 | null, b: Bounds3): Bounds3 {
    return a
        ? { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }
        : { ...b }
}

function boundsForSpline(points: readonly Vec3Tuple[], xzPad: number, yPad: number): Bounds3 {
    return {
        minX: Math.floor(Math.min(...points.map((p) => p[0])) - xzPad),
        maxX: Math.ceil(Math.max(...points.map((p) => p[0])) + xzPad),
        minY: Math.floor(Math.min(...points.map((p) => p[1])) - yPad),
        maxY: Math.ceil(Math.max(...points.map((p) => p[1])) + yPad),
        minZ: Math.floor(Math.min(...points.map((p) => p[2])) - xzPad),
        maxZ: Math.ceil(Math.max(...points.map((p) => p[2])) + xzPad),
    }
}

function pointOnSpline3(points: readonly Vec3Tuple[], targetT: number): Vec3Tuple {
    const lengths: number[] = []
    let total = 0
    for (let i = 0; i < points.length - 1; i += 1) {
        const length = distance3(points[i]!, points[i + 1]!)
        lengths.push(length)
        total += length
    }
    let distance = clamp(targetT, 0, 1) * total
    for (let i = 0; i < lengths.length; i += 1) {
        const length = lengths[i]!
        if (distance <= length || i === lengths.length - 1) {
            const t = length === 0 ? 0 : distance / length
            const a = points[i]!
            const b = points[i + 1]!
            return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
        }
        distance -= length
    }
    return points[points.length - 1]!
}

function splineTangentXZ(points: readonly Vec3Tuple[], t: number): { x: number; z: number } {
    const a = pointOnSpline3(points, Math.max(0, t - 0.01))
    const b = pointOnSpline3(points, Math.min(1, t + 0.01))
    return { x: b[0] - a[0], z: b[2] - a[2] }
}

function closestSplinePointXZ(points: readonly Vec3Tuple[], x: number, z: number): { dist: number; y: number; globalT: number } {
    let best = { dist: Number.POSITIVE_INFINITY, y: points[0]?.[1] ?? 0, globalT: 0 }
    const lengths: number[] = []
    let total = 0
    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i]!
        const b = points[i + 1]!
        const length = Math.hypot(b[0] - a[0], b[2] - a[2])
        lengths.push(length)
        total += length
    }
    let before = 0
    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i]!
        const b = points[i + 1]!
        const dx = b[0] - a[0]
        const dz = b[2] - a[2]
        const denom = dx * dx + dz * dz || 1
        const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / denom, 0, 1)
        const cx = a[0] + dx * t
        const cz = a[2] + dz * t
        const dist = Math.hypot(x - cx, z - cz)
        const globalT = total === 0 ? 0 : (before + lengths[i]! * t) / total
        if (dist < best.dist) best = { dist, y: lerp(a[1], b[1], t), globalT }
        before += lengths[i]!
    }
    return best
}

function signedNoise(ctx: WorldgenCompileContext, id: string, x: number, y: number, z: number, scale: number): number {
    return ctx.rand01(id, Math.floor(x / scale), Math.floor(y / scale), Math.floor(z / scale)) * 2 - 1
}

function signedNoise2(ctx: WorldgenCompileContext, id: string, x: number, z: number, scale: number): number {
    return ctx.rand01(id, Math.floor(x / scale), Math.floor(z / scale)) * 2 - 1
}

function distance3(a: readonly number[], b: readonly number[]): number {
    return Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0))
}

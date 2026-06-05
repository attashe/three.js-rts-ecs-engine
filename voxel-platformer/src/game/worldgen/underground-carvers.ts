import { BLOCK } from '../../engine/voxel/palette'
import { isRecord } from './worldgen-util'
import { clamp, lerp, type WorldgenCompileContext } from './compile-context'
import type { CarverSpec, ConnectorSpec, PathSpec, Vec3Tuple } from './spec-types'
import type { UndergroundState } from './underground-types'
import {
    boundsAround,
    boundsForSpline,
    closestSplinePointXZ,
    distance3,
    mergeBounds,
    pointOnSpline3,
    signedNoise,
    signedNoise2,
    splineTangentXZ,
} from './worldgen-math'
import {
    readCorridors,
    readNumberRange,
    readPointList3,
    readVec2,
    readVec3,
} from './worldgen-parse'
import {
    carveAir,
    carveSphere,
    ensureFeature,
    resolvePoint,
    setSolid,
    stampFloorCell,
    stampTunnelCell,
} from './underground-stamping'

const SUPPORTED_CARVERS = new Set(['vertical_shaft', 'chamber_ellipsoid', 'rect_room', 'dwarf_room', 'mine_tunnel_network', 'underground_canyon'])
const SUPPORTED_CONNECTORS = new Set(['noise_tube'])

export function applyCarvers(ctx: WorldgenCompileContext, state: UndergroundState): void {
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

export function applyConnectors(ctx: WorldgenCompileContext, state: UndergroundState): void {
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

export function applyMainPaths(ctx: WorldgenCompileContext, state: UndergroundState): void {
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
    const railCells = new Map<string, Vec3Tuple>()
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
                if (feature.rails !== false) railCells.set(`${x},${y},${z}`, [x, y, z])
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

    for (const [x, y, z] of railCells.values()) setSolid(ctx, x, y, z, BLOCK.rail)

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
    const floorCells = new Map<string, Vec3Tuple>()
    const railsToRestore = new Map<string, Vec3Tuple>()

    for (let i = 0; i < waypoints.length - 1; i += 1) {
        const a = waypoints[i]!
        const b = waypoints[i + 1]!
        const steps = Math.max(2, Math.ceil(distance3(a, b) * 1.8), Math.abs(Math.round(b[1] - a[1])) * 2)
        for (let s = 0; s <= steps; s += 1) {
            const t = s / steps
            const x = lerp(a[0], b[0], t)
            const y = lerp(a[1], b[1], t)
            const z = lerp(a[2], b[2], t)
            for (const rail of railCellsWithinSphere(ctx, x, y + carveRadius * 0.45, z, carveRadius)) {
                railsToRestore.set(coordTupleKey(rail), rail)
            }
            carveSphere(ctx, f, x, y + carveRadius * 0.45, z, carveRadius)
            for (let dz = -width; dz <= width; dz += 1) {
                for (let dx = -width; dx <= width; dx += 1) {
                    if (Math.hypot(dx, dz) > width) continue
                    const wx = Math.round(x + dx)
                    const wy = Math.round(y)
                    const wz = Math.round(z + dz)
                    floorCells.set(coordKey(wx, wy, wz), [wx, wy, wz])
                }
            }
        }
    }

    for (const [wx, wy, wz] of floorCells.values()) stampFloorCell(ctx, f, wx, wy, wz, floorBlock)
    for (const [rx, ry, rz] of railsToRestore.values()) setSolid(ctx, rx, ry, rz, BLOCK.rail)

    f.meta.type = 'guaranteed_path'
    f.meta.center = waypoints[Math.floor(waypoints.length / 2)]!
    ctx.report.placements.push({ id: pathSpec.id, kind: 'guaranteed_path', width, carveRadius, waypoints })
}

function coordKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

function coordTupleKey([x, y, z]: Vec3Tuple): string {
    return coordKey(x, y, z)
}

function railCellsWithinSphere(ctx: WorldgenCompileContext, cx: number, cy: number, cz: number, radius: number): Vec3Tuple[] {
    const rails: Vec3Tuple[] = []
    const r = Math.ceil(radius)
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z += 1) {
            for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
                if (Math.hypot(x - cx, y - cy, z - cz) <= radius && ctx.chunks.getVoxel(x, y, z) === BLOCK.rail) {
                    rails.push([x, y, z])
                }
            }
        }
    }
    return rails
}

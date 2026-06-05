import type { Palette } from '../engine/voxel/palette'
import { BLOCK } from '../engine/voxel/palette'
import { boundsOf, bresenham3D, VoxelBuffer } from './buffer'
import type {
    StructureGenerationOptions,
    StructureGenerationResult,
    StructureScale,
    WallGateMode,
    WallParams,
    WallPath,
    WallPathPoint,
    WallStyle,
} from './types'
import type { Rng } from './math'
import { hash2, makeRng } from './math'
import { DEFAULT_STRUCTURE_OPTIONS, WALL_SCALE_DEFAULTS } from './options'

export interface WallGenerationInput {
    path: WallPath | WallPathPoint[]
    params?: Partial<WallParams>
    seed?: number | string
}

export interface TowerWallSocketInput {
    center: WallPathPoint
    radius: number
    toward: Pick<WallPathPoint, 'x' | 'z'>
}

interface WallCell {
    x: number
    y: number
    z: number
    index: number
    normalX: number
    normalZ: number
}

export function normalizeWallParams(input: Partial<WallParams> = {}): WallParams {
    const scale = input.scale === 'folk' ? 'folk' : 'troll'
    const defaults = WALL_SCALE_DEFAULTS[scale]
    return {
        ...DEFAULT_STRUCTURE_OPTIONS.wall,
        ...input,
        scale,
        style: normalizeStyle(input.style),
        length: clampInt(input.length, scale === 'folk' ? 6 : 10, scale === 'folk' ? 80 : 120, defaults.length),
        height: clampInt(input.height, scale === 'folk' ? 3 : 4, scale === 'folk' ? 16 : 32, defaults.height),
        thickness: clampInt(input.thickness, 1, scale === 'folk' ? 4 : 8, defaults.thickness),
        foundationDepth: clampInt(input.foundationDepth, 0, 8, defaults.foundationDepth),
        gate: normalizeGate(input.gate),
        terrainMode: input.terrainMode === 'stepped' ? 'stepped' : 'flat',
        ruinAmount: clamp(finite(input.ruinAmount, DEFAULT_STRUCTURE_OPTIONS.wall.ruinAmount), 0, 0.85),
    }
}

export function generateWallSegment(input: WallGenerationInput, palette?: Palette): StructureGenerationResult {
    const params = normalizeWallParams(input.params)
    const path = normalizePath(input.path)
    const buf = new VoxelBuffer()
    const rng = makeRng(input.seed ?? 'wall')
    composeWallPath(buf, path, params, rng)
    const voxels = buf.toArray()
    const materialCounts: Record<number, number> = {}
    for (const v of voxels) materialCounts[v.block] = (materialCounts[v.block] ?? 0) + 1
    const materialNames: Record<number, string> = {}
    for (const index of Object.keys(materialCounts)) {
        const block = Number(index)
        materialNames[block] = palette?.entries[block]?.name ?? 'block ' + block
    }
    return {
        voxels,
        removed: buf.removed,
        bounds: boundsOf(voxels),
        materialCounts,
        materialNames,
    }
}

export function composeWall(
    buf: VoxelBuffer,
    ox: number,
    oy: number,
    oz: number,
    opts: StructureGenerationOptions,
    rng: Rng,
): void {
    const length = Math.max(1, Math.floor(opts.wall.length))
    const half = Math.floor(length / 2)
    const path: WallPath = {
        points: [
            { x: ox - half, y: oy, z: oz },
            { x: ox + length - half - 1, y: oy, z: oz },
        ],
    }
    composeWallPath(buf, path, opts.wall, rng)
}

export function composeWallPath(buf: VoxelBuffer, path: WallPath, params: WallParams, _rng: Rng): void {
    const cells = wallPathCells(path, params.terrainMode)
    if (cells.length === 0) return
    const offsets = thicknessOffsets(params.thickness)
    const edgeDistance = Math.max(...offsets.map(Math.abs))
    const gate = gateSpec(params.gate, cells, params)
    for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!
        const bodyBaseY = cell.y + params.foundationDepth
        const localHeight = wallHeightAt(cell, params, params.style)
        for (const offset of offsets) {
            const x = cell.x + cell.normalX * offset
            const z = cell.z + cell.normalZ * offset
            const edge = Math.abs(offset) === edgeDistance
            for (let dy = 0; dy < params.foundationDepth; dy++) {
                const y = cell.y + dy
                buf.set(x, y, z, BLOCK.darkStone, 'wall-foundation')
            }
            for (let dy = 0; dy < localHeight; dy++) {
                const visibleDy = params.foundationDepth + dy
                if (gate && inGateOpening(cell, offset, visibleDy, gate)) continue
                const top = dy === localHeight - 1
                const y = bodyBaseY + dy
                const block = wallBodyBlock(x, y, z, params.style, top && params.walkway)
                buf.set(x, y, z, block, top && params.walkway ? 'wall-walkway' : 'wall-body')
            }
            if (params.battlements && edge && shouldPlaceCrenel(i, cell, params, params.style)) {
                const visibleDy = params.foundationDepth + localHeight
                const y = cell.y + visibleDy
                if (!gate || !inGateOpening(cell, offset, visibleDy, gate)) {
                    buf.set(x, y, z, params.style === 'timber' ? BLOCK.woodDark : BLOCK.darkStone, 'wall-crenel')
                }
            }
        }
    }
    if (gate) carveGate(buf, gate, params, params.style)
}

export function wallPathCells(path: WallPath, terrainMode: WallParams['terrainMode'] = 'flat'): WallCell[] {
    const points = path.points.map(roundPoint)
    if (terrainMode === 'flat' && points.length > 0) {
        const y = points[0]!.y
        for (const point of points) point.y = y
    }
    const out: WallCell[] = []
    const seen = new Set<string>()
    let index = 0
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!
        const b = points[i]!
        const tangent = dominantTangent(a, b)
        const normal = dominantNormal(tangent)
        const line = bresenham3D(a.x, a.y, a.z, b.x, b.y, b.z)
        for (let j = 0; j < line.length; j++) {
            if (out.length > 0 && j === 0) continue
            const [x, y, z] = line[j]!
            const k = `${x},${y},${z}`
            if (seen.has(k)) continue
            seen.add(k)
            out.push({ x, y, z, index, normalX: normal.x, normalZ: normal.z })
            index++
        }
    }
    return out
}

export function wallPlacementEdits(input: WallGenerationInput): Array<{ x: number; y: number; z: number; value: number }> {
    return generateWallSegment(input).voxels.map((v) => ({ x: v.x, y: v.y, z: v.z, value: v.block }))
}

export function towerWallSocket(input: TowerWallSocketInput): WallPathPoint {
    const dx = input.toward.x - input.center.x
    const dz = input.toward.z - input.center.z
    if (Math.abs(dx) >= Math.abs(dz)) {
        return { x: Math.round(input.center.x + Math.sign(dx || 1) * input.radius), y: Math.round(input.center.y), z: Math.round(input.center.z) }
    }
    return { x: Math.round(input.center.x), y: Math.round(input.center.y), z: Math.round(input.center.z + Math.sign(dz || 1) * input.radius) }
}

function normalizePath(path: WallPath | WallPathPoint[]): WallPath {
    return Array.isArray(path) ? { points: path } : path
}

function roundPoint(point: WallPathPoint): WallPathPoint {
    return { x: Math.round(point.x), y: Math.round(point.y), z: Math.round(point.z) }
}

function dominantTangent(a: WallPathPoint, b: WallPathPoint): { x: number; z: number } {
    const dx = b.x - a.x
    const dz = b.z - a.z
    if (Math.abs(dx) >= Math.abs(dz)) return { x: Math.sign(dx || 1), z: 0 }
    return { x: 0, z: Math.sign(dz || 1) }
}

function dominantNormal(tangent: { x: number; z: number }): { x: number; z: number } {
    if (tangent.x !== 0) return { x: 0, z: 1 }
    return { x: 1, z: 0 }
}

function thicknessOffsets(thickness: number): number[] {
    const t = Math.max(1, Math.floor(thickness))
    const left = Math.floor((t - 1) / 2)
    const offsets: number[] = []
    for (let i = 0; i < t; i++) offsets.push(i - left)
    return offsets
}

interface GateSpec {
    centerIndex: number
    halfLength: number
    height: number
    cells: Map<number, WallCell>
}

function gateSpec(gate: WallGateMode, cells: WallCell[], params: WallParams): GateSpec | null {
    if (gate === 'none') return null
    if (cells.length < (params.scale === 'folk' ? 7 : 11)) return null
    const width = params.scale === 'folk' ? 2 : 3
    const centerIndex = cells[Math.floor(cells.length / 2)]!.index
    const halfLength = Math.max(1, Math.floor(width / 2))
    const bodyOpeningHeight = Math.min(params.height - 1, params.scale === 'folk' ? 3 : 5)
    const height = params.foundationDepth + bodyOpeningHeight
    if (height < 2) return null
    return {
        centerIndex,
        halfLength,
        height,
        cells: new Map(cells.map((cell) => [cell.index, cell])),
    }
}

function inGateOpening(cell: WallCell, _offset: number, dy: number, gate: GateSpec): boolean {
    return Math.abs(cell.index - gate.centerIndex) <= gate.halfLength && dy >= 0 && dy < gate.height
}

function carveGate(buf: VoxelBuffer, gate: GateSpec, params: WallParams, style: WallStyle): void {
    const lintelBlock = style === 'timber' ? BLOCK.woodDark : BLOCK.darkStone
    for (let i = gate.centerIndex - gate.halfLength - 1; i <= gate.centerIndex + gate.halfLength + 1; i++) {
        const cell = gate.cells.get(i)
        if (!cell) continue
        for (const offset of thicknessOffsets(params.thickness)) {
            const x = cell.x + cell.normalX * offset
            const z = cell.z + cell.normalZ * offset
            if (Math.abs(i - gate.centerIndex) <= gate.halfLength) {
                for (let y = cell.y; y < cell.y + gate.height; y++) buf.del(x, y, z)
            }
            if (Math.abs(i - gate.centerIndex) <= gate.halfLength + 1) {
                buf.set(x, cell.y + gate.height, z, lintelBlock, 'wall-gate-lintel')
            }
        }
    }
}

function wallHeightAt(cell: WallCell, params: WallParams, style: WallStyle): number {
    if (style !== 'ruined' && params.ruinAmount <= 0) return params.height
    const n = hash2(cell.x, cell.z, 97)
    const ruin = style === 'ruined' ? Math.max(params.ruinAmount, 0.28) : params.ruinAmount
    if (n > ruin) return params.height
    const drop = 1 + Math.floor(hash2(cell.x, cell.z, 131) * Math.max(1, Math.floor(params.height * 0.45)))
    return Math.max(2, params.height - drop)
}

function wallBodyBlock(x: number, y: number, z: number, style: WallStyle, walkway: boolean): number {
    if (walkway) return style === 'timber' ? BLOCK.plank : BLOCK.stone2
    if (style === 'timber') {
        const n = hash2(x + y, z - y, 71)
        return n < 0.28 ? BLOCK.woodDark : n < 0.62 ? BLOCK.plank : BLOCK.wood
    }
    const n = hash2(x * 2 + y, z * 2 - y, 51)
    if (n < 0.10) return BLOCK.darkStone
    if (n < 0.46) return BLOCK.stone2
    return BLOCK.stone
}

function shouldPlaceCrenel(index: number, cell: WallCell, params: WallParams, style: WallStyle): boolean {
    if (style === 'ruined' && hash2(cell.x, cell.z, 173) < Math.max(0.18, params.ruinAmount)) return false
    const spacing = params.scale === 'folk' ? 2 : 3
    return index % spacing === 0
}

function normalizeStyle(style: unknown): WallStyle {
    return style === 'stone' || style === 'timber' || style === 'ruined'
        ? style
        : 'curtain'
}

function normalizeGate(gate: unknown): WallGateMode {
    return gate === 'center' || gate === 'auto' ? gate : 'none'
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
    return Math.round(clamp(finite(value, fallback), min, max))
}

function finite(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) ? value! : fallback
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

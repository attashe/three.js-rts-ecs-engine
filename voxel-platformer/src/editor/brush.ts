import type { VoxelCoord } from '../engine/ecs/world'

export type BrushKind =
    | 'single'
    | 'cube3'
    | 'cube5'
    | 'disk3'
    | 'disk5'
    | 'column'
    | 'wallX'
    | 'wallZ'
    | 'box'

export interface BrushDef {
    readonly kind: BrushKind
    readonly label: string
    readonly hint: string
}

export const BRUSHES: readonly BrushDef[] = [
    { kind: 'single', label: 'Single',     hint: '1 voxel at the cursor' },
    { kind: 'cube3',  label: '3×3×3 cube', hint: '3×3×3 cube centred on the cursor' },
    { kind: 'cube5',  label: '5×5×5 cube', hint: '5×5×5 cube centred on the cursor' },
    { kind: 'disk3',  label: 'Flat 3×3',   hint: '3×3 horizontal disk at the cursor Y' },
    { kind: 'disk5',  label: 'Flat 5×5',   hint: '5×5 horizontal disk at the cursor Y' },
    { kind: 'column', label: 'Column',     hint: 'Vertical column rising from the cursor' },
    { kind: 'wallX',  label: 'Wall X',     hint: '1×N horizontal wall line along X' },
    { kind: 'wallZ',  label: 'Wall Z',     hint: '1×N vertical wall line along Z' },
    { kind: 'box',    label: 'Box drag',   hint: 'Drag to fill the box between press and release' },
]

const BRUSH_BY_KIND = new Map(BRUSHES.map((def) => [def.kind, def]))

export function getBrushDef(kind: BrushKind): BrushDef {
    const def = BRUSH_BY_KIND.get(kind)
    if (!def) throw new Error(`Unknown brush kind: ${kind}`)
    return def
}

/** Optional sizes for the multi-cell brushes (column height, wall length). */
export interface BrushFootprintOptions {
    /** Number of cells in the upward column brush. */
    columnHeight?: number
    /** Number of cells in each 1×N wall-line brush. */
    wallLength?: number
}

/**
 * Build the set of voxel coordinates a brush affects when centred on
 * `center`, except the column brush which uses the cursor as its base.
 * Pure function — no engine state, easy to unit-test.
 *
 * Cube brushes are full 3D cubes (3³ = 27, 5³ = 125). Disk brushes are
 * flat XZ rectangles at the cursor's Y, useful for painting whole floor
 * tiles without changing height.
 */
export function brushFootprint(kind: BrushKind, center: VoxelCoord, opts: BrushFootprintOptions = {}): VoxelCoord[] {
    switch (kind) {
        case 'single': return [{ ...center }]
        case 'cube3':  return cubeFootprint(center, 1)
        case 'cube5':  return cubeFootprint(center, 2)
        case 'disk3':  return diskFootprint(center, 1)
        case 'disk5':  return diskFootprint(center, 2)
        case 'column': return columnFootprint(center, safeLength(opts.columnHeight, 4, 64))
        case 'wallX':  return wallFootprint(center, 'x', safeLength(opts.wallLength, 5, 64))
        case 'wallZ':  return wallFootprint(center, 'z', safeLength(opts.wallLength, 5, 64))
        case 'box':    return [{ ...center }]
    }
}

export function isDragBrush(kind: BrushKind): boolean {
    return kind === 'box'
}

export function brushDragFootprint(kind: BrushKind, from: VoxelCoord, to: VoxelCoord, opts: BrushFootprintOptions = {}): VoxelCoord[] {
    switch (kind) {
        case 'box': return boxFootprint(from, to)
        default: return brushFootprint(kind, to, opts)
    }
}

function cubeFootprint(center: VoxelCoord, radius: number): VoxelCoord[] {
    const out: VoxelCoord[] = []
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
                out.push({ x: center.x + dx, y: center.y + dy, z: center.z + dz })
            }
        }
    }
    return out
}

function diskFootprint(center: VoxelCoord, radius: number): VoxelCoord[] {
    const out: VoxelCoord[] = []
    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            out.push({ x: center.x + dx, y: center.y, z: center.z + dz })
        }
    }
    return out
}

function columnFootprint(base: VoxelCoord, height: number): VoxelCoord[] {
    const out: VoxelCoord[] = []
    for (let dy = 0; dy < height; dy++) {
        out.push({ x: base.x, y: base.y + dy, z: base.z })
    }
    return out
}

function wallFootprint(center: VoxelCoord, axis: 'x' | 'z', length: number): VoxelCoord[] {
    const out: VoxelCoord[] = []
    const start = -Math.floor((length - 1) / 2)
    for (let i = 0; i < length; i++) {
        const offset = start + i
        out.push({
            x: axis === 'x' ? center.x + offset : center.x,
            y: center.y,
            z: axis === 'z' ? center.z + offset : center.z,
        })
    }
    return out
}

function boxFootprint(from: VoxelCoord, to: VoxelCoord): VoxelCoord[] {
    const minX = Math.min(from.x, to.x)
    const maxX = Math.max(from.x, to.x)
    const minY = Math.min(from.y, to.y)
    const maxY = Math.max(from.y, to.y)
    const minZ = Math.min(from.z, to.z)
    const maxZ = Math.max(from.z, to.z)
    const out: VoxelCoord[] = []
    for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
            for (let x = minX; x <= maxX; x++) {
                out.push({ x, y, z })
            }
        }
    }
    return out
}

function safeLength(value: unknown, fallback: number, max: number): number {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(1, Math.min(max, Math.floor(n)))
}

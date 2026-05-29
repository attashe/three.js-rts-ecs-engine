import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isRailBlock, type Palette } from '../../engine/voxel/palette'
import type { VoxelCoord } from '../../engine/ecs/world'

export const RailDirection = {
    North: 0,
    East: 1,
    South: 2,
    West: 3,
} as const

export type RailDirection = typeof RailDirection[keyof typeof RailDirection]

export const RAIL_DIRS: readonly RailDirection[] = [
    RailDirection.North,
    RailDirection.East,
    RailDirection.South,
    RailDirection.West,
]

export const RAIL_MASK = {
    north: 1 << RailDirection.North,
    east: 1 << RailDirection.East,
    south: 1 << RailDirection.South,
    west: 1 << RailDirection.West,
} as const

export type RailConnectionMask = number
export type RailSlopeDelta = -1 | 0 | 1

export interface RailNeighbor {
    dir: RailDirection
    cell: VoxelCoord
    dy: RailSlopeDelta
}

export type RailVariant =
    | 'isolated'
    | 'end'
    | 'straight'
    | 'corner'
    | 't'
    | 'cross'

export interface RailVariantInfo {
    variant: RailVariant
    /** Y-axis rotation in quarter-turns clockwise from north. */
    rotation: 0 | 1 | 2 | 3
}

export function directionOffset(dir: RailDirection): { dx: number; dz: number } {
    switch (dir) {
        case RailDirection.North: return { dx: 0, dz: -1 }
        case RailDirection.East: return { dx: 1, dz: 0 }
        case RailDirection.South: return { dx: 0, dz: 1 }
        case RailDirection.West: return { dx: -1, dz: 0 }
    }
}

export function oppositeDirection(dir: RailDirection): RailDirection {
    return ((dir + 2) & 3) as RailDirection
}

export function directionToNeighbor(from: VoxelCoord, to: VoxelCoord): RailDirection | null {
    const dx = to.x - from.x
    const dz = to.z - from.z
    if (dx === 0 && dz === -1) return RailDirection.North
    if (dx === 1 && dz === 0) return RailDirection.East
    if (dx === 0 && dz === 1) return RailDirection.South
    if (dx === -1 && dz === 0) return RailDirection.West
    return null
}

export function addDirection(cell: VoxelCoord, dir: RailDirection): VoxelCoord {
    const offset = directionOffset(dir)
    return { x: cell.x + offset.dx, y: cell.y, z: cell.z + offset.dz }
}

export function maskHas(mask: RailConnectionMask, dir: RailDirection): boolean {
    return (mask & (1 << dir)) !== 0
}

export function maskDirections(mask: RailConnectionMask): RailDirection[] {
    const out: RailDirection[] = []
    for (const dir of RAIL_DIRS) {
        if (maskHas(mask, dir)) out.push(dir)
    }
    return out
}

export function railConnectionMask(chunks: ChunkManager, x: number, y: number, z: number): RailConnectionMask {
    return railConnectionMaskFromGetter(
        chunks.palette,
        (wx, wy, wz) => chunks.getVoxel(wx, wy, wz),
        x,
        y,
        z,
    )
}

export function railConnectionMaskFromGetter(
    palette: Palette,
    getVoxel: (x: number, y: number, z: number) => number,
    x: number,
    y: number,
    z: number,
): RailConnectionMask {
    let mask = 0
    for (const dir of RAIL_DIRS) {
        if (railNeighborFromGetter(palette, getVoxel, { x, y, z }, dir)) {
            mask |= 1 << dir
        }
    }
    return mask
}

export function railNeighborCell(chunks: ChunkManager, cell: VoxelCoord, dir: RailDirection): RailNeighbor | null {
    return railNeighborFromGetter(
        chunks.palette,
        (x, y, z) => chunks.getVoxel(x, y, z),
        cell,
        dir,
    )
}

export function railNeighborFromGetter(
    palette: Palette,
    getVoxel: (x: number, y: number, z: number) => number,
    cell: VoxelCoord,
    dir: RailDirection,
): RailNeighbor | null {
    const offset = directionOffset(dir)
    // Same-height rails remain preferred. The +1/-1 fallback creates
    // terrain-following ramps without introducing dedicated slope blocks.
    for (const dy of [0, 1, -1] as const) {
        const x = cell.x + offset.dx
        const y = cell.y + dy
        const z = cell.z + offset.dz
        if (isRailBlock(palette, getVoxel(x, y, z))) {
            return { dir, cell: { x, y, z }, dy }
        }
    }
    return null
}

export function railVariantFromMask(mask: RailConnectionMask): RailVariantInfo {
    const count = popcount4(mask)
    if (count === 0) return { variant: 'isolated', rotation: 0 }
    if (count === 4) return { variant: 'cross', rotation: 0 }
    if (count === 1) {
        return { variant: 'end', rotation: firstDirection(mask) }
    }
    if (count === 3) {
        return { variant: 't', rotation: oppositeDirection(missingDirection(mask)) }
    }
    if (maskHas(mask, RailDirection.North) && maskHas(mask, RailDirection.South)) {
        return { variant: 'straight', rotation: 0 }
    }
    if (maskHas(mask, RailDirection.East) && maskHas(mask, RailDirection.West)) {
        return { variant: 'straight', rotation: 1 }
    }
    if (maskHas(mask, RailDirection.North) && maskHas(mask, RailDirection.East)) {
        return { variant: 'corner', rotation: 0 }
    }
    if (maskHas(mask, RailDirection.East) && maskHas(mask, RailDirection.South)) {
        return { variant: 'corner', rotation: 1 }
    }
    if (maskHas(mask, RailDirection.South) && maskHas(mask, RailDirection.West)) {
        return { variant: 'corner', rotation: 2 }
    }
    return { variant: 'corner', rotation: 3 }
}

export function chooseRailExit(mask: RailConnectionMask, travelDir: RailDirection): RailDirection | null {
    if (maskHas(mask, travelDir)) return travelDir
    const back = oppositeDirection(travelDir)
    const exits = maskDirections(mask).filter((dir) => dir !== back)
    return exits.length === 1 ? exits[0]! : null
}

function popcount4(mask: number): 0 | 1 | 2 | 3 | 4 {
    let n = 0
    for (let i = 0; i < 4; i++) {
        if ((mask & (1 << i)) !== 0) n++
    }
    return n as 0 | 1 | 2 | 3 | 4
}

function firstDirection(mask: RailConnectionMask): RailDirection {
    for (const dir of RAIL_DIRS) {
        if (maskHas(mask, dir)) return dir
    }
    return RailDirection.North
}

function missingDirection(mask: RailConnectionMask): RailDirection {
    for (const dir of RAIL_DIRS) {
        if (!maskHas(mask, dir)) return dir
    }
    return RailDirection.North
}

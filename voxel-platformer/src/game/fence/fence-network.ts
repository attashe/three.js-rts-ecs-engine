import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isFenceBlock, type Palette } from '../../engine/voxel/palette'

export const FenceDirection = {
    North: 0,
    East: 1,
    South: 2,
    West: 3,
} as const

export type FenceDirection = typeof FenceDirection[keyof typeof FenceDirection]
export type FenceConnectionMask = number

export const FENCE_DIRS: readonly FenceDirection[] = [
    FenceDirection.North,
    FenceDirection.East,
    FenceDirection.South,
    FenceDirection.West,
]

export const FENCE_MASK = {
    north: 1 << FenceDirection.North,
    east: 1 << FenceDirection.East,
    south: 1 << FenceDirection.South,
    west: 1 << FenceDirection.West,
} as const

export function fenceDirectionOffset(dir: FenceDirection): { dx: number; dz: number } {
    switch (dir) {
        case FenceDirection.North: return { dx: 0, dz: -1 }
        case FenceDirection.East: return { dx: 1, dz: 0 }
        case FenceDirection.South: return { dx: 0, dz: 1 }
        case FenceDirection.West: return { dx: -1, dz: 0 }
    }
}

export function fenceMaskHas(mask: FenceConnectionMask, dir: FenceDirection): boolean {
    return (mask & (1 << dir)) !== 0
}

export function fenceConnectionMask(chunks: ChunkManager, x: number, y: number, z: number): FenceConnectionMask {
    return fenceConnectionMaskFromGetter(
        chunks.palette,
        (wx, wy, wz) => chunks.getVoxel(wx, wy, wz),
        x,
        y,
        z,
    )
}

export function fenceConnectionMaskFromGetter(
    palette: Palette,
    getVoxel: (x: number, y: number, z: number) => number,
    x: number,
    y: number,
    z: number,
): FenceConnectionMask {
    let mask = 0
    for (const dir of FENCE_DIRS) {
        const offset = fenceDirectionOffset(dir)
        if (isFenceBlock(palette, getVoxel(x + offset.dx, y, z + offset.dz))) {
            mask |= 1 << dir
        }
    }
    return mask
}


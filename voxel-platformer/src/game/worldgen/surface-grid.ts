import { BLOCK } from '../../engine/voxel/palette'
import { WorldgenCompileContext, clamp, footprintBounds } from './compile-context'

export interface SurfaceGrid {
    readonly size: number
    readonly sizeY: number
    readonly height: Int16Array
    readonly material: Uint16Array
}

export function createSurfaceGrid(ctx: WorldgenCompileContext): SurfaceGrid {
    const count = ctx.sizeX * ctx.sizeZ
    return {
        size: ctx.sizeX,
        sizeY: ctx.sizeY,
        height: new Int16Array(count),
        material: new Uint16Array(count),
    }
}

export function surfaceY(grid: SurfaceGrid, x: number, z: number): number {
    const xx = clamp(Math.floor(x), 0, grid.size - 1)
    const zz = clamp(Math.floor(z), 0, grid.size - 1)
    return grid.height[surfaceIndex(grid, xx, zz)]!
}

export function surfaceBlock(grid: SurfaceGrid, x: number, z: number): number {
    const xx = clamp(Math.floor(x), 0, grid.size - 1)
    const zz = clamp(Math.floor(z), 0, grid.size - 1)
    return grid.material[surfaceIndex(grid, xx, zz)]!
}

export function setSurface(grid: SurfaceGrid, x: number, z: number, y: number, block: number): void {
    const idx = surfaceIndex(grid, x, z)
    grid.height[idx] = Math.round(y)
    grid.material[idx] = block
}

export function writeTerrainColumn(ctx: WorldgenCompileContext, grid: SurfaceGrid, x: number, z: number, topY: number, topBlock: number): void {
    const oldY = surfaceY(grid, x, z)
    const nextY = ctx.clampSurfaceY(topY)
    const soilY = Math.max(0, nextY - 1)
    const clearFrom = Math.max(oldY, nextY) + 1
    for (let y = clearFrom; y < ctx.sizeY; y += 1) ctx.setVoxel(x, y, z, BLOCK.air)
    for (let y = 0; y < nextY; y += 1) ctx.setVoxel(x, y, z, y === soilY ? BLOCK.dirt : BLOCK.stone)
    ctx.setVoxel(x, nextY, z, topBlock)
    setSurface(grid, x, z, nextY, topBlock)
}

export function sampleFootprint(ctx: WorldgenCompileContext, grid: SurfaceGrid, cx: number, cz: number, width: number, depth: number): {
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

export function slopeAt(grid: SurfaceGrid, x: number, z: number): number {
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

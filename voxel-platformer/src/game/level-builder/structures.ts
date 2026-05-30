import type { ChunkManager, VoxelEdit } from '../../engine/voxel/chunk-manager'
import {
    generateWallSegment,
    towerWallSocket,
    type StructureBounds,
    type StructureScale,
    type WallGateMode,
    type WallParams,
    type WallPathPoint,
    type WallStyle,
    type WallTerrainMode,
} from '../../procedural-structures'

export type CastleWallPoint = WallPathPoint | readonly [number, number, number]

export interface CastleWallOptions extends Partial<WallParams> {
    from: CastleWallPoint
    to: CastleWallPoint
    seed?: number | string
}

export interface CastleWallResult {
    bounds: StructureBounds
    edits: VoxelEdit[]
    voxelCount: number
}

export type {
    StructureScale,
    WallGateMode,
    WallParams,
    WallPathPoint,
    WallStyle,
    WallTerrainMode,
}

/**
 * Place a path-based castle wall directly into a procedural level. This is the
 * code-authoring counterpart to the editor's two-click wall tool: both routes
 * go through `generateWallSegment`, so standalone walls and tower-to-tower
 * walls keep the same dimensions, gates, battlements, and material logic.
 */
export function castleWall(chunks: ChunkManager, opts: CastleWallOptions): CastleWallResult {
    const { from, to, seed, ...params } = opts
    const result = generateWallSegment({
        path: [point(from), point(to)],
        params,
        seed,
    }, chunks.palette)
    const edits = result.voxels.map((v) => ({ x: v.x, y: v.y, z: v.z, value: v.block }))
    chunks.applyBulk(edits)
    return {
        bounds: result.bounds,
        edits,
        voxelCount: result.voxels.length,
    }
}

export { towerWallSocket }

function point(value: CastleWallPoint): WallPathPoint {
    if ('x' in value) return { x: value.x, y: value.y, z: value.z }
    return { x: value[0], y: value[1], z: value[2] }
}

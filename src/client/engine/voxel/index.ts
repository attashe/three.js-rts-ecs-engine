// Re-exports for the voxel subsystem. Most consumers should import from here
// rather than reaching into individual files.

export { CHUNK_DIM, Chunk, chunkKey } from './chunk'
export type { ChunkKey } from './chunk'

export { ChunkManager, worldToVoxel } from './chunk-manager'
export type { BulkEditResult, VoxelEdit } from './chunk-manager'

export { ChunkRenderer } from './chunk-renderer'

export { greedyMesh } from './greedy-mesher'
export type { MeshData, VoxelSampler } from './greedy-mesher'

export {
    AIR,
    BLOCK,
    DEFAULT_PALETTE,
    isCollidable,
    isPathSurface,
    isRaycastTarget,
    isSolid,
    occludesFaces,
    paletteEntry,
} from './palette'
export type { Palette, PaletteEntry } from './palette'

export { voxelRaycast } from './voxel-raycast'
export type { VoxelHit } from './voxel-raycast'

export { findPath } from './voxel-path'
export type { PathPoint, PathOptions } from './voxel-path'

export { voxelAABBOverlap, sweepAxis, isGrounded, aabbFromFoot } from './voxel-collide'
export type { AABB } from './voxel-collide'

export { deserializeLevel, serializeLevel } from './level-serializer'
export type { SerializedLevel } from './level-serializer'

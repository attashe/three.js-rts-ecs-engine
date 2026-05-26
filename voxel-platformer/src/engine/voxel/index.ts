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
    isRenderableVoxel,
    isPathSurface,
    isRaycastTarget,
    isSolid,
    occludesFaces,
    paletteEntry,
    voxelOpacity,
    voxelEmissive,
    voxelLightSpec,
    blockMovementTraits,
    clonePalette,
} from './palette'
export type { BlockLightSpec, BlockMovementTraits, Palette, PaletteEntry } from './palette'

export { createBlockLightSystem } from './block-light-system'
export type { BlockLightSystemOptions } from './block-light-system'

export {
    DEFAULT_MOVEMENT_ENVIRONMENT,
    movementEnvironmentForAABB,
} from './movement-effects'
export type { MovementEnvironment } from './movement-effects'

export { voxelRaycast } from './voxel-raycast'
export type { VoxelHit } from './voxel-raycast'

export { voxelAABBOverlap, sweepAxis, isGrounded, aabbFromFoot, aabbFromCenter } from './voxel-collide'
export type { AABB, ColliderAnchor, ObstacleSource } from './voxel-collide'

export { deserializeLevel, serializeLevel } from './level-serializer'
export type { SerializedLevel } from './level-serializer'

// Re-exports for the voxel subsystem. Most consumers should import from here
// rather than reaching into individual files.

export { CHUNK_DIM, Chunk, chunkKey } from './chunk'
export type { ChunkKey } from './chunk'

export { ChunkManager, worldToVoxel } from './chunk-manager'
export type { BulkEditResult, VoxelEdit } from './chunk-manager'

export { ChunkRenderer } from './chunk-renderer'

export { greedyMesh } from './greedy-mesher'
export type { MeshData, VoxelSampler } from './greedy-mesher'

export { liquidTopSurfaceMesh } from './liquid-surface-mesher'
export type { LiquidSurfaceMeshData, LiquidSurfaceMeshOptions } from './liquid-surface-mesher'

export {
    AIR,
    BLOCK,
    DEFAULT_PALETTE,
    isCollidable,
    isRenderableVoxel,
    isPathSurface,
    isRaycastTarget,
    isSolid,
    isFenceBlock,
    isLadderBlock,
    isTorchBlock,
    liquidBlockKind,
    occludesFaces,
    paletteEntry,
    paletteTileIndex,
    stepHeightForBlock,
    voxelHeightForBlock,
    voxelOpacity,
    voxelEmissive,
    voxelLightSpec,
    blockMovementTraits,
    fenceBlockIndex,
    ladderBlockIndex,
    appendMissingDefaultPaletteEntries,
    clonePalette,
} from './palette'
export type {
    BlockContactHazard,
    BlockLightSpec,
    BlockMovementTraits,
    LiquidBlockKind,
    Palette,
    PaletteEntry,
    ResolvedBlockMovementTraits,
} from './palette'

export {
    ATLAS_SIZE,
    TILE_INDEX,
    TILE_NAMES,
    TILE_SIZE,
    TILE_SLOT_COUNT,
    TILES_PER_ROW,
    TILE_UV_SIZE,
} from './atlas-manifest'
export type { TileName } from './atlas-manifest'
export { buildVoxelAtlas } from './atlas-builder'
export type { AtlasBuildResult } from './atlas-builder'

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

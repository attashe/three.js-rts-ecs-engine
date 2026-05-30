/**
 * Level builder - the authoring API for code-defined (procedural) levels.
 *
 * Two layers:
 *   - `terrain(chunks, { size, groundY })` - chainable voxel shapes
 *     (ground / fill / stairs / platform / etc.) + coord helpers.
 *   - `defineLevel(spec)` + `outdoorDay` + `zoneBox` / `interactZone` -
 *     LevelMeta defaults, ambient presets, and zone math.
 *
 * See `docs/procedural-levels.md` for the authoring guide and
 * `src/game/level.ts` for the canonical worked example.
 */

export { terrain, Terrain } from './terrain'
export type {
    TerrainFrame,
    GroundOptions,
    HeightfieldOptions,
    StairsOptions,
    PlatformOptions,
    MaskRaiseOptions,
    MaskLowerOptions,
    CarveOptions,
    PathOptions,
    PondOptions,
    Span,
    BlockOrFn,
    HeightOrFn,
    VoxelCoord,
} from './terrain'

export {
    circle,
    ellipse,
    rect,
    pathMask,
    anyMask,
    allMask,
    notMask,
    subtractMask,
    valueNoise2D,
    fbmNoise2D,
    noiseThreshold,
} from './masks'
export type { TerrainMask, TerrainPoint, TerrainValue, FbmNoiseOptions } from './masks'

export { defineLevel, outdoorDay, zoneBox, interactZone } from './meta'
export type { LevelSpec, InteractZoneSpec } from './meta'

export { castleWall, towerWallSocket } from './structures'
export type {
    CastleWallOptions,
    CastleWallPoint,
    CastleWallResult,
    StructureScale as CastleWallScale,
    WallGateMode as CastleWallGateMode,
    WallParams as CastleWallParams,
    WallPathPoint,
    WallStyle as CastleWallStyle,
    WallTerrainMode as CastleWallTerrainMode,
} from './structures'

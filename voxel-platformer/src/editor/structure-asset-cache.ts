import type { Palette } from '../engine/voxel/palette'
import {
    generateStructureAsset,
    prefabSource,
    proceduralSource,
    structureSourceKey,
    type StructureAsset,
    type StructureSource,
    type StructureTransform,
} from '../procedural-structures/asset'
import {
    generateWallSegment,
    normalizeWallParams,
    towerWallSocket,
    type PartialStructureGenerationOptions,
    type WallParams,
    type WallPathPoint,
} from '../procedural-structures'
import type { VoxelEdit } from '../engine/voxel/chunk-manager'
import type { EditorState } from './editor-state'

/**
 * Shared, single-entry cache for the structure asset the editor is
 * currently configured to place. The place system, the preview system,
 * and the Structures tab all read the *same* asset so the previewed
 * footprint, the stamped voxels, and the size readout can never drift.
 *
 * The asset is regenerated only when the source fingerprint changes
 * (kind / prefab / seed / structuralOnly) — rotation and anchor are
 * applied per-placement at the transform layer, so spinning the rotation
 * dial never pays a regeneration.
 */
export function structureSourceFromState(state: EditorState): StructureSource {
    return state.structureSourceKind === 'prefab'
        ? prefabSource(state.structurePrefabId)
        : proceduralSource(state.structureKind, state.structureSeed, structureOptionsFromState(state))
}

export function structureOptionsFromState(state: EditorState): PartialStructureGenerationOptions {
    return {
        detail: state.structureDetail,
        variation: state.structureVariation,
        cleanLoose: state.structureCleanLoose,
        tree: {
            style: state.structureTreeStyle,
            season: state.structureTreeSeason,
            trunkHeight: state.structureTreeTrunkHeight,
            trunkRadius: state.structureTreeTrunkRadius,
            crownRadius: state.structureTreeCrownRadius,
            branchDensity: state.structureTreeBranchDensity,
            leafNoise: state.structureTreeLeafNoise,
            fruitChance: state.structureTreeFruitChance,
        },
        house: {
            scale: state.structureHouseScale,
            style: state.structureHouseStyle,
            width: state.structureHouseWidth,
            depth: state.structureHouseDepth,
            floors: state.structureHouseFloors,
            floorHeight: state.structureHouseFloorHeight,
            roofStyle: state.structureHouseRoofStyle,
            sideWing: state.structureHouseSideWing,
            porch: state.structureHousePorch,
            chimney: state.structureHouseChimney,
        },
        landmark: {
            scale: state.structureKind === 'temple' ? 'troll' : state.structureLandmarkScale,
        },
        tower: {
            scale: state.structureTowerScale,
            style: state.structureTowerStyle,
            radius: state.structureTowerRadius,
            height: state.structureTowerHeight,
            wallThickness: state.structureTowerWallThickness,
            taper: state.structureTowerTaper,
            windowEvery: state.structureTowerWindowEvery,
            ruinAmount: state.structureTowerRuinAmount,
            spire: state.structureTowerSpire,
        },
        wall: wallParamsFromState(state),
    }
}

export function wallParamsFromState(state: EditorState): WallParams {
    return normalizeWallParams({
        scale: state.structureWallScale,
        style: state.structureWallStyle,
        length: state.structureWallLength,
        height: state.structureWallHeight,
        thickness: state.structureWallThickness,
        foundationDepth: state.structureWallFoundationDepth,
        battlements: state.structureWallBattlements,
        walkway: state.structureWallWalkway,
        gate: state.structureWallGate,
        terrainMode: state.structureWallTerrainMode,
        ruinAmount: state.structureWallRuinAmount,
    })
}

export function wallPlacementEditsFromState(
    state: EditorState,
    start: WallPathPoint,
    end: WallPathPoint,
): VoxelEdit[] {
    const [from, to] = wallEndpointsFromState(state, start, end)
    const result = generateWallSegment({
        path: [from, to],
        params: wallParamsFromState(state),
        seed: state.structureSeed,
    })
    return result.voxels.map((v) => ({ x: v.x, y: v.y, z: v.z, value: v.block }))
}

export function wallEndpointsFromState(
    state: EditorState,
    start: WallPathPoint,
    end: WallPathPoint,
): [WallPathPoint, WallPathPoint] {
    if (state.structureWallEndpointMode !== 'tower-socket') return [start, end]
    const radius = Math.max(1, Math.round(state.structureWallTowerRadius))
    return [
        towerWallSocket({ center: start, radius, toward: end }),
        towerWallSocket({ center: end, radius, toward: start }),
    ]
}

export function structureTransformFromState(
    state: EditorState,
    origin: { x: number; y: number; z: number },
): StructureTransform {
    return { origin, rotation: state.structureRotation, anchor: state.structureAnchor }
}

let cacheKey = ''
let cached: StructureAsset | null = null

/** Resolve (and memoise) the asset for the current editor configuration. */
export function resolveStructureAsset(state: EditorState, palette?: Palette): StructureAsset {
    const source = structureSourceFromState(state)
    const key = structureSourceKey(source, state.structureStructuralOnly)
    if (cached && key === cacheKey) return cached
    cached = generateStructureAsset(source, { structuralOnly: state.structureStructuralOnly, palette })
    cacheKey = key
    return cached
}

/** Key identifying the *visual* state of the preview — source plus rotation
 *  (anchor only shifts position, handled per-frame). */
export function structurePreviewKey(state: EditorState): string {
    return `${structureSourceKey(structureSourceFromState(state), state.structureStructuralOnly)}|r${state.structureRotation}`
}

export function wallPreviewKey(state: EditorState, start: WallPathPoint | null, end: WallPathPoint | null): string {
    const a = start ? `${start.x},${start.y},${start.z}` : 'none'
    const b = end ? `${end.x},${end.y},${end.z}` : 'none'
    return `wall:${JSON.stringify(wallParamsFromState(state))}:seed${state.structureSeed}:mode${state.structureWallEndpointMode}:r${state.structureWallTowerRadius}:${a}:${b}`
}

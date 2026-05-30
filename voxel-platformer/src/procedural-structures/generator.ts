import type { Palette } from '../engine/voxel/palette'
import type { PartialStructureGenerationOptions, StructureGenerationOptions, StructureGenerationResult, StructureKind } from './types'
import { boundsOf, VoxelBuffer } from './buffer'
import { composeHouse } from './house'
import { composeChurch, composeMarket, composeStable, composeTemple } from './landmarks'
import { makeRng, type Rng } from './math'
import { normalizeStructureOptions } from './options'
import { addTerrain, cleanupLooseVoxels, variantSpots } from './terrain'
import { composeTower } from './tower'
import { composeTree } from './tree'
import { composeWall } from './wall'

export type {
    HouseParams,
    HouseStyle,
    LandmarkParams,
    PartialStructureGenerationOptions,
    RoofStyle,
    StructureBounds,
    StructureGenerationOptions,
    StructureGenerationResult,
    StructureKind,
    StructureScale,
    StructureVoxel,
    TowerParams,
    TowerStyle,
    TreeParams,
    TreeSeason,
    TreeStyle,
    WallGateMode,
    WallParams,
    WallPath,
    WallPathPoint,
    WallStyle,
    WallTerrainMode,
} from './types'
export { STRUCTURE_MATERIALS } from './materials'
export { DEFAULT_STRUCTURE_OPTIONS, normalizeStructureOptions } from './options'
export { composeWallPath, generateWallSegment, normalizeWallParams, towerWallSocket, wallPathCells, wallPlacementEdits } from './wall'

type StructureComposer = (
    buf: VoxelBuffer,
    ox: number,
    oy: number,
    oz: number,
    opts: StructureGenerationOptions,
    rng: Rng,
) => void

const STRUCTURE_COMPOSERS: Record<StructureKind, StructureComposer> = {
    house: composeHouse,
    market: composeMarket,
    stable: composeStable,
    church: composeChurch,
    temple: composeTemple,
    tree: composeTree,
    tower: composeTower,
    wall: composeWall,
}

export function generateStructureScene(
    input: PartialStructureGenerationOptions = {},
    palette?: Palette,
): StructureGenerationResult {
    const opts = normalizeStructureOptions(input)
    const buf = new VoxelBuffer()
    const baseY = opts.showTerrain ? 1 : 0

    if (opts.showTerrain) addTerrain(buf, opts)

    for (const spot of variantSpots(opts)) {
        const local = makeRng(String(opts.seed) + ':' + spot.i + ':' + opts.kind)
        STRUCTURE_COMPOSERS[opts.kind](buf, spot.x, baseY, spot.z, opts, local)
    }

    if (opts.cleanLoose) cleanupLooseVoxels(buf)

    const voxels = buf.toArray()
    const materialCounts: Record<number, number> = {}
    for (const v of voxels) materialCounts[v.block] = (materialCounts[v.block] ?? 0) + 1

    const materialNames: Record<number, string> = {}
    for (const index of Object.keys(materialCounts)) {
        const block = Number(index)
        materialNames[block] = palette?.entries[block]?.name ?? 'block ' + block
    }

    return {
        voxels,
        removed: buf.removed,
        bounds: boundsOf(voxels),
        materialCounts,
        materialNames,
    }
}

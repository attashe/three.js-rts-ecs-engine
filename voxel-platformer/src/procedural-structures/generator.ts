import type { Palette } from '../engine/voxel/palette'
import type { PartialStructureGenerationOptions, StructureGenerationOptions, StructureGenerationResult, StructureKind } from './types'
import { boundsOf, VoxelBuffer } from './buffer'
import { composeHouse } from './house'
import { makeRng, type Rng } from './math'
import { normalizeStructureOptions } from './options'
import { addTerrain, cleanupLooseVoxels, variantSpots } from './terrain'
import { composeTower } from './tower'
import { composeTree } from './tree'

export type {
    HouseParams,
    HouseStyle,
    PartialStructureGenerationOptions,
    RoofStyle,
    StructureBounds,
    StructureGenerationOptions,
    StructureGenerationResult,
    StructureKind,
    StructureVoxel,
    TowerParams,
    TowerStyle,
    TreeParams,
    TreeStyle,
} from './types'
export { STRUCTURE_MATERIALS } from './materials'
export { DEFAULT_STRUCTURE_OPTIONS, normalizeStructureOptions } from './options'

type ConcreteStructureKind = Exclude<StructureKind, 'mixed'>
type StructureComposer = (
    buf: VoxelBuffer,
    ox: number,
    oy: number,
    oz: number,
    opts: StructureGenerationOptions,
    rng: Rng,
) => void

const STRUCTURE_KIND_SEQUENCE: readonly ConcreteStructureKind[] = ['house', 'tree', 'tower']
const STRUCTURE_COMPOSERS: Record<ConcreteStructureKind, StructureComposer> = {
    house: composeHouse,
    tree: composeTree,
    tower: composeTower,
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
        const kind = resolveStructureKind(opts.kind, spot.i)
        STRUCTURE_COMPOSERS[kind](buf, spot.x, baseY, spot.z, opts, local)
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

function resolveStructureKind(kind: StructureKind, variantIndex: number): ConcreteStructureKind {
    return kind === 'mixed'
        ? STRUCTURE_KIND_SEQUENCE[variantIndex % STRUCTURE_KIND_SEQUENCE.length]!
        : kind
}

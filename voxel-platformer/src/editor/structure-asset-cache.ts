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
        : proceduralSource(state.structureKind, state.structureSeed)
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

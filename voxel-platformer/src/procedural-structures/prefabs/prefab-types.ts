import type { VoxelBuffer } from '../buffer'

/**
 * A hand-authored, deterministic structure. Unlike the procedural
 * generators (tree/house/tower) a prefab has no seed or parameters — it
 * stamps the exact same voxels every time, which makes it ideal for
 * gameplay set-pieces the designer needs to reason about precisely
 * (portal gates, wells, shrines, ...).
 *
 * Authoring convention: build with the structure's *base resting on
 * `y = 0`* and roughly centred on `x = 0, z = 0`. The asset layer
 * re-normalises the result to a min-corner-at-origin local space, so
 * exact centring isn't required — but keeping prefabs centred keeps the
 * editor preview and rotation pivot intuitive.
 */
export interface StructurePrefab {
    /** Stable id used by `StructureSource` and save data. Never rename. */
    id: string
    /** Human-readable name shown in the editor dropdown. */
    label: string
    /** One-line description surfaced as a tooltip / hint. */
    description: string
    /** Paint the prefab's voxels into `buf`. */
    build(buf: VoxelBuffer): void
}

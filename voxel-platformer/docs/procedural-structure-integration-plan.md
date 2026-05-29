# Procedural Structure Integration Plan

Planning note. Most of this is now implemented; the remaining open item is the
decorative → prop migration (see the last section).

## Status

Implemented:

- **Structure asset layer** (`src/procedural-structures/asset.ts`): a single,
  deterministic, origin-normalised asset with exact `bounds`, `footprint`,
  `size`, and stats. Sources are either `procedural` (seeded tree/house/tower/
  mixed, single structure, no terrain) or `prefab`.
- **Prefab registry** (`src/procedural-structures/prefabs/`): portal gate
  (headline), campfire, well, banner arch. Add a prefab by authoring a module
  and listing it in `prefabs/index.ts`.
- **Transform + placement API**: 90° Y-rotations, `bottom-center` / `center` /
  `min-corner` anchors, `measureStructurePlacement` (world AABB without writing),
  `structurePlacementEdits`, and `placeStructureAsset` (returns before/after
  edits for one-step undo).
- **Editor integration**: a `place-structure` mode, a **Structures** tab
  (source + seed + rotation + anchor + live size readout), a 3D preview system
  (voxel ghost + bounding-box wireframe following the cursor), and a place
  system that bakes the structure into the level as one undoable bulk edit.
  Because structures bake to voxels they round-trip through save/load and the
  runtime with no extra machinery.
- **`structuralOnly`** option strips purely decorative voxels for a predictable
  footprint.

Tests: `tests/procedural-structure-asset.test.ts` (determinism, rotation
footprints, measure-matches-stamp, anchors, prefab bounds, undo edits).

## Goals

- Reuse the procedural structure generator for editor placement instead of duplicating structure logic.
- Let the editor preview exact structure size before placement.
- Keep voxel structures predictable in footprint, height, anchor, and rotation.
- Leave decorative plants, fruit, and mushrooms as a later migration to the prop system.

## Structure Asset API

Introduce a small structure asset layer around the current generator:

- `generateStructureAsset(options)` returns a cached structure asset with `voxels`, future `props`, exact `bounds`, XZ `footprint`, `anchor`, and stats.
- `measureStructureAsset(asset, transform)` returns transformed bounds and footprint without writing anything to the level.
- `placeStructureAsset(chunks, asset, transform)` stamps the cached voxels and props into the current level.

The default anchor should be bottom center. Structure rotations should be limited to 90 degree Y-axis steps so voxel coordinates stay aligned and predictable.

## Editor Placement

- Show a wireframe AABB and footprint before placement.
- Optionally render a translucent ghost preview from the cached asset.
- Validate collision/occupancy before committing placement.
- Show width, depth, height, and estimated block count in the editor UI.
- Recompute preview only when generator options, seed, rotation, or anchor changes.

## Decorative Migration

The demo generator may keep fruit, flowers, and mushrooms for now. During game integration, split output into:

- Structural voxels: houses, towers, trunks, branches, roofs, walls, terrain-compatible details.
- Props: flowers, mushrooms, fruit, small signs, crates, and other decorative repeatables.

Props should be placed through the existing prop/scatter pipeline so they can use models, instancing, and prop-specific editor controls.

## Tests

- Generator determinism for identical options.
- Bounds and footprint are stable for a fixed seed.
- `measureStructureAsset` matches actual `placeStructureAsset` output.
- Rotated footprints remain correct for 90, 180, and 270 degrees.
- Placement validation rejects occupied cells and accepts empty terrain.

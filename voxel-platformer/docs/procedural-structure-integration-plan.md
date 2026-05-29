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

## Decorative Migration — implemented

Ground plantings are no longer flat cubes in stamped levels. When an asset is
built with `structuralOnly: true`, the generator now:

- Strips the decorative voxels from `asset.voxels` as before (predictable
  structural footprint), and
- Re-emits the ground plantings (generator tags `ground-detail` / `garden-plant`,
  blocks `flower` / `mushroom`) as `asset.decorationProps` — prop placements in
  the asset's normalised local frame. Each planting picks a `flower(-2/-3)` or
  `mushroom(-2/-3)` variant, yaw, and scale hashed from its cell, so the choice
  is deterministic. The matching cap voxel (a mushroom's `fruit` top) is ignored
  — one prop per stem. Tree fruit and chimney smoke just drop.

`structurePropPlacements(asset, transform, idPrefix)` is the prop-mesh
counterpart to `structurePlacementEdits`: it resolves those local plantings to
world-space `EditorProp`s (centre of the cell, foot on the floor, transform
rotation applied, stable ids from `idPrefix` + local cell). Levels stamp the
structural voxels and feed the returned props straight into `LevelMeta.props`,
so they render through the instanced prop pipeline with real models.

The Large Town generator uses this: every plot's house garden now shows real
flower meshes along the verge instead of flat voxels. Assets stamped *with*
their decoration still as voxels (`structuralOnly` false) return no props, so
plantings are never doubled.

## Tests

- Generator determinism for identical options.
- Bounds and footprint are stable for a fixed seed.
- `measureStructureAsset` matches actual `placeStructureAsset` output.
- Rotated footprints remain correct for 90, 180, and 270 degrees.
- Placement validation rejects occupied cells and accepts empty terrain.

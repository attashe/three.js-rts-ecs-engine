# Editor Terrain Tools

Large streamed locations are still stored as ordinary voxels, but the editor
now has terrain-focused brushes that operate on X/Z columns instead of single
cells.

## Tools

- **Sculpt**: LMB raises terrain, RMB lowers terrain.
- **Flatten**: moves columns toward `Target Y`.
- **Smooth**: averages each column with nearby terrain columns.
- **Ramp**: drag the X/Z direction and length; the slope starts at the
  first-click terrain height and ends at `Target Y`. The edit is committed on
  mouse release.
- **Paint**: paints only the top terrain voxel with the active palette block.

## Performance Rules

- Terrain strokes only scan and write columns inside the brush footprint.
- Every stamp uses `ChunkManager.applyBulk`; every mouse stroke becomes one
  undo command.
- The terrain preview draws lightweight surface outlines instead of per-voxel
  boxes, so large brush radii stay usable with mesh streaming enabled.
- `Min Y` / `Max Y` bound the surface search and prevent roofs or bridges far
  above the editing area from being mistaken for ground.

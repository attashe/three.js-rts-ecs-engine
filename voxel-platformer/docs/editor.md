# Voxel Platformer — Editor roadmap

A separate `editor.html` entry that shares the engine + voxel module with the
game. The editor lets you sculpt voxel terrain, save it to disk, load it
back, and place pickable objects.

This document tracks the staged plan. Each stage is a separate commit so the
delta is reviewable.

---

## Stage 1 — Editor foundation + voxel paint + save/load *(landed)*

- New `editor.html` + `src/editor.ts` entry. Multi-input Vite config.
- Reuses `Engine`, `Renderer`, `IsoCamera`, `ChunkManager`, `ChunkRenderer`,
  the voxel module, `metrics`, `pushLog`, the debug overlay system.
- New editor-only ECS systems:
  - `editor-camera-system` — WASD pan, Q/R rotate, wheel zoom. No follow
    target, free-fly over the level.
  - `voxel-cursor-system` (render-side) — raycasts the mouse pointer into
    voxel space and draws a translucent box at every cell the current
    brush will affect.
  - `voxel-paint-system` (fixed-side, input-driven) — LMB paints with the
    active block, RMB erases (AIR). Uses `chunks.applyBulk` so the
    renderer remeshes once per stroke.
- DOM UI panel (vanilla, mounted by `editor.ts`):
  - Palette swatches generated from `DEFAULT_PALETTE.entries`.
  - Brush selector (5 brushes — see below).
  - Mode toggle (Paint / Erase). LMB == paint, RMB == erase regardless.
  - Save / Load buttons (binary serialization via `level-serializer`).
- Brushes:
  - `single` — 1 voxel at cursor
  - `cube3` — 3×3×3 cube centered on cursor (27 voxels)
  - `cube5` — 5×5×5 cube centered on cursor (125 voxels)
  - `disk3` — flat 3×3 disk in XZ at cursor's Y (9 voxels)
  - `disk5` — flat 5×5 disk in XZ at cursor's Y (25 voxels)
- Pure brush-footprint helper in `editor/brush.ts`, unit-tested.

## Stage 2 — Pickup spawning *(landed)*

- Editor `mode` gains `'spawn-pickup'`. Click-to-place adds a pickup
  metadata entry to `editorState.pickups` and instantiates a preview
  entity in the editor world so the iso view shows it.
- UI panel: pickup kind dropdown (`gold` for v0), amount slider, "place"
  shortcut hint, a list of placed pickups with per-entry delete buttons.
- Level metadata persisted with the binary level file. `serializeLevel`
  accepts arbitrary JSON in its metadata slot; the editor serializes
  `{ name, spawn, pickups }` and the game-side loader reads it.
- The game's `client.ts` gets a `?level=…` URL hook later that lets the
  player load an editor-built level. Not in this stage — for now the
  editor round-trips through itself.

## Stage 3 — Chunk management *(planned)*

Per the latest design call, chunk management for v0 is **"extend the level
by attaching a new chunk to one of the cardinal sides of an existing
chunk"**. No region-move tool yet.

- UI: a small chunk-grid panel showing live chunks (`cx, cy, cz`). Each
  cell exposes "+N", "+S", "+E", "+W" buttons that create an empty
  neighbour chunk in that direction (and "+Up", "+Down" for vertical).
- Existing `ChunkManager.getOrCreate` already supports this — a created
  chunk auto-marks dirty so the renderer picks it up next frame.
- Delete is "mass-erase every voxel in a chunk" (no chunk-disposal in the
  manager API yet; deletion just sets all 32³ voxels to AIR).

## Stage 4+ — Future work *(not scheduled)*

These came up during the staging discussion. Tracked here so they don't
get lost.

### Top-down camera with cut-plane editing

The current iso camera obscures cells underneath the brush footprint. A
top-down orthographic mode would make voxel-grid alignment obvious. Pair
it with a "Y cut plane" slider that hides any voxel above the current
editing layer so you can precisely paint a specific height level (e.g.
build a staircase one floor at a time without the upper floors blocking
the view).

Implementation sketch:
- Toggle in the editor UI between iso (default) and top-down.
- Top-down rebuilds the camera at a fixed +Y position, looking straight
  down, orthographic.
- Cut plane: a render-side filter on `ChunkRenderer` that culls quads
  whose Y > cut. Cheapest approach: a per-frame uniform consumed by the
  voxel material, discarding fragments above the cut. Alternative: rebuild
  the meshes with the upper voxels masked.

### Region selection + move/copy/rotate

For more advanced workflows: select an AABB region, drag to move, optional
rotate around the Y axis, copy/paste. Layered on top of Stage 3 once the
basic chunk-extension flow is in.

### Stones + pistons in the editor

Today only coin pickups can be placed. Once Stage 2 lands, extend the
pickup placement to support:
- Falling stone spawners (place an emitter point + tier).
- Pistons (click `from` cell, click `to` cell, choose block + interval +
  characterPolicy).

### Undo/redo

Sketch a command pattern on top of `chunks.withBulkEdit`. Every paint
stroke and every pickup placement becomes a reversible command pushed on
a stack. Ctrl+Z / Ctrl+Y to walk. Not blocking for v0 but quickly painful
to live without.

### Game-side level loading

Wire the game's `client.ts` to read a `?level=<base64-binary>` URL param
or a saved file from `localStorage`, so the player can step into an
editor-built level without rebuilding. Minimal layer over `deserializeLevel`.

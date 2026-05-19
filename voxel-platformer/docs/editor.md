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

## Stage 2.5 — Working plane + piston placement *(landed)*

Two additions on top of the Stage 2 foundation, both driven by the same
editor panel:

### Working plane (Y row)

- `editorState.workingPlaneY` — integer Y row used as the placement Y when
  the mouse ray doesn't hit a voxel (replaces the previous spawn-Y fallback)
  and, when `planeLock` is on, *overrides* voxel hits so you can paint a
  specific layer through existing geometry.
- `working-plane-system` (render-side) draws a `THREE.GridHelper` at
  `workingPlaneY`, recentred on the camera target every frame. Colour
  switches from muted blue to amber when `planeLock` is on — instant visual
  confirmation that clicks will snap to the plane.
- Controls:
  - UI: ± buttons, number input, **Lock cursor to plane** checkbox.
  - Keyboard: **PageUp / PageDown** = ±1, hold **Shift** for ±4.

### Piston placement mode

- New editor mode `'place-piston'`. Selecting it makes LMB drop a piston
  whose `from` = clicked cell and `to` = `from + direction × distance`. The
  block, delay and characterPolicy come from the editor panel.
- `editor/piston-direction.ts` — pure helper, unit-tested. Defines the six
  cardinal directions (N/-Z, S/+Z, E/+X, W/-X, Up/+Y, Down/-Y) and the
  `pistonOffset(dir, distance)` → voxel offset translation.
- `piston-place-system` registers the piston via
  `registerPistonMechanism` (which seeds the initial cell so the platform
  has something for the player to stand on / be carried by). RMB pops the
  last piston, clearing both its `from` and `to` cells.
- UI section:
  - 6 direction buttons (active highlighted).
  - Distance number input (1–8).
  - Delay (seconds waited at endpoints) number input.
  - Travel (seconds spent moving between endpoints) number input.
  - Push / Block policy radio.
  - Live list of placed pistons, one row each.
- `voxel-cursor-system` previews the placement while the cursor is over a
  cell: shows the source cell *and* the target cell. Ghost block tinted
  gold for piston mode so it doesn't get confused with the paint preview.
- Save/Load round-trips pistons through the level metadata (the existing
  binary serializer's JSON slot).

## Stage 2.6 — Spawn placement, piston direction arrows, playtest *(landed)*

Three pieces tied together so a user can author and immediately try a level:

### Spawn placement

- New editor mode `'place-spawn'` with a dedicated "Spawn" button in the
  Mode row.
- `spawn-place-system` (fixed-side): LMB in spawn mode sets
  `editorState.spawn` to the cursor cell (centred on X/Z, sitting on top of
  the clicked surface). Already round-trips through `toLevelMeta`, so save /
  load preserve it.
- `spawn-marker-system` (render-side): a persistent overlay group at
  `editorState.spawn` — translucent player-sized column + a small upward
  cone — so the user always sees where they'll appear in playtest. Cyan to
  distinguish it from pickups (sky-blue).

### Piston direction arrows

- `piston-marker-system` (render-side): pools `ArrowHelper`s and binds one
  per placed piston, drawing a yellow arrow from `from` cell centre to `to`
  cell centre. Updates count + transforms each frame so RMB-undo and
  per-row deletes show up live.
- The arrows render with depthTest enabled but renderOrder = 995 so they
  stay visible through translucent overlays.

### Playtest

- "Playtest" button on the editor's Level section. Click → serialize
  current chunks + metadata via `level-serializer`, base64-encode into
  `sessionStorage` under `vp:playtest-level`, then navigate to
  `index.html?level=playtest`. sessionStorage (not localStorage) so the
  snapshot dies with the tab.
- `client.ts` checks `URLSearchParams.get('level') === 'playtest'` and, if
  present, deserializes the saved level into the runtime `ChunkManager` and
  builds a `LevelMeta` via `levelMetaFromEditor`. Falls back to the
  procedural demo level when the snapshot is missing / corrupt, so the
  game URL still works standalone.
- `level-from-meta.ts` translates the editor's metadata into the runtime
  shape (pickups → coinPiles, pistons → PistonMechanismConfig). No stone
  spawners — the editor doesn't expose those yet.
- A tiny fixed "← Editor" link is overlaid in the top-right corner when
  playtest mode is active, so the user can bounce back to the editor in
  one click.

## Stage 2.7 — Zone placement *(landed)*

Ported the parent codebase's `AiZone` concept down to a generic 3-D AABB
**Zone** (id, kind, optional label, `min`/`max` in world cells). Zones are
saved metadata plus a runtime registry on `world.zones`; gameplay systems
can call `isPointInZone` / `findZoneAtPoint` / `sampleZonePoint`, and
`kind: "trigger"` zones can now emit activation events.

Editor surface:
- New mode **Zone**. LMB drops a zone of `XZ size × Y height` cells centred
  on the cursor at the working plane Y. RMB pops the last placed zone.
- UI section "Zone (active in Zone mode)": kind tag (free-form string),
  optional label, XZ size, Y height, trigger source (player, arrow, or
  both), and a live list of placed zones with a per-row "remove" button.
- `zone-render-system` draws a magenta wireframe box per zone (depth-test
  off, render order 998) so it floats over the scene without being
  hidden by voxels.
- `voxel-cursor-system` previews the would-be XZ footprint as outlines on
  the working plane so the user can see what they're about to drop.

Round-trips via the same save/load path as everything else:
- `EditorLevelMeta.zones?` carries the array.
- `levelMetaFromEditor` translates it to runtime `Zone[]` on `LevelMeta`.
- `client.ts` calls `defineZone(world, …)` for each on load.
- `zone-trigger-system` emits `world.zoneEvents[]` when an allowed source
  collides with a trigger zone. Player triggers fire on enter; arrow
  triggers fire once per arrow/zone and use a swept segment for fast arrows.
- Trigger zones may carry `script.actions[]`. The first supported actions
  are `message`, `kill-player`, `set-block`, and `fill-blocks`; editor UI
  exposes message, kill, spawn-one-block, and erase-one-block actions for
  newly placed zones.

Tests cover the inclusive-min / exclusive-max AABB rule, deterministic
`sampleZonePoint`, trigger source filtering, player enter activation,
swept arrow activation, and the starter trigger-script actions.

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

### Stones in the editor

Pistons landed in Stage 2.5. Still TODO: falling stone spawners (place an
emitter point + tier).

### Undo/redo

Sketch a command pattern on top of `chunks.withBulkEdit`. Every paint
stroke and every pickup placement becomes a reversible command pushed on
a stack. Ctrl+Z / Ctrl+Y to walk. Not blocking for v0 but quickly painful
to live without.

### Game-side level loading

Wire the game's `client.ts` to read a `?level=<base64-binary>` URL param
or a saved file from `localStorage`, so the player can step into an
editor-built level without rebuilding. Minimal layer over `deserializeLevel`.

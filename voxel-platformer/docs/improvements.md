# Voxel Platformer — Improvement Backlog

Running list of ideas for where the codebase could grow next. Grouped by
area, sized **small** (a few hours) / **medium** (a day or two) /
**large** (a week+). Each entry has a *What*, *Why*, *How* sketch, and
notes on the bits of the codebase it would touch — so each idea can be
picked up by a fresh session without re-investigating context.

The list is intentionally aspirational; nothing here is committed work.
Treat it as a menu for the next planning conversation.

---

## Editor UX

### Undo / redo stack — **small** (top priority)

**What.** A bounded history of edits with `Ctrl+Z` / `Ctrl+Y` to walk it.

**Why.** Today only piston placement has an explicit RMB-pop undo. Paint
strokes, erases, pickup placements, zone removals, "New level", and the
per-row delete buttons in the Edit tab have no recovery path. Every
serious editing tool ships undo on day one; ours doesn't, and the user
hits it constantly.

**How sketch.**
- A `CommandStack` module owning an array of `Command` records, each with
  `apply(world, chunks, state)` and `revert(world, chunks, state)`.
- Every placement / removal system (`voxel-paint-system`,
  `piston-place-system`, `pickup-spawn-system`, `zone-place-system`,
  `spawn-place-system`) pushes a command on the stack instead of
  mutating state directly.
- `ChunkManager` already has a `applyBulk` primitive — capture the
  before/after voxel values per bulk edit so revert is one bulk write.
- Per-piston / per-pickup / per-zone undo records hold the metadata
  needed to re-instantiate the entity (eid is unstable across redo).
- Cap the stack at ~200 entries to keep memory bounded.

**Files touched.** Roughly: a new `editor/history.ts`, every `*-place-system`,
`save-load.ts` (clear the stack on load/new), `editor-ui` (a small Edit-tab
indicator of undo depth).

**Risks.** Coordinating with the per-row-remove buttons; testing requires
exhaustive coverage of every edit kind.

---

### Pick-block hotkey — **small**

**What.** `B` (or middle-click) on a non-air cell sets the editor's
`activeBlock` to that cell's palette index.

**Why.** Right now matching colour to existing terrain means scrolling
back to the palette swatches and counting. With pick-block the entire
"copy this terrain's style" workflow becomes one keypress.

**How sketch.** Wire into the existing voxel cursor — when the user's ray
hits a non-air cell and the input system reports `B` pressed (or `mouse
button 1`), read the voxel and write `state.activeBlock`. The Edit
tab's palette section already mirrors `activeBlock` into the active swatch
highlight; refresh picks it up automatically.

**Files touched.** `editor/systems/voxel-cursor-system.ts`, new bit of
input handling in `editor/systems/voxel-paint-system.ts` or a tiny new
system.

---

### Palette numeric shortcuts — **small**

**What.** `1`–`9` jump to the first nine palette entries.

**Why.** Same motivation as pick-block: less mouse, more keyboard.

**How sketch.** Hook keypresses in the editor's input loop. The numeric
keys aren't bound to anything else in the editor today.

**Files touched.** Tiny addition to whichever editor system reads the
keyboard for hotkeys (currently `working-plane-system.ts` does `V`/`L`/
`X`/`Z` so it's a natural fit), plus the Help tab's reference card.

---

### Mode-temp toggles — **small**

**What.** Hold `Shift` while in Paint mode → temporarily switch to Erase
until Shift is released. Hold `Alt` to temporarily switch to pick-block.

**Why.** Painting + erasing in the same stroke is constant. Mode switching
is a click each time today.

**How sketch.** `voxel-paint-system` already gates on
`editorState.mode === 'paint' || 'erase'`. Add a "temp override" check:
when in Paint and `Shift` is held, behave as if Erase. No state changes
to the `mode` field — purely an input override.

**Files touched.** `editor/systems/voxel-paint-system.ts`.

---

### Camera pan-to-item — **medium**

**What.** Clicking a row in the placed-pistons / zones / pickups lists
in the Edit tab centres the iso camera on that item.

**Why.** As levels grow, the lists become the easiest way to navigate.
Without pan-to-item, you can see "there's a piston at (47, 12, 19)" but
have to manually fly there.

**How sketch.** Each list row gets `onclick`: compute the item's centre
(piston: midpoint of from/to; zone: AABB centre; pickup: position;
spawn: spawn). Tween `iso.target` over ~250 ms. Pause edge-pan during the
tween so user input doesn't fight the animation.

**Files touched.** `editor/ui/edit-tab.ts` (each panel that has a list),
maybe a small `editor/camera-focus.ts` helper.

**Risks.** Animation interrupting user pan — handle interruption by
cancelling the tween on input.

---

### Box / line / sphere brushes — **medium**

**What.** Drag-to-define-rectangle filled with active block, single-line
brush (Bresenham 3D between click + release), spherical brush.

**Why.** Real level building needs more than 1/3/5/disk. Building walls,
floors, columns, and ramps is tedious one cell at a time.

**How sketch.** Click captures `from` cell; release captures `to` cell;
`brushFootprint` extends to accept these shapes (it's already pure-fn +
unit-tested, perfect surface to grow). Cursor preview already supports
arbitrary cells; just feed it the box/line cells while the user drags.

**Files touched.** `editor/brush.ts` + tests, `voxel-paint-system`
(track drag state), `voxel-cursor-system` (preview the drag rectangle).

**Risks.** Distinguishing "drag-to-paint-line" from "click-to-paint-and-
release" in a way that doesn't kill single-cell painting flow. Probably:
hold Shift + drag = box; otherwise single-cell.

---

### Copy / paste region — **medium**

**What.** A `Selection` mode: drag an AABB → copy → click to paste at
cursor.

**Why.** Repeating sections (staircases, columns, decorative motifs) is
the most common authoring complaint and the one undo / fill tools don't
solve.

**How sketch.** The zone system already gives you AABB selection
geometrically. Add a `'copy-paste'` editor mode that overlays a selection
AABB (cyan, distinct from zones' magenta). Copy reads cells inside the
AABB into a `{cells: Map<key, blockIndex>, size: VoxelCoord}` buffer.
Paste at cursor writes via `chunks.applyBulk`. Optional: rotate around Y
with `R`, mirror with `M`.

**Files touched.** New `editor/systems/copy-paste-system.ts`, mode
entry in `editor-state`, UI panel for the buffer.

---

### Mirror / symmetry brush — **medium**

**What.** When enabled, every paint stroke gets a mirrored counterpart
across an X or Z plane (or both).

**Why.** Symmetric arenas and bridges feel like the natural payoff for
having a working plane and a copy buffer; same principle.

**How sketch.** Editor state grows `mirrorAxis: 'none' | 'x' | 'z' | 'xz'`
and `mirrorPivot: number`. `voxel-paint-system` writes the brush cells
twice per click (or 4× for `xz`), mirrored about the pivot.

**Files touched.** `editor-state.ts`, `voxel-paint-system.ts`, a small
UI block in the Edit tab.

---

### Multi-cell platform abstraction — **medium-large**

**What.** A first-class "platform" object that owns N pistons moving in
lockstep. Today a 2 × 4 platform is 8 separate piston entries.

**Why.** Two reasons converge: (1) the UI gets unwieldy with 8 list rows
per logical platform; (2) the multi-piston synchronisation bug
(`Apply each piston's player push at most once per tick`) only exists
because we represent platforms as N independent pistons. A single
`Platform` with N cells means one push per platform, one schedule, one
remove operation.

**How sketch.** New `EditorPlatform` data: shape (cell AABB), motion
config (direction, delay, travel, policy), block. Editor placement is
drag-to-define-rect plus motion settings. Save-load serialises platforms
separately from pistons; pistons stay for backwards compatibility.
Piston-system grows a `Platform` branch.

**Files touched.** Substantial — `editor-state`, `mechanisms`, `piston-system`,
new place / render systems, save-load, UI.

**Risks.** Coexisting with the existing piston feature; load-time
backwards compat with old levels.

---

### Per-zone live preview of script effects — **medium**

**What.** When a zone has a `set-block` / `fill-blocks` script, render
faint markers at the cells the script will touch.

**Why.** Zone script offsets are relative to `zone-min` / `zone-max`,
which is confusing — the user has to mentally compute the absolute cell
they're setting. A live preview removes that calculation step.

**How sketch.** Extend `zone-render-system` to read every zone's script
actions, compute resolved coords (same logic as the runtime), and emit a
small marker mesh per `set-block` action. Different colour per action
type (cyan for set, red for kill, etc).

**Files touched.** `editor/systems/zone-render-system.ts`.

---

### Selection tool — **large**

**What.** A dedicated `'select'` mode that lets you click placed pistons
/ zones / pickups / spawn to inspect and edit them in-panel. Hover shows
an outline; click pins the selection.

**Why.** Currently each item type has its own panel (Edit tab swaps
based on the placement mode you're in). For *editing* an already-placed
item you have to find it in a list — there's no spatial selection.

**How sketch.** New `editor/systems/selection-system.ts` casts a ray on
LMB and finds the first item whose AABB the ray intersects. Sets
`state.selectedId` (typed `'piston:N' | 'zone:N' | 'pickup:N' | 'spawn'`).
Edit tab grows a Properties panel that mirrors the selected item.

**Files touched.** Many — new system, editor-state, all per-mode panels
in `edit-tab.ts` grow an edit-existing-item path, render systems get
hover-outline.

**Risks.** Big UI rework; benefit only appears once the codebase has
enough placed items per level to feel "buried".

---

### In-editor playtest without round-trip — **large**

**What.** Toggle "play" inside the editor — swap the editor's systems
for the gameplay systems on the same world, then toggle back.

**Why.** Today's Playtest navigates to `index.html?level=playtest` via a
session-storage round-trip — about a 1-second loading hop and a full
state reset. With in-editor playtest the iteration loop becomes much
tighter: jump into the level, test the bug, fall, edit immediately.

**How sketch.** Two engine sub-graphs. Editor systems and game systems
live as named arrays; `engine.replaceSystems(graph)` swaps them.
Player + pickups + pistons are spawned on entering play; despawned on
returning. Hardest part is dealing with chunks that have been edited
during play — either snapshot before play and revert, or commit play-time
edits back.

**Files touched.** `engine.ts`, both system arrays, new mode toggle in
the editor.

**Risks.** Largest item on this list. Coordinating which entities
survive a mode swap is fiddly; the playtest sessionStorage path stays
useful as a fallback.

---

## Game / runtime

### Variable jump height — **small**

**What.** Holding the jump key gives a higher jump than tapping; release
clamps `Velocity.y`.

**Why.** Industry-standard platforming feel; lets level designers tune
gap widths against both jump types instead of assuming a single height.

**How sketch.** In `player-control-system`, after the initial impulse,
each tick while `Velocity.y > 0` and the jump key is NOT held, clamp
`Velocity.y = min(Velocity.y, JUMP_RELEASE_CAP)`. The cap is what gives
"tap jumps stop short".

**Files touched.** `player-control-system.ts`.

---

### Air-jump cooldown indicator — **small**

**What.** Show a small HUD element (or a debug-overlay line) for the
remaining cooldown on the high-jump spell.

**Why.** Players currently can't tell when high-jump is ready except by
trial. Visible cooldown removes guesswork.

**How sketch.** `high-jump-system` already tracks the cooldown
internally. Expose it on `world.spellCooldowns: { highJump: number }`.
Render a tiny progress arc next to the player or in the debug overlay.

**Files touched.** `high-jump-system.ts`, a new tiny HUD bit in
`client.ts`.

---

### Checkpoint zones — **small**

**What.** Zones with `kind: "checkpoint"` write the player's position to
`world.lastCheckpoint`. On death, restart returns the player to that
position instead of `meta.spawn`.

**Why.** Long levels are infuriating without checkpoints. The zone
system is already in place; this is one new kind that the trigger
script can handle without new infrastructure.

**How sketch.** New zone script action `'set-checkpoint'`. The restart
system reads `world.lastCheckpoint` before falling back to `meta.spawn`.
Checkpoint state is saved to sessionStorage so playtest reloads preserve
it.

**Files touched.** `engine/ecs/zones.ts` (new action), `restart-system.ts`,
`world.ts` (add field).

---

### Spectator camera in playtest — **medium**

**What.** A `Tab` key toggle in playtest that detaches the camera from
the player and lets you free-fly (WASD + Q/E + mouse).

**Why.** Verifying level layouts during play without dying or
manoeuvring the player into every corner.

**How sketch.** Game-side: registered camera-control-system gets a
`mode: 'follow' | 'free'` flag. `Tab` toggles. In free mode, hide the
player or freeze it.

**Files touched.** `client.ts`, `camera-control-system.ts`,
`camera-follow-system.ts`.

---

### Trigger zone action expansion — **medium**

**What.** Add `teleport`, `add-pickup`, `enable/disable-piston`,
`play-sound` to the existing `ZoneScriptAction` union.

**Why.** The existing 4 actions (message / kill / set-block / fill-blocks)
unlock single-tile effects; teleport and piston-toggling unlock branching
levels. Sound effects make trigger events tangible.

**How sketch.** Each new action gets an entry in the discriminated union
and a branch in `executeZoneScriptAction`. The editor UI's zone panel
grows new buttons.

**Files touched.** `engine/ecs/zones.ts`, `zone-trigger-system.ts`,
`editor/ui/edit-tab.ts` (zone panel).

---

### Replay recorder — **medium**

**What.** Record player input + sim-time per fixed tick into a JSON
file. Replay deterministically reproduces the run.

**Why.** Verifies the level can be completed; reproduces physics bugs
deterministically; useful for regression testing significant engine
changes.

**How sketch.** A wrapper around `Input.consumeClicks` /
`actions.consumePressed` that logs every consumed event with its
sim-time. Replay reads the log and feeds events into the same buffers
on the matching ticks. Deterministic because the fixed step is fixed.

**Files touched.** New `engine/replay/`. Hooks into `Input` and `actions`.

**Risks.** Anywhere the engine reads non-deterministic state
(performance.now, Date.now, Math.random without a seeded RNG) breaks
replay. An audit is part of the work.

---

### NPCs / hostiles — **large**

**What.** Finish porting the parent codebase's AI schedule system —
zones become patrol regions, NPCs follow schedules between them, take
arrow damage, deal contact damage to the player.

**Why.** Pure platforming has a ceiling; even a single hostile type
(stationary turret or wandering grunt) dramatically expands the level
designer's vocabulary.

**How sketch.** Port `AiSchedule`, `AiScheduleStep`,
`assignAiSchedule`, `tickAiSchedule` from the parent's `engine/ecs/ai.ts`.
Add a basic `npc-system` that reads the schedule and moves NPCs via the
existing physics sweep. Damage uses a new `Health` component +
`damage-system`. Editor grows a "place NPC" mode.

**Files touched.** Many — this is multi-week work, and probably wants
its own design doc before starting.

---

### Per-block effect expansion — **large**

**What.** Generalise `BlockMovementTraits` into `BlockEffectTraits`:
damage-on-contact (lava), conveyor velocity (moving floor), climbable
(ladder), sticky (slow movement). 

**Why.** Each one is one line of palette data that adds a new gameplay
verb. The current architecture is already 90% there: `palette.ts` has
the trait surface, `movementEnvironmentForAABB` is the per-frame query
hook. Wire each effect into the right system.

**How sketch.** Extend `BlockMovementTraits` with new fields. Add hooks:
- Damage: `player-death-system` reads `traits.contactDamage` per tick.
- Conveyor: `player-control-system` adds `traits.conveyorVelocity` to
  the target velocity each tick.
- Climbable: `player-control-system` disables gravity + allows vertical
  movement when `traits.climbable && in cell`.

**Files touched.** `palette.ts`, `movement-effects.ts`,
`player-control-system.ts`, `player-death-system.ts`. Each effect is
small individually; the bigger investment is the test coverage.

---

## Rendering / visuals

### Split transparent voxels into a second submesh — **medium** (recommended)

**What.** Each chunk emits two meshes: one with the opaque faces
(`alpha=1`), one with the transparent faces (`alpha<1`).

**Why.** Solves the recurring "translucent face occludes solid block
behind it" artefact. Renderer renders opaque submesh first (full depth
write), then transparent submesh (no depth write). This is the textbook
fix and lets us stop applying `transparent: true` globally to the chunk
material.

**How sketch.** `greedyMesh` already classifies each face by palette
entry — it already has the alpha. Split the output into
`{ opaque: MeshData, transparent: MeshData | null }`. `ChunkRenderer`
holds two meshes per chunk, each with its own material (opaque material
plain, transparent material keeps the cut + cover-mask logic).

**Files touched.** `engine/voxel/greedy-mesher.ts`,
`engine/voxel/chunk-renderer.ts`, `engine/render/materials/`.

**Risks.** Doubles chunk-mesh count, but they share the same chunk
coordinate so culling is identical.

---

### AO / contact shadows in vertex colour — **medium**

**What.** Bake an ambient-occlusion factor into each vertex of the
greedy mesh based on neighbouring voxel occupancy. Inner corners get
darker; flat surfaces stay bright.

**Why.** Voxel scenes without AO look very flat; with AO they get the
depth cue you see in Minecraft / Sandstorm / etc. Free at runtime —
all the cost is during meshing.

**How sketch.** For each vertex of an emitted quad, sample the three
neighbouring cells along the quad's perpendicular plane. Count how many
are occluding voxels; map count [0..3] to AO factor [1.0..0.65]. Multiply
into the vertex RGB before writing into the buffer.

**Files touched.** `engine/voxel/greedy-mesher.ts`. Pure addition.

**Risks.** Adjacent quads need consistent AO at shared vertices; the
greedy mesher merges quads, so the AO needs to factor into the merge
decision (or be computed per cell and averaged). A bit of care needed.

---

### Top-down "dim above" via TSL `Discard` — **medium**

**What.** Replace the camera near-plane cut with a per-fragment discard
in the voxel material based on `positionWorld.y > cutPlaneY + 1`.

**Why.** The near-plane cut clips ALL geometry above the cut, which is
why the spawn marker had to switch to a flat ring in top-down. With a
material-level discard, decorative overlays (spawn marker column, zone
wireframes, piston arrows) can ignore the cut and stay visible.

**How sketch.** TSL has `Discard(cond)` — wrap the voxel material's
fragment output with a discard when `positionWorld.y > cutY + 1` and
cut is active. Camera near plane stays at the default. Other materials
(`MeshBasicMaterial` for overlays) are unaffected.

**Files touched.** `engine/render/materials/voxel-vertex-color.ts`,
`isometric-camera.ts` (drop `setCutPlaneY`),
`editor/systems/view-mode-system.ts`, `editor/systems/spawn-marker-system.ts`
(revert to just the column).

**Risks.** TSL `Discard` semantics in WebGPU — verify it works without
back-end-specific quirks.

---

### Worker-thread greedy mesher — **large**

**What.** Move `greedyMesh` from the render thread into a worker pool;
the chunk renderer enqueues remeshes and applies them when results
return.

**Why.** Currently each setVoxel can trigger a remesh of an entire 32³
chunk on the main thread, which stalls input + rendering for a frame on
big chunks. Painting a 5×5×5 brush across two chunks compounds. Workers
keep the main thread responsive.

**How sketch.** `greedyMesh` is already pure — input is the sample
function and palette, output is plain typed arrays. Serialise the
chunk's voxel data + palette into a worker message; receive `MeshData`
back; apply on the next render tick. Pool of 2–4 workers keeps things
flowing.

**Files touched.** `engine/voxel/chunk-renderer.ts`, new
`engine/voxel/mesher-worker.ts`.

**Risks.** The greedy mesher's `sample` callback currently bounces
out-of-chunk reads back to the `ChunkManager` (for boundary face
correctness). The worker can't reach back into the manager — either
ship the neighbour borders into the worker message, or change the
mesher to take all needed data up front.

---

## Code organisation / architecture

### Move state-reset helpers into `level-state.ts` — **small**

**What.** Extract `clearWorldAndEditorState` + `clearAllChunks` from
`editor/save-load.ts` into a new `editor/level-state.ts` (or
`engine/voxel/level-state.ts`) so the game side can use the same
teardown if it ever needs it.

**Why.** Today only the editor wipes state; if the game ever supports
"restart level" without a page reload (see "in-editor playtest"), it
needs the same teardown. Keeping it co-located with save-load couples
the helpers to the JSON-binary format, which they shouldn't be.

**Files touched.** `editor/save-load.ts`, new file, anywhere the editor
imports the helpers.

---

### Split editor-state into persisted vs UI-draft — **medium**

**What.** Today `EditorState` mixes durable level data (pickups, pistons,
zones) with transient UI drafts (`zoneScriptOffset`, `zoneScriptMessage`,
`pistonDirection`, etc.). Split into `EditorLevelState` (what
`toLevelMeta` serialises) and `EditorDraftState` (what only the panel
cares about).

**Why.** `toLevelMeta` is one wrong-default away from accidentally
serialising the user's draft script offsets. The split makes the
"what's in the saved file" surface explicit.

**Files touched.** `editor/editor-state.ts`, every UI builder reading
either subset, save-load.

---

### Tests for placement systems — **small** to **medium**

**What.** Unit tests for `voxel-paint-system`, `pickup-spawn-system`,
`piston-place-system`, `spawn-place-system`, `zone-place-system`.

**Why.** Today only `piston-system`, `zones`, and the voxel module
have tests. Placement systems are easy to test (they're click-driven)
and they're the ones that the editor UX bugs surface in.

**How sketch.** Each system test follows the same pattern as
`piston.test.ts`: build a `GameWorld` + `ChunkManager`, simulate a
click via `input.pendingClicks.push(...)`, run `system.update`, assert
the world / chunks / editorState changed as expected.

**Files touched.** New test files; the systems themselves stay as-is.

---

## Tooling / observability

### Persist debug overlay state in localStorage — **small**

**What.** Save whether the debug overlay is enabled across reloads.

**Why.** Currently toggling it open resets every reload, which is
annoying during iteration sessions.

**How sketch.** In `debug-overlay-system`, read
`localStorage.getItem('vp:debugOverlay')` at init; write on toggle.

**Files touched.** `engine/ecs/systems/debug-overlay-system.ts`.

---

### FPS / frame-time graph in metrics panel — **small**

**What.** A small sparkline (last 60 frames of frame time) in the
metrics overlay.

**Why.** Frame-time spikes are easier to spot in a graph than in
text; useful during paint stress tests.

**How sketch.** `EngineMetrics` already exposes counters. Add a
circular buffer of the last N frame times; render via a small canvas
or SVG polyline in the existing metrics panel.

**Files touched.** `engine/metrics.ts`,
`engine/ecs/systems/debug-overlay-system.ts`.

---

### Log filter / search — **small**

**What.** Add a text input above the log panel that filters entries by
substring.

**Why.** Once the log captures piston / zone events too, scanning for
the one entry you want is hard.

**How sketch.** Simple filter on the rendered list — no need to change
`world.log`, just hide non-matching `<div>`s in the panel.

**Files touched.** `engine/ecs/systems/debug-overlay-system.ts`.

---

### Frame-by-frame stepper — **medium**

**What.** A `pause` button in the debug overlay plus `]` (forward one
fixed tick) and `[` (rewind, if the replay recorder is in place).

**Why.** Reproducing physics bugs at 60 Hz is painful; stepping one
tick at a time makes them visible.

**How sketch.** `engine.start` already runs a fixed-step loop; add a
`paused` flag and skip the fixed update when paused. `step()` runs
exactly one fixed update.

**Files touched.** `engine.ts`, debug overlay.

---

### Trace recorder — **medium**

**What.** Optional logging mode that writes every piston tick / zone
trigger / pickup pickup as a JSON line to a downloadable file at the
end of the session.

**Why.** Offline analysis of complex piston / zone interactions; useful
for diagnosing the "some cloud pistons can't be removed" class of bug
where you can't easily inspect transient state.

**How sketch.** A `trace.ts` module with a single `record(kind, payload)`
function. Systems call it under a guard (`if (world.tracing)`). At
shutdown, write the array as a downloadable Blob.

**Files touched.** New file; minor changes in each system that emits a
trace event.

---

## Suggested first three

If we sit down for a fresh planning session and need to pick something:

1. **Undo / redo stack** — biggest UX win, smallest scope of any feature
   on the list. Every other editor improvement assumes "I can undo a
   mistake" exists.
2. **Split chunk mesh into opaque + transparent submeshes** —
   eliminates a whole class of rendering bug we've hit twice now in
   different forms; sets up the AO + worker mesher work.
3. **Pick-block hotkey + palette numeric shortcuts** — turns the editor
   from click-heavy to keyboard-heavy, makes painting feel an order of
   magnitude faster once you've internalised the colours.

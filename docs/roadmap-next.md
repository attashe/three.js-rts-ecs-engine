# Revised Architecture Roadmap

This document supersedes the early Phase 4/5 sketch in the README. The first
three phases successfully moved the project from the RTS demo to a WebGPU voxel
ARPG prototype, but the next stage should not jump straight into a full editor.
The engine now needs sharper contracts around data, mutation, lifecycle, and
gameplay ownership before larger tools or RPG systems are added.

## Critical Review

### What changed since the original plan

- The prototype is now an ARPG-style direct-control demo, not a click-to-move
  RTS-derived demo.
- Visuals are code-native Three.js factories for now: hero, weapons, and NPC.
  glTF remains useful later, but it should not block gameplay architecture.
- Input is scoped to the renderer surface and has edge-event support. This makes
  future editor/game input separation possible, but action mapping is still
  missing.
- Voxel block traits have started to split rendering, collision, raycast, and
  pathing semantics. This should become the standard extension point for block
  behavior.
- Path-following no longer has to bypass physics, but the pathfinder is still
  a preserved subsystem rather than a production NPC navigation layer.

### Problems in the old Phase 4/5 order

- Building a voxel editor first is premature without a stable level format,
  chunk serialization, bulk mutation API, undoable commands, and test coverage.
- The plan treated "editor" as one phase, but it contains several separate
  products: viewport controls, block tools, palette editing, region operations,
  save/load, import/export, and validation.
- The plan treated RPG gameplay as a later "re-skin", but control, physics,
  entity lifecycle, interaction, and content placement are already gameplay
  architecture decisions. Deferring them creates churn.
- The plan locked "greedy meshing in a worker" too early. The current sync
  mesher is acceptable for the small demo; workerization should be driven by
  profiling or larger authored levels.
- The plan assumed glTF for characters. That is still a good asset target, but
  the immediate need is stable visual attachment points and entity presentation
  structure, not a loader.

## Architectural Principles Going Forward

- Physics owns `Position` for collidable entities. Controllers and navigation
  systems write velocity or intent; they do not teleport collidable actors.
- Renderable objects are presentation. Gameplay systems should not depend on
  child mesh names, materials, or geometry structure.
- Voxel mutation goes through `ChunkManager` or a future edit-session API.
  Direct chunk-local writes should stay internal to trusted bulk operations.
- Palette entries expose explicit traits. New block behavior should not overload
  a single `solid` flag.
- The editor and game share data/model code, not input state or UI state.
- Add tests at subsystem boundaries before increasing feature count.

## Revised Phases

### Phase 4A - Engine Hardening And Data Contracts

Goal: make the current prototype safe to extend.

Deliverables:
- Add focused tests for chunk coordinate conversion, AABB overlap boundaries,
  axis sweep behavior, raycast edge cases, and layered pathfinding.
- Introduce a stable level serialization module for palette + chunks + metadata.
- Add a bulk edit/session API to `ChunkManager` that preserves dirty marking and
  neighbor invalidation while avoiding per-voxel render churn during generation
  or editor operations.
- Add explicit entity spawn/despawn helpers for common actor types and cleanup
  side tables consistently.
- Add a system ordering model (`phase` or `order`) so fixed/render ordering is
  declared by the system, not hidden in `client.ts` call order.
- Define lightweight visual attachment points for actors: main hand, off hand,
  back, overhead, and ground marker.

Exit criteria:
- Typecheck and build pass.
- New tests cover voxel math and lifecycle invariants.
- Demo behavior is unchanged except for bug fixes.

### Phase 4B - Game Vertical Slice

Goal: make the demo feel like a small ARPG scene before building heavy tools.

Deliverables:
- Add interaction components: `Interactable`, `Faction`, `Health`, and a simple
  `Nameplate` or overhead marker presentation hook.
- Add one NPC interaction surface using the existing sample NPC: proximity prompt
  or click/keyboard interaction, with data stored outside mesh internals.
- Add one weapon behavior path: melee hit volume or simple projectile arrow.
- Add pickup/loot props with code-native factories before introducing external
  asset loading.
- Add optional click-to-move only after it uses AABB-aware path validation and
  the same physics-owned movement path.

Exit criteria:
- Player can move, interact with the NPC, and trigger one combat or pickup loop.
- The loop uses ECS/data contracts, not ad hoc scene object references.

### Phase 5A - Editor Foundation

Goal: build a minimal editor on stable data contracts.

Deliverables:
- Editor viewport with `OrbitControls`, scoped input, and renderer reuse.
- Paint, erase, pick, and box-fill tools implemented as undoable edit commands.
- Palette panel backed by the same `Palette` traits used by the game.
- Save/load through the Phase 4A serializer.
- Drag/drop a saved level and launch the game entry against that level.

Exit criteria:
- An edited level round-trips through save/load and renders in the game.
- Undo/redo works for voxel edits.

### Phase 5B - Editor Production Tools

Goal: make authoring efficient rather than merely possible.

Deliverables:
- Region copy/paste and stamp placement.
- Selection bounds and transform handles.
- Level metadata editing: spawn point, NPC placement, loot placement.
- Validation pass: missing spawn, invalid palette indices, unreachable key points.
- Optional `.vox` import after the internal format is stable.

Exit criteria:
- A small playable level can be authored without editing source code.

### Phase 6 - Asset Pipeline

Goal: move from code-native placeholders to authored content without disturbing
gameplay systems.

Deliverables:
- Add glTF loading and an asset registry.
- Keep code-native assets as fallback/debug assets.
- Define attachment sockets in data, not by child mesh name conventions.
- Add a simple animation strategy for player/NPC idle, walk, attack, and hit.

Exit criteria:
- Player or NPC can be swapped from code-native visual to glTF visual without
  changing controller, physics, interaction, or combat systems.

### Phase 7 - Scaling And Performance

Goal: optimize only where measurements show pressure.

Deliverables:
- Add coarse performance counters for chunk remesh time, draw calls, entity
  counts, and fixed-step cost.
- Move meshing to a worker pool when authored levels produce visible spikes.
- Add chunk streaming only after level dimensions exceed the bounded demo scale.
- Consider heightmap/path caches after NPC navigation becomes active.

Exit criteria:
- Performance improvements are tied to measured bottlenecks.

## Near-Term Implementation Order

1. Add tests and a level serializer.
2. Add bulk voxel edit sessions.
3. Add system ordering metadata.
4. Add actor attachment points and presentational cleanup.
5. Build a tiny interaction/combat/pickup vertical slice.
6. Start the editor foundation only after save/load and commands exist.

This order keeps the project moving toward a playable ARPG while still preparing
for the editor and asset pipeline. It also avoids turning early prototype
surfaces into permanent architecture.

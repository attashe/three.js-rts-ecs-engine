# Changelog

This file keeps completed migration and phase notes so the README can focus on
the current project structure and future plan.

## Current Foundation

The project has moved from the legacy RTS demo to a WebGPU voxel ARPG
prototype. The game now uses direct ARPG controls, voxel terrain, simple
gameplay objects, moving mechanisms, NPC navigation experiments, projectiles,
falling stones, a shared UI library, and a Vite multi-entry setup for game,
editor, and UI catalog pages.

## Phase 0 - Foundations

Goal: clean slate that compiles and renders an empty scene.

Completed:
- Moved the build to Vite multi-entry: `index.html` for the game and
  `editor.html` for the editor.
- Updated core dependencies to current project versions: `three`, TypeScript,
  Vite, `bitecs`, `lil-gui`, `sass`, and Node types.
- Removed the legacy Webpack stack, old Sass loader stack, dat.gui,
  socket/server dependencies, and RTS-specific runtime modules.
- Consolidated TypeScript config at the repository root with strict settings.
- Deleted the RTS game surface and reduced the bootstrap to a minimal render
  smoke test.

Deferred:
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` were left off to
  avoid noisy legacy migration churn.
- Remaining old base classes were planned for deletion instead of cleanup.
- The large game bundle warning was accepted as a three.js/WebGPU cost.

## Phase 1 - ECS Rebuild On bitecs

Goal: replace class-based component storage with a real archetype ECS.

Completed:
- Added `src/client/engine/ecs/` with typed `GameWorld`, SoA components,
  system interfaces, movement, spin, and render-sync systems.
- Added `Engine`, `Scheduler`, and a focused renderer wrapper.
- Rewrote signals for UI/event usage and kept ECS systems out of the event bus.
- Added a small entity demo driven by ECS components.
- Deleted the old engine module/component/game-object structure and RTS game
  module configuration.

Known limits:
- No FPS/performance counter at this stage.
- Component palette was intentionally minimal until gameplay consumers existed.
- Verification was typecheck/build/module-resolution focused.

## Phase 2 - WebGPU Renderer

Goal: switch the rendering backend.

Completed:
- Rewrote the renderer around `WebGPURenderer` from `three/webgpu`.
- Made `Engine.start()` async so WebGPU initialization completes before the
  frame loop.
- Added `WebGPUUnavailableError` and a graceful fatal overlay path.
- Added `IsometricCamera`, keyboard/mouse input, camera control, camera follow,
  and `StatsHUD`.
- Switched demo materials to WebGPU/TSL-compatible materials.
- Removed `OrbitControls` from the game runtime.

Decisions:
- No WebGL fallback.
- No FXAA pass; MSAA via `WebGPURenderer({ antialias: true })` is the current
  antialiasing path.
- The custom scheduler was kept instead of `setAnimationLoop` because it owns
  fixed-step and render-step buckets separately.

## Phase 3 - Voxel Core And Playable Demo

Goal: replace the flat grid world with chunked voxel terrain and a playable
scene.

Completed:
- Added `engine/voxel/` with palette traits, chunks, chunk manager, greedy
  mesher, chunk renderer, voxel raycast, voxel pathfinding, collision helpers,
  and level serialization foundations.
- Added ECS tags and side tables for movement paths and camera targets.
- Added `MoveAlongPathSystem`, `CameraFollowSystem`, click queue, pointer ray
  helpers, and direct ARPG player controls.
- Added procedural island generation, placeholder hero/NPC/weapon/prop visuals,
  player and NPC spawn helpers, and preserved click-to-move for future use.
- Added AABB voxel collision, grounded checks, gravity, jump, camera-relative
  movement, and smooth camera follow.

Critical audit notes:
- Greedy mesher winding and cross-chunk dirty marking were reviewed.
- Negative chunk coordinate conversion was verified.
- Pathfinding was acceptable for prototype scale but identified as needing
  height/path caches later.
- Step-up and ledge handling were identified as future movement polish.

Deferred:
- Worker meshing until profiling shows remesh spikes.
- glTF loader until authored models exist.
- Streaming chunks and chunk LOD until content scale requires them.
- Diagonal pathfinding and precomputed heightmaps until NPC navigation needs
  them.

## ARPG Engine Additions After Phase 3

Completed:
- Added NPC wandering, faction relationship data, no-walk zones, path debug,
  collision debug, and labels.
- Added local collision work for NPCs and the player, including player blocking
  NPC paths.
- Added NPC jump behavior for uphill obstacles and fixed failed uphill jumps.
- Added input buffering, including jump-buffer fixes and review of attack
  buffer behavior.
- Added mouse-facing player direction and camera rotation in 90-degree steps.
- Added interactions, melee combat, pickups, air push, projectiles, arrows,
  falling stones, and impact handling.
- Added doors, pistons, moving blocks, piston trap playgrounds, and pathfinding
  test corridors.
- Reworked falling stone behavior several times to improve settling, stacking,
  collision, and ground penetration issues.
- Fixed debug overlay performance degradation and clunky label/bounding-box
  updates.

Known follow-up areas:
- NPC interlocking and blocked/repath loops still need a stronger avoidance or
  reservation model.
- Moving-object stacking and obstacle registration should become a cleaner
  shared physics contract.
- Piston and door behavior should be generalized into a mechanism system with
  trigger/actuator data.

## Shader And Material Docs

Completed:
- Added TSL shader/material documentation under `docs/shaders/`.
- Added opt-in material factories in `src/client/engine/render/materials/` for
  voxel vertex color, pulsing emissive, fresnel rim, dissolve, and wind foliage.

## UI Foundation

Completed:
- Added `src/client/ui/` as a framework-free shared UI package.
- Added primitives and widgets: `el`, buttons, icon buttons, panels, section
  titles, toolbar, keyboard chips, `ToastStack`, `CommandHintBar`, `GameHud`,
  `EditorShell`, and `UiLogPanel`.
- Replaced inline game HUD, notification, hint, fatal-error, stats, and debug
  log DOM styling with shared UI classes.
- Replaced the editor placeholder with `EditorShell`.
- Added `/ui-demo.html` for testing HUD regions, toasts, command hints, log
  panel, editor shell, buttons, panels, palette controls, and catalog states.
- Updated Vite multi-entry build to include the UI demo.

Deferred:
- No React/Vue/Svelte.
- No editor command system yet.
- No UI layout persistence.
- No save/load or validation modals until editor data contracts are ready.

## Revised Roadmap Notes

The old Phase 4/5 plan was revised after the ARPG retrofit and architecture
review. The project should harden gameplay/data contracts before building the
full editor.

Previous roadmap highlights:
- Add tests for voxel math, collision, raycast, pathing, and lifecycle
  invariants.
- Add stable level serialization for palette, chunks, and metadata.
- Add a bulk voxel edit/session API.
- Add explicit system ordering metadata.
- Define actor visual attachment points.
- Build a small game vertical slice before heavy editor work.
- Start the editor after save/load, commands, and undoable edits exist.
- Add glTF/asset registry later without changing gameplay systems.
- Optimize meshing, pathing, and streaming only after measurement.

## Validation History

Across the completed phases, the project has repeatedly been checked with:

```bash
npm run typecheck
npm test
npm run build
```

The Vite production build still reports a large game chunk warning from the
three.js/WebGPU import graph. That warning is accepted until code splitting or
asset-scale pressure makes it worth addressing.

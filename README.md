# Voxel RPG Engine (work in progress)

An isometric voxel RPG engine built on **three.js + WebGPU + bitecs**, reworked from the original `three.js-rts-ecs-engine` RTS demo. Single-player; single rendering path (WebGPU only, no WebGL fallback).

![Original RTS demo (pre-rework)](three.js_rts_ecs_demo_engine.png)

> The screenshot above is the legacy RTS demo. The rework deletes the RTS surface and rebuilds the engine on a voxel foundation. See the phase schedule below for the migration plan.

## Locked technical decisions

| Area | Choice |
|---|---|
| Renderer | `WebGPURenderer` only (Three Shading Language materials) |
| ECS | [bitecs](https://github.com/NateTheGreatt/bitecs) — SoA TypedArray archetype ECS |
| Voxel rendering | Greedy meshing per chunk in a Web Worker, one `BufferGeometry` per chunk |
| Editor | Separate page via Vite multi-entry (`/editor.html`) |
| Build | Vite |
| Asset format | glTF (binary) for characters; custom binary blobs for voxel levels; `.vox` import optional |
| Server | Out of scope for v1 (single-player) |

## Local pages

Run the Vite dev server on the forwarded port:

```bash
npm run dev -- --host 0.0.0.0 --port 8000
```

Available pages:
- `/index.html` — game demo.
- `/editor.html` — editor shell.
- `/ui-demo.html` — shared UI catalog for testing HUD, editor, toasts,
  command hints, panels, buttons, log panel, and palette controls together.

## Phase schedule

The original Phase 4/5 sketch has been revised after the ARPG retrofit,
asset-pass, and architecture audit. The current next-stage plan lives in
[`docs/roadmap-next.md`](./docs/roadmap-next.md). In short: harden data
contracts and gameplay boundaries before building the full editor.

### UI foundation branch plan — `feature/ui-foundation`
Goal: establish a reusable, vanilla TypeScript UI layer that can serve both
the game HUD and the future voxel editor without introducing a framework.

Planned architecture:
- Add `src/client/ui/` as the shared UI package for game and editor entries.
- Keep UI framework-free: components are small DOM factories/classes with
  explicit `dispose()` methods and stable CSS class names.
- Centralize visual tokens in one stylesheet (`ui.css`): colors, spacing,
  typography, z-index layers, panel surfaces, focus states, and compact
  control sizing.
- Make UI composition explicit. The game should create a HUD shell and add
  widgets to named regions; the editor should create an app shell with
  toolbar/sidebar/status regions.
- Keep gameplay systems ignorant of UI implementation. Gameplay systems accept
  callbacks (`notify`, later command/event adapters), while UI owns DOM. The
  debug overlay is the explicit client-side exception because it already renders
  diagnostic DOM.

First component library slice:
- `el` / `button` / `iconButton` / `panel` / `sectionTitle` /
  `toolbar` primitives for consistent structure.
- `ToastStack` for transient notifications.
- `CommandHintBar` for compact input hints.
- `GameHud` for reusable game overlays.
- `EditorShell` for the editor page frame, toolbar, side panels, and status bar.
- `UiLogPanel` for compact debug/game log rendering that can later replace
  ad-hoc debug DOM.

First integration pass:
- Replace inline DOM styling in `client.ts` with `GameHud`.
- Replace the editor placeholder with `EditorShell` and representative
  disabled tool controls for paint/erase/fill/select/save/load.
- Add `/ui-demo.html` as a catalog page for testing the shared UI controls,
  HUD regions, toasts, command hints, log panel, and embedded editor shell.
- Leave the 3D debug overlay internals intact for now, except where it can
  consume shared UI classes without changing debug behavior.

Deferred:
- No React/Vue/Svelte.
- No editor command system yet; controls are presentational until Phase 5A.
- No persistence of UI layout.
- No modal-heavy flows until save/load and validation rules are implemented.

### Phase 0 — Foundations (mechanical, low-risk) ✅ complete
Goal: clean slate that compiles and renders an empty scene.

Landed:
- Dependencies pinned to current majors:
  - `three` 0.158 → **0.184**, `@types/three` → **0.184**
  - `typescript` 5.2 → **6.0**
  - Added `vite` **8.0**, `bitecs` **0.4**, `lil-gui` **0.21**, `sass` **1.99**, `@types/node` **25**
  - Removed: `webpack*`, `ts-loader`, `style-loader`, `css-loader`, `webpack-merge`, `webpack-cli`, `webpack-dev-server`, `node-sass`, `sass-loader`, `dat.gui`, `@types/dat.gui`, `@tweenjs/tween.js`, `pathfinding`, `pseudo-random`, `socket.io`, `socket.io-client`, `express`, `@types/express`, `concurrently`, `nodemon`, `@types/node-sass`
- Build moved to **Vite multi-entry**: `index.html` (game), `editor.html` (Phase 4 placeholder), config in `vite.config.ts`. Old `webpack.{common,dev,prod}.js` deleted.
- Single `tsconfig.json` at project root with `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `isolatedModules`, `moduleResolution: bundler`, ES2022 target. Old per-folder tsconfigs deleted.
- RTS surface deleted: `game/components/unit*`, `game/components/select-3d-object-component.ts`, `game/modules/{map,path-find,cursor-3d,ui}`, `game/logic/point-and-click-module.ts`, `config-gameobjects.ts`, `game-events.ts`, `game-component-events.ts`, `engine/modules/network-module.ts`, `engine/store.ts`, `src/server/`, `src/shared/`.
- TWEEN/dat.gui/FBX usages cleaned: `object-3d-component.ts` no longer tweens rotation, `renderer-module.ts` no longer ticks TWEEN, `debug-3d-module.ts` switched to `lil-gui`, `assets-module.ts` stubbed (Phase 3 will rebuild it on glTF).
- `client.ts` reduced to a 25-line bootstrap: GridHelper + ambient + directional light + camera at (15, 15, 15).
- Verified: `npm run typecheck` clean, `npm run build` emits `dist/index.html`, `dist/editor.html`, `dist/assets/game-*.js`, `dist/assets/editor-*.js`.

Intentionally deferred:
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are **not** enabled. They generate noise that the legacy class-based ECS would have to absorb; cleaner to enable on the bitecs rewrite.
- `BaseComponent`/`BaseModule` still expose `protected config: any`. These classes are deleted in Phase 1 — adding generics now is throwaway work.
- The 594 kB game bundle warning is just three.js. Phase 2 will code-split the WebGPU/post-processing modules.

### Phase 1 — ECS rebuild on bitecs ✅ complete
Goal: replace class-based component storage with a real archetype ECS.

Landed:
- New `src/client/engine/ecs/`: `world.ts` (typed `GameWorld` with side-table `Map<eid, Object3D>`), `components.ts` (SoA `Float32Array` storage capped at `MAX_ENTITIES = 65_536`), `systems/` (`system.ts` interface + `movement-system.ts`, `spin-system.ts`, `render-sync-system.ts`).
- New `src/client/engine/render/renderer.ts` — focused class wrapping the still-WebGL renderer (Phase 2 swaps to WebGPU).
- New `src/client/engine/scheduler.ts` — fixed + render scheduler. Default 60 Hz fixed step, render at rAF rate, frame delta clamped at 100 ms.
- New `src/client/engine/engine.ts` — owns `world`, `renderer`, `scheduler`, `signals`. `addSystem(s)` routes to either fixed or render bucket based on `s.fixed`. Calls `s.init?(world)` on `start()` and `s.dispose?()` on `stop()`.
- `RenderSyncSystem` uses `bitecs.observe(onAdd/onRemove)` to attach/detach `Object3D`s from the scene, plus an initial-scan in `init()` so entities spawned before `start()` are picked up.
- `signals.ts` rewritten to drop the legacy `Events` dependency and the per-send `console.log`. Used only for UI events now; ECS systems never go through it.
- Demo bootstrap in `client.ts`: 5 cubes orbiting + spinning, driven by `Position`/`Velocity`/`Rotation`/`AngularVelocity` components.

Deletions:
- `engine/{config,events,utils}.ts`, the entire `engine/components/`, `engine/game-objects/`, `engine/modules/` (incl. `assets/` and `renderer/`), and `game/` (RTS module-list config).

Bundle: game `552 kB` (down from `594 kB` after dropping legacy modules + dat.gui surface; lil-gui & sass are unused in the game entry now and tree-shake out — they'll come back via the editor entry in Phase 4).

Intentionally deferred / known limits:
- **No FPS / perf counter** — the legacy `StatsModule` was deleted and not replaced. Phase 2's renderer rebuild will add an HUD-style overlay.
- **Component palette is intentionally minimal** — only `Position`, `Rotation`, `Velocity`, `AngularVelocity`, `Renderable`. The plan's aspirational `ChunkRef`, `Health`, `Stats`, etc. land with their consumers in Phases 3 & 5.
- **Verification was build + module-resolution only** — `tsc --noEmit`, `vite build`, and a Vite dev-server smoke test confirm both entries serve and the module graph resolves. Actual canvas rendering of the demo cubes was not headlessly verified; visual smoke-test happens in the browser.
- **Memory: ~3 MB** for the four `Float32Array(65 536) * 3` vec3 components. Right tradeoff for SoA at this entity cap; if levels stay well below the cap this just sits idle in heap.

### Phase 2 — WebGPU renderer ✅ complete
Goal: switch the rendering backend.

Landed:
- `Renderer` rewritten on `WebGPURenderer` from `three/webgpu`. WebGPU-only — constructor throws `WebGPUUnavailableError` if `navigator.gpu` is missing; `client.ts` shows a graceful fatal-error overlay.
- `Engine.start()` is now async — awaits `renderer.init()` (WebGPU device acquisition) before kicking off the scheduler.
- New `IsometricCamera` (`engine/render/isometric-camera.ts`) — `OrthographicCamera` at fixed 45° yaw / 30° pitch with configurable view-size/distance/target. `syncPosition()` keeps camera at fixed offset as `target` moves; `applyZoom()` handles wheel-zoom clamp.
- New `Input` module (`engine/input/input.ts`) — held-key set, last pointer, accumulated wheel delta. Listeners on `window`. Auto-clears keys on `blur` to avoid stuck-key drift.
- New `CameraControlSystem` (render-step) — WASD + arrow-keys + edge-pan combined, normalised so diagonal isn't √2× faster; wheel zooms in/out with configurable factor and clamps.
- New `StatsHUD` (`engine/render/stats-hud.ts`) — minimal absolute-positioned div showing FPS / frame-time, smoothed over 0.5 s. Replaces the deleted three-stats-module dep.
- Demo material switched: `MeshStandardMaterial` → `MeshStandardNodeMaterial` (TSL-compatible). Tone-mapping = `ACESFilmicToneMapping`.
- `OrbitControls` is no longer in the game runtime (will be re-introduced only inside the Phase 4 editor entry).

Bundle: game `752 kB` (gzip `207 kB`), up from `552 kB` after Phase 1. The growth is `three/webgpu` + the TSL node-material graph; pre-bundled by Vite's dep optimiser.

Intentional deviation from the original plan:
- **No FXAA pass.** TSL in three 0.184 ships `pass` + tone-mapping nodes but no built-in FXAA/SMAA, and `PostProcessing` was deprecated in favour of `RenderPipeline`. AA is delivered via **MSAA** (`WebGPURenderer({ antialias: true })`) — generally higher-quality than FXAA, free on modern GPUs. Custom `RenderPipeline`-based post-processing (SSAO, bloom) lands when there's a concrete need.

Intentionally deferred:
- **WebGPU adapter capability surface** — `webgpu.init()` throws on unsupported configurations and the error propagates to the fatal overlay; we don't yet probe specific features (e.g. timestamp queries, multi-sample limits).
- **`setAnimationLoop` vs custom `Scheduler`** — three.js recommends `renderer.setAnimationLoop(cb)` (auto-init, free WebXR). We deliberately use our own `Scheduler` because it provides separate fixed-timestep and render-timestep buckets that `setAnimationLoop` doesn't. As long as `await renderer.init()` runs before the first `render()` (which `Engine.start()` guarantees), manual rAF is officially supported — see the source comment on `Renderer.render()` in three's `renderers/common/Renderer.js`.

Validation against three.js r184 source + manual:
- `WebGPURenderer({ antialias: true })` → 4× MSAA (source line 275 in `Renderer.js`).
- `renderAsync()` was deprecated in r181 in favour of `render()` after `await init()` (line 1038); we use `render()`.
- `MeshStandardNodeMaterial({ color })` is valid — the constructor accepts the same parameter object as the legacy material; TSL-style `material.colorNode = color(…)` is optional for complex shader graphs.
- Shadow casting/receiving works identically to WebGL (r168-r169 fixed the early WebGPU shadow regressions; r184 is stable).

### Phase 3 — Voxel core ✅ complete (playable demo)
Goal: replace the flat grid world with a chunked voxel volume — and ship a playable demo.

Landed:
- **`engine/voxel/`** — full subsystem (re-exported via `engine/voxel/index.ts`):
  - `palette.ts` — `PaletteEntry { name, color, solid }` plus optional block traits (`collidable`, `occludesFaces`, `raycastTarget`, `pathSurface`). `DEFAULT_PALETTE` has air + 9 block types (grass, dirt, stone, sand, wood, leaf, plank, brick, glow). Index 0 reserved for air.
  - `chunk.ts` — `CHUNK_DIM = 32`, `Uint16Array(32³)` storage, `version` counter, `nonAirCount` for early-out, `getLocal`/`setLocal`.
  - `chunk-manager.ts` — `Map<ChunkKey, Chunk>`. Negative-safe world↔chunk coord conversion. Boundary writes mark neighbour chunks dirty so cross-chunk faces re-mesh.
  - `greedy-mesher.ts` — pure Mikola-Lysenko sweep over 3 axes; per-quad CCW/CW winding so cross-products produce the correct face normal. Cross-chunk-aware via `VoxelSampler` callback (chunk renderer wires it to the manager so out-of-chunk reads fall through to neighbours).
  - `chunk-renderer.ts` — one `BufferGeometry`+`Mesh` per chunk. `update()` drains the dirty set per frame and re-meshes. Synchronous on main thread (Phase 3 ships ~4 chunks; worker pool deferred until profiling justifies it).
  - `voxel-raycast.ts` — Amanatides–Woo DDA. Returns `{ voxel, normal, t }` or `null`.
  - `voxel-path.ts` — surface-grid A* with `maxStepUp`/`maxDrop` tolerances. Nodes include X/Y/Z standing height so stacked floors/roofs do not collapse into one column; 4-connected neighbours.
- **ECS additions**:
  - Tag components `MoveAlongPath` and `CameraTarget`.
  - `pathByEid: Map<eid, { points: Vector3[], index, speed }>` side-table.
  - `move-along-path-system.ts` (fixed) — follows waypoints with yaw-only facing; entities with `Velocity` feed movement into physics instead of bypassing collision.
  - `camera-follow-system.ts` (render) — `IsometricCamera.target` lerps toward the first `CameraTarget` entity; frame-rate-independent exponential approach (`alpha = 1 - exp(-smoothing * dt)`).
  - `camera-control-system.ts` — refactored with `keyboardPan` / `edgePan` / `wheelZoom` toggles so the demo can run zoom-only.
- **Input additions**:
  - Click queue (pointerdown + pointerup with no significant drag and within 350 ms = a click). Right-click suppresses the browser context menu so it can be used as in-game cancel.
  - `engine/input/pointer.ts` — `screenToWorldRay` helper (works for ortho via `Raycaster.setFromCamera`).
- **Game layer (`src/client/game/`)**:
  - `level.ts` — deterministic procedural island, ~48×48, height variation, sandy fringe, 5 trees, a brick-and-plank hut with a glowstone lantern.
  - `assets/` — code-native placeholder visuals for the hero, weapons, and sample NPC.
  - `player.ts` — visual hero wrapped in a `Group` so the entity's `Position` is at the player's *feet*. Equipped sword/bow/quiver are presentation-only children.
  - `npc.ts` — sample NPC spawn helper using the same ECS render path as the player.
  - `click-to-move.ts` — render-step system. **Preserved but no longer registered** in the demo (see "ARPG retrofit" below). Useful when re-introducing click-to-walk as a Diablo-style alternative to WASD.

**The demo:** WASD or arrow keys to move (camera-relative), Space to jump, scroll to zoom. Camera follows smoothly. Walk through the hut door, jump onto the roof, hop between hills, fall off cliffs.

#### ARPG retrofit (post-Phase-3 critical pass)

The original Phase 3 plan shipped click-to-move with A* pathfinding. The user redirected the demo to ARPG-style direct control (WASD + Space + jump), which fundamentally conflicts with click-to-move (one wants direct velocity, the other wants pathed movement). The retrofit:

- **New components**: `PlayerControlled`, `Grounded` tags + `BoxCollider` (half-extents; X and Z half-widths, Y half-height with foot-anchored AABB).
- **New `engine/voxel/voxel-collide.ts`**: `voxelAABBOverlap` (bounded triple-loop with `-EPS` on max for clean integer-boundary handling), `sweepAxis` (binary-search clamp to nearest blocker, 12 iterations = 1/4096 precision), `isGrounded` (thin probe under the AABB with 0.08 epsilon to absorb sweep residual).
- **New `physics-system.ts`** (fixed-step): gravity → axis-wise sweep (X→Z→Y) → manage `Grounded` tag. Y-last so ground snapping happens after horizontal motion.
- **New `player-control-system.ts`** (fixed-step): camera-relative WASD via `IsometricCamera.getPanForward().negate()` and `getPanRight()`; horizontal velocity is exponentially smoothed (`alpha = 1 - exp(-accel*dt)`) so input feels weighted, not snappy. Space rising-edge while `Grounded` → upward velocity. `Rotation.y` writes only when horizontal speed exceeds 0.5 m/s so the player doesn't jitter back to the last facing on tiny residual motion.
- **`camera-follow-system` smoothing tightened from 6 → 8** so the camera tracks jump arcs without lag.
- `MoveAlongPathSystem` and `createClickToMoveSystem` no longer registered; both files preserved for future use (e.g. NPC pathing, or a re-introduced click-to-walk fallback). Tree-shaken from the bundle.

**Critical review of the original Phase 3 work (audit notes):**
- ✅ **Greedy mesher winding**: cross-product verified for all six face directions (`+X`/`−X`/`+Y`/`−Y`/`+Z`/`−Z`). Both `c0,c1,c2,c3` (positive faces) and `c0,c3,c2,c1` (negative faces) produce normals matching their face direction.
- ✅ **Cross-chunk meshing**: boundary writes mark neighbour chunks dirty so faces re-mesh correctly when adjacent voxels change.
- ✅ **`ChunkManager` negative-coord safety**: `Math.floor` for chunk index, positive-modulo for local — verified for negative voxel coordinates.
- 🟡 **`MoveAlongPathSystem` `state.points[state.index]!`**: redundant non-null assertion (we already gated on `state.index >= state.points.length`). Cosmetic; left in for intent.
- 🟡 **`voxel-path.ts surfaceY`**: O(searchRange) voxel reads around endpoints and O(maxStepUp/maxDrop) reads per neighbour. Acceptable for click-triggered queries (now unregistered); a pre-computed per-chunk heightmap is the right optimisation if pathfinding is reintroduced for NPCs.
- 🟡 **Step-up assistance**: 1-voxel ledges require pressing Space. ARPGs typically auto-step shallow ledges. Easy add (after a blocked X/Z sweep, try Y+1 then re-sweep), deferred to keep the diff focused.

Build: `tsc --noEmit` clean, `vite build` 840 kB / 234 kB gzip (45 modules transformed). Up from 752 kB after Phase 2 — the delta is the voxel subsystem + game files + the shader-material factories pulled into the import graph.

Intentionally deferred:
- **Web-worker meshing.** Synchronous on main thread is fine for ~4 chunks. The mesher is a pure function — moving it off-thread is one new file (`mesher.worker.ts`) plus a pool wrapper, no API changes elsewhere.
- **glTF loader for characters.** Code-native hero/NPC/weapon factories are sufficient as stand-ins; a glTF pipeline lands when authored models exist.
- **Streaming chunks / chunk LOD.** Levels are bounded; streaming makes sense once levels exceed 256³ or so.
- **Diagonal pathfinding.** 4-connected A* gives blocky paths but feels deliberately "tile-y" for an isometric grid game. Easy to add later by extending `NEIGHBORS` and adding a √2 cost.
- **Pre-computed heightmap for pathfinding.** Endpoint resolution still searches a bounded vertical range; for the 48×48 demo level this is fast enough. For larger worlds, cache a 2D heightmap per chunk/layer.

### Phase 4A — Engine hardening and data contracts
Goal: make the current prototype safe to extend before adding large tools.
- Add tests for voxel math, collision, raycast, pathing, and lifecycle invariants.
- Add level serialization for palette + chunks + metadata.
- Add a bulk voxel edit/session API so generation and editor commands preserve dirty marking without per-voxel churn.
- Add explicit system ordering metadata instead of relying on bootstrap call order.
- Define actor visual attachment points for main hand, off hand, back, overhead, and ground markers.

### Phase 4B — Game vertical slice
Goal: make the demo feel like a small ARPG scene.
- Add interaction components (`Interactable`, `Health`, `Faction`, presentation hooks).
- Add one NPC interaction using the sample NPC.
- Add one combat or pickup loop using the new weapon/prop visual factories.
- Reintroduce click-to-move only after it is AABB-aware and physics-owned.

### Phase 5A — Editor foundation
Goal: build the minimal editor on stable data contracts.
- Editor viewport with scoped input and renderer reuse.
- Paint / erase / pick / box-fill tools as undoable commands.
- Palette panel backed by the same block traits used by game systems.
- Save/load through the Phase 4A serializer.

### Phase 5B — Editor production tools
Goal: make authoring efficient.
- Region copy/paste, stamps, spawn/NPC/loot placement, validation, and optional `.vox` import.

### Phase 6 — Asset pipeline
Goal: swap code-native placeholders for authored content without changing gameplay systems.
- Add glTF loading and an asset registry.
- Keep code-native assets as fallback/debug visuals.
- Define attachment sockets in data rather than by mesh child names.

### Phase 7 — Scaling and performance
Goal: optimize measured bottlenecks.
- Add perf counters for remesh time, draw calls, entity counts, and fixed-step cost.
- Move meshing to workers only when authored levels produce visible spikes.
- Add chunk streaming and path/height caches when content scale demands them.

## Local development

```bash
npm install
npm run dev        # Vite dev server on :8080, opens game entry
npm run typecheck  # tsc --noEmit
npm run build      # typecheck then build production bundles for both entries
npm run preview    # preview production build
```

Game entry: `/index.html` (default).
Editor entry: `/editor.html` (placeholder until Phase 5A).

## Shader docs

TSL primer + runnable material examples live under [`docs/shaders/`](./docs/shaders/README.md):

- [`docs/shaders/tsl-cheatsheet.md`](./docs/shaders/tsl-cheatsheet.md) — syntax reference
- [`docs/shaders/examples.md`](./docs/shaders/examples.md) — annotated walkthroughs of the example materials
- `src/client/engine/render/materials/` — five opt-in `MeshStandardNodeMaterial` factories (vertex-color, pulsing-emissive, fresnel-rim, dissolve, wind-foliage). Not in the default import graph; pull what you need.

## Repository layout

```
.
├── index.html                  ← game entry (Vite)
├── editor.html                 ← editor entry (Vite)
├── vite.config.ts
├── tsconfig.json
├── docs/
│   └── shaders/                ← TSL cheatsheet + example walkthroughs
├── src/
│   ├── client/
│   │   ├── client.ts           ← game bootstrap (spawn entities, register systems, start engine)
│   │   └── engine/
│   │       ├── engine.ts             ← Engine: world + renderer + scheduler + systems + input
│   │       ├── scheduler.ts          ← fixed-step + render-step loop
│   │       ├── signals.ts            ← UI event bus (NOT for hot-path)
│   │       ├── signals-event.ts
│   │       ├── input/
│   │       │   ├── input.ts          ← keyboard + pointer + wheel + click queue
│   │       │   └── pointer.ts        ← screen → world ray helper
│   │       ├── ecs/
│   │       │   ├── world.ts                       ← createGameWorld() + Object3D + path side-tables
│   │       │   ├── components.ts                  ← SoA TypedArray components + tags
│   │       │   └── systems/
│   │       │       ├── system.ts                  ← System interface
│   │       │       ├── movement-system.ts         ← fixed-step (Position += Velocity)
│   │       │       ├── spin-system.ts             ← fixed-step (Rotation += AngularVelocity)
│   │       │       ├── physics-system.ts          ← fixed-step (gravity + AABB voxel collision + Grounded)
│   │       │       ├── player-control-system.ts  ← fixed-step (camera-rel WASD + jump)
│   │       │       ├── move-along-path-system.ts  ← fixed-step path walker (preserved, unregistered)
│   │       │       ├── render-sync-system.ts     ← render-step + onAdd/onRemove
│   │       │       ├── camera-control-system.ts  ← render-step zoom/pan with toggles
│   │       │       └── camera-follow-system.ts   ← render-step (smooth lerp to CameraTarget)
│   │       ├── voxel/                  ← voxel core (chunks, mesher, collide, raycast, A*)
│   │       │   ├── palette.ts              ← block type registry
│   │       │   ├── chunk.ts                ← 32³ Uint16 storage
│   │       │   ├── chunk-manager.ts        ← Map<key, Chunk> + dirty set
│   │       │   ├── greedy-mesher.ts        ← pure Mikola-Lysenko sweep
│   │       │   ├── chunk-renderer.ts       ← per-chunk Mesh + dirty drain
│   │       │   ├── voxel-collide.ts        ← AABB overlap + axis-sweep + grounded probe
│   │       │   ├── voxel-raycast.ts        ← Amanatides–Woo DDA
│   │       │   ├── voxel-path.ts           ← surface-grid A* (preserved, unused in demo)
│   │       │   └── index.ts                ← re-exports
│   │       └── render/
│   │           ├── renderer.ts            ← WebGPURenderer + ACES tone mapping + MSAA
│   │           ├── isometric-camera.ts    ← OrthographicCamera rig (45°/30°)
│   │           ├── stats-hud.ts           ← FPS / frame-time overlay
│   │           └── materials/             ← opt-in TSL material factories (see docs/shaders)
│   │   └── game/
│   │       ├── assets/           ← code-native placeholder visuals (hero, weapons, NPC)
│   │       ├── level.ts            ← procedural demo island
│   │       ├── player.ts           ← spawn visual hero with PlayerControlled + BoxCollider
│   │       ├── npc.ts              ← spawn sample NPC
│   │       └── click-to-move.ts    ← preserved for future use, not registered in the WASD demo
│   └── editor/
│       └── editor.ts           ← editor bootstrap (Phase 5A stub)
└── dist/                       ← Vite build output (gitignored)
```

## License

ISC. See `LICENSE`.

## Acknowledgements

Reworked from [`three.js-rts-ecs-engine`](https://github.com/andvolodko/three.js-rts-ecs-engine) by andvolodko, which was itself based on Sean Bradley's Three.js TypeScript boilerplate (`socketio` branch).

# Optimization Research

Date: 2026-05-10
Branch: `optimization`

This is a research note only. It does not propose disabling debug information as
an optimization. Debug paths, bounding boxes, labels, logs, and state visibility
are development requirements; optimization work should make them cheaper,
throttled, pooled, or selectively richer.

## Current Hot Areas

The current engine is still small enough that most costs are from simple
algorithms repeated often, not from one huge subsystem. The likely hotspots are:

- AI perception and behaviour: repeated full ECS scans, path requests, and
  dynamic blocker checks.
- Pathfinding: A* uses a linear open-set scan and string keys.
- Character collision: pair separation is all-pairs over solid character bodies.
- Rigid-body and collision sweeps: each active body performs several voxel and
  obstacle checks per fixed step.
- Debug overlay: many separate `Box3Helper`, `Line`, `Sprite`, canvas texture,
  and geometry update objects.
- Render sync: render frame runs separate queries for position and rotation.
- Projectiles/impact checks: arrows and impacts scan all health targets.
- Chunk remeshing: currently synchronous, fine for the demo but not scalable for
  editor-heavy phases.

## Instrument First

Before changing behavior, add a small profiling layer.

Recommended counters:

- Fixed-step time by system.
- Render-step time by system.
- Entity counts by core query: actors, rigid bodies, moving objects, renderables,
  health targets, debug-labelled entities.
- Path requests per second, path success/failure count, path nodes expanded.
- Perception target checks per second.
- Dynamic collision pair checks per step.
- Physics sweep count per step.
- Obstacle registry lookup count and average buckets scanned.
- Debug overlay object counts: boxes, labels, paths, label texture rebuilds.
- Chunk remesh count and remesh milliseconds.

Implementation direction:

- Add an `EngineMetrics` side table or service owned by `Engine`.
- Systems can optionally wrap update bodies with `metrics.time('system-name')`.
- Debug UI should display rolling averages and spikes.
- Keep metrics available even when the visual debug overlay is visible.

This should be Phase 1 of optimization. Without it, we risk optimizing what is
annoying to read rather than what costs frame time.

Phase O1 implementation started:

- `EngineMetrics` now lives on `GameWorld` as a shared instrumentation service.
- The engine records fixed/render system timings around existing system updates.
- Renderer update/render are timed as render entries.
- Debug overlay reports a compact metrics panel at the same low refresh cadence
  as heavy debug updates.
- Current debug gauges cover visible debug boxes, labels, and paths.
- Gameplay systems are not changed in this phase; this is measurement only.

Phase O2 implementation started:

- Perception now builds one fixed-step spatial target index and still applies
  the same faction, health, and distance checks before selecting a target.
- Dynamic character collision now broadphases solid actors by local XZ buckets
  before running the existing pair solver.
- Debug actor bounding boxes now render through one dynamic `LineSegments`
  buffer instead of one `Box3Helper` object per actor.
- Added runtime gauges for perception actor/target/check counts and dynamic
  collision actor/pair counts so regressions can be spotted in the debug panel.

Phase O3 implementation started:

- Pathfinding now uses a binary min-heap open set instead of linear extract-min
  scans. This preserves A* scoring while reducing repath spikes on larger
  searches.
- Path-follow local avoidance now queries nearby actors from a spatial bucket
  index before running the existing steering rules.
- Debug labels now cache canvas textures by label text and dispose the cache
  with the overlay, reducing canvas allocation churn while debug is visible.

Phase O4 implementation started:

- Render sync now walks the renderable set once per frame and mirrors available
  position/rotation components from that pass.
- Arrow hit detection now builds a health-target spatial index and queries by
  each arrow segment before running the existing exact AABB, wall, shield, and
  damage checks.

Phase O5 rendering research started:

- Three.js `InstancedMesh` is the right primitive when many objects share the
  same geometry and material but have different transforms. It requires
  updating instance matrices and marking `instanceMatrix.needsUpdate`.
- Three.js `BatchedMesh` is the stronger long-term candidate for our composite
  low-poly actors and props because it supports many geometries with a shared
  material and per-instance transforms.
- Current character/prop factories create many independent `Mesh` objects and
  recreate matching geometries/materials for every actor. Before changing the
  render architecture to instancing or batching, shared primitive geometry and
  material caches now remove repeated GPU-resource allocation while preserving
  the same scene graph and debug behavior.
- Next strategic rendering step: introduce a declarative model-part format
  (`geometryKey`, `materialKey`, local transform) so repeated actors can be
  rendered either as current debug-friendly `Group` trees or as `InstancedMesh`
  / `BatchedMesh` groups when entity count grows.

Phase O6 composite render reduction started:

- Added a `mergeGroupByMaterial` helper that flattens a decorative asset `Group`
  into one mesh per material using transformed merged geometry.
- Applied this only to assets whose internal child nodes are not queried by
  gameplay: ordinary NPCs, hostile actors, archers, rabbits, pickups, training
  dummies, arrows, and stones.
- Shield-bearing player/guard/hunter visuals keep their named shield nodes so
  shield animation and arrow-block attachment still work.
- This does not remove debug overlays or any ECS debug information; it only
  reduces internal decorative mesh count inside renderable entities.

Phase O7 render diagnostics started:

- Added a render metrics system that samples scene object, visible object, mesh,
  line, sprite, instanced mesh, and approximate triangle counts.
- The system also records renderer-provided render info when WebGPU exposes it.
- Metrics panel now shows more gauge entries in grouped lines so render gauges
  are visible alongside debug, AI, movement, and collision gauges.
- Static world-prop batching is deferred because current level generation uses
  voxel-authored structures for huts, fences, trees, doors, and terrain rather
  than repeated standalone renderable prop entities. The next batching step
  should target a declarative model-part layer for repeated actors/props, not
  hide or remove any debug visuals.

Phase O8 physics/render cleanup started:

- Awake rigid-body pair resolution now uses an allocation-light XZ broadphase
  before the existing narrow-phase solver, so stone/arrow pair checks scale by
  nearby bodies rather than all active body pairs.
- Renderable entities can now be marked `StaticRenderable`. RenderSync applies
  their transform once and skips per-frame transform mirroring after that.
- Static tagging is used for fixed pickups, training dummies, settled stones,
  and arrows after they become pickups. Runtime-settled bodies still receive one
  final transform sync before being skipped, so visuals do not lag behind ECS
  state.
- Air Push wakes sleeping bodies back into dynamic render sync by removing the
  static render tag when it removes the body from the obstacle registry.
- Physics now reports active-body and sleep-decision gauges, keeping this layer
  visible in the debug metrics panel instead of hiding debug information.
- UI meter and slot primitives now no-op when asked to write the same value,
  reducing repeated DOM text/class/style churn from the HUD while preserving
  the current simple HUD update flow.
- Stone-like rigid bodies now have a bounded voxel-overlap recovery path. It
  only runs when a rolling body is actually embedded in voxel terrain, searches
  small upward and horizontal escape offsets, and then stops the body so it can
  sleep instead of spinning forever in a wall or floor.

Rejected optimization:

- Debug path visualization batching was reverted because it removed or degraded
  required path debug visibility. Do not remove, hide, or degrade debug
  information during optimization unless the user directly asks for that exact
  debug output to be removed or hidden.

## Debug Overlay Optimizations

Debug is necessary, so the goal is to keep it on while reducing per-frame work.

Current observations:

- `debug-overlay-system` queries all `Behaviour + Position + BoxCollider`
  entities every render frame.
- Boxes update every render frame through individual `Box3Helper` objects.
- Labels are sprites with canvas-backed textures. Text refresh is throttled,
  but position updates still happen per render frame.
- Paths use one `Line` per entity and recompute bounds on heavy refresh.

Possible improvements:

1. Debug render levels
   - Keep one debug overlay enabled, but add levels: essentials, AI, physics,
     pathing, verbose.
   - This is not “turning debug off”; it avoids drawing every category when the
     developer is investigating one subsystem.

2. Shared batched box geometry
   - Replace one `Box3Helper` per actor with a single dynamic line geometry for
     all debug boxes.
   - Update one buffer instead of N helper objects.
   - Likely high impact in village/skirmish maps.

3. Batched path lines
   - Replace one `Line` per path with one dynamic line-segment geometry.
   - Rebuild only when path points change, update only first segment/origin when
     actor moves.

4. Label texture cache
   - Many labels share text patterns such as state names and movement names.
   - Cache `Texture` by full text for a short lifetime or by common fragments.
   - Avoid creating and disposing canvas textures repeatedly during state churn.

5. Label position interpolation tied to render object
   - Labels are already updated on render frames, but each label is independent.
   - Parent label sprites under the actor root when possible, with a fixed local
     offset, so scene graph propagation moves them without per-label position
     writes.

6. Debug dirty flags
   - Path lines should refresh only when `world.pathByEid` object identity or
     path index changes.
   - Labels should refresh when observed state values change, not just at timer
     intervals.

Recommended order:

1. Add metrics for debug object counts and update time.
2. Batch boxes.
3. Batch paths.
4. Add label texture cache or parent labels under actors.

## ECS Query And System Scheduling

Current pattern:

- Many systems call `query(world, [...])` every fixed or render update.
- Some systems then filter results into temporary arrays.
- Several systems independently scan similar entity sets.

Optimization options:

1. Query result reuse inside a frame
   - Add a small frame-local query cache keyed by component tuple.
   - Invalidate after structural changes or only cache for systems that run after
     spawning/despawning phases.
   - Risk: bitecs structural mutation timing must be respected.

2. Maintain side lists for stable categories
   - Keep `actors`, `solidCharacters`, `healthTargets`, `movingRigidBodies`,
     `debugActors`, and `renderables` as world side tables.
   - Update through component add/remove observers.
   - This makes hot systems iterate stable arrays instead of repeated queries.
   - Higher complexity but likely worth it before large maps.

3. Split fixed systems by cadence
   - Not every AI or debug-adjacent simulation needs 60 Hz.
   - Perception can run at 5-10 Hz.
   - Some behaviour state decisions can run at 10-20 Hz while movement remains
     60 Hz.
   - This should be explicit system cadence, not a hidden random throttle.

4. Scheduler fixed-step budget diagnostics
   - Keep fixed-step correctness, but expose when multiple fixed steps are run
     before one render.
   - Add spiral warnings and slow-system attribution.

Recommended order:

1. Add per-system metrics.
2. Add side lists only for the worst measured queries.
3. Add lower-rate perception/decision cadence after correctness tests.

## AI, Perception, And Pathfinding

Current observations:

- `perception-system` runs every fixed tick and calls `findNearestEnemy`.
- `findNearestEnemy` scans behaviour/faction/position data broadly.
- `behaviour-system` builds dynamic blockers once per tick, then passes blocker
  callbacks into pathfinding.
- Path requests use `findPath` directly, with per-call string keys and a linear
  open-set scan.
- Repath cooldowns exist but can still synchronize many actors into bursts.

Optimization options:

1. Spatial index for actors
   - Maintain a grid/hash of actors by XZ cell.
   - Perception, melee targeting, arrow target broadphase, impact checks, and
     dynamic collision can all use it.
   - This is probably the highest strategic optimization.

2. Perception cadence and staggering
   - Run perception at lower frequency, e.g. 6-10 Hz.
   - Stagger actors by entity id so all actors do not scan on the same tick.
   - Keep last target memory in the blackboard between scans.

3. Path request queue
   - Do not run all `findPath` calls immediately.
   - Queue path jobs with priority: player-critical, combat, flee, travel,
     wander.
   - Process a fixed budget per frame/tick.
   - This avoids frame spikes when several NPCs repath at once.

4. Path cache
   - Cache paths by coarse start cell, goal cell, movement policy, and blocker
     revision.
   - Useful for villagers/hunters that repeatedly route between home, village,
     hunting field, and combat slots.
   - Dynamic blockers make exact caching harder; use only for static terrain or
     ignore dynamic blockers for long-range route and let local steering handle
     final meters.

5. Replace path open set
   - `findPath` extracts min from an array linearly.
   - Use a binary heap or bucket queue.
   - Replace string keys with packed integer keys where world bounds permit.
   - Pool node objects or use typed arrays for larger maps.

6. Precomputed surface grid
   - `findPath` repeatedly resolves standing height from voxel samples.
   - Maintain a nav surface cache per chunk/cell, invalidated by voxel edits,
     mechanisms, and terrain changes.
   - Pathfinding then reads nav cells instead of probing voxels each search.

7. Local steering before repath
   - For short dynamic blockages, use local avoidance/side-step first.
   - Repath only after a timed failure.
   - This reduces path churn in crowds.

Recommended order:

1. Add path metrics and path request counters.
2. Add actor spatial grid.
3. Move perception to staggered cadence.
4. Add path request queue.
5. Upgrade `findPath` data structures.
6. Add nav surface cache before editor-heavy voxel edits.

## Dynamic Collision And Physics

Current observations:

- `dynamic-collision-system` builds a list of solid characters, then checks all
  pairs for several passes.
- `rigidbody-pair-system` checks all awake rigid-body pairs.
- `physics-system` does three sweeps and a grounded probe per active body.
- `canSleepHere` and compatible-sleep checks query `Position + BoxCollider` or
  sleeping colliders during sleep decisions.
- The obstacle registry is cell-indexed, but keys are strings and buckets are
  arrays.

Optimization options:

1. Shared spatial broadphase
   - Use one XZ grid for actors and awake rigid bodies.
   - Dynamic character collision checks only neighboring cells.
   - Rigid-body pair checks only nearby body pairs.
   - Arrow and impact targeting can reuse the same grid.

2. Obstacle registry numeric keys
   - Replace string cell keys like `"x|y|z"` with packed numeric keys.
   - Reduces allocation and map lookup overhead.
   - Need a robust packing strategy for negative coords.

3. Avoid repeated object allocation in physics helpers
   - Some helpers create temporary `{ x, y, z }` and AABB objects.
   - More shared scratch objects reduce GC.
   - Must be careful with nested calls and reentrancy.

4. Sleep-decision side list
   - Instead of querying all colliders in `canSleepHere`, use a spatial grid or
     obstacle/actor broadphase.
   - Important as stones and NPC counts grow.

5. Separate round stone approximation from AABB broadphase
   - Stones use AABBs as collision proxies.
   - This is simple but creates artificial overlap/stacking cases.
   - A future sphere-vs-AABB or sphere-vs-sphere narrow phase may reduce
     correction churn and visual jitter.

Recommended order:

1. Actor/rigid-body spatial grid.
2. Reuse grid in dynamic collision and rigid-body pair system.
3. Numeric obstacle keys.
4. Physics allocation pass.

## Rendering And Scene Graph

Current observations:

- Every render frame, `render-sync-system` queries renderables twice: once for
  position and once for rotation.
- Actor and prop assets are many separate `Mesh` children. This is good for
  editability, but draw calls can grow quickly.
- Chunk remeshing is synchronous.
- Debug overlay creates many standalone scene objects.

Optimization options:

1. Single render sync query
   - Query `Renderable + Position` once and update rotation opportunistically
     when present.
   - Or maintain renderable side list.
   - Low risk, small-to-medium gain.

2. Dirty transform flags
   - Only update Object3D transforms for entities whose position/rotation
     changed in the last fixed tick.
   - Requires systems to mark movement changes.
   - More architecture work, but useful later.

3. Asset mesh combining or instancing
   - Keep editable source assets, but bake repeated static props into combined
     meshes or `InstancedMesh` groups.
   - Good candidates: repeated rocks, trees, furniture, village props, arrows
     stuck in shields/corpses.

4. Material sharing audit
   - Some asset factories create new materials per entity.
   - Shared materials reduce GPU resource count and disposal pressure.
   - Need care where color variants are required.

5. Chunk remesh workers
   - Before editor phase, move greedy meshing off the main thread.
   - Keep main thread only applying returned geometry.
   - Add a chunk rebuild budget per frame.

6. Render stats overlay
   - Show draw calls, triangles, geometries, textures, and shadow casters.
   - This should be visible alongside debug info.

Recommended order:

1. Render stats metrics.
2. Render sync single-query cleanup.
3. Debug batching.
4. Shared materials for common assets.
5. Worker remeshing before editor tooling.

## UI/HUD

Current observations:

- HUD system updates vitals, inventory, loadout, and shield state every render
  frame.
- The inventory panel rebuilds no DOM nodes during normal updates, but slot
  content is written every frame.
- Debug log panel updates only when log length changes.

Optimization options:

1. Dirty snapshots for HUD
   - Track previous vitals, inventory counters, active loadout slot, and
     inventory revision.
   - Only call DOM setters when values change.

2. Inventory revision number
   - Add `playerInventoryRevision` / `playerLoadoutRevision`.
   - Mutating systems increment it.
   - HUD updates inventory grids only when revision changes.

3. Event-style UI requests
   - Current request queue is fine for functionality.
   - Add explicit loadout/inventory mutation helpers so revisions are guaranteed
     and UI does not need to diff large objects.

Recommended order:

1. Add revisions for inventory/loadout.
2. Make HUD setters no-op if value did not change.

## Memory And Allocation

Likely allocation sources:

- Pathfinding `Node` objects, `Map<string, number>` keys, and `Vector3` path
  waypoints.
- Debug label canvas/texture rebuilds.
- Path debug geometry attribute replacement.
- Temporary AABBs/position objects in physics, collision, and impact systems.
- Repeated arrays produced by ECS queries and local filtering.

Optimization options:

- Pool path nodes and path point arrays.
- Store path points as simple numeric arrays or typed arrays instead of
  `Vector3[]` for AI paths.
- Cache debug label textures.
- Use scratch objects per system consistently.
- Replace string keys in hot maps with packed numeric keys.
- Add tests for deterministic cleanup of pooled resources.

## Proposed Optimization Phases

Phase O1: Measurement

- Add engine/system metrics.
- Add debug-visible performance panel.
- Track path requests, collision pairs, sweep counts, draw calls, and debug
  object counts.
- No gameplay behavior changes.

Phase O2: Cheap No-Behavior Changes

- HUD dirty updates and inventory/loadout revisions.
- Render sync single-query pass.
- Debug label texture cache.
- Numeric obstacle registry keys if isolated cleanly.
- Pathfinding binary heap.

Phase O3: Spatial Broadphase

- Add shared spatial grid for actors and awake rigid bodies.
- Use it in perception, dynamic collision, arrow hits, impact checks, and
  rigid-body pair checks.
- Keep debug visualization for grid cells/counts.

Phase O4: AI Work Budgeting

- Stagger perception.
- Add path request queue.
- Add path budget metrics and priority classes.
- Add optional static path cache for common routes.

Phase O5: Debug Rendering Upgrade

- Batch bounding boxes.
- Batch path lines.
- Keep labels but cache textures and reduce per-frame transform writes.
- Add debug category levels rather than removing debug.

Phase O6: Editor-Ready Voxel Performance

- Nav surface cache per chunk.
- Chunk remesh worker and rebuild budget.
- Dirty-region remeshing where possible.

## Highest-Value First Bets

1. Metrics panel with per-system timings.
2. Shared actor/rigid-body spatial grid.
3. Staggered perception and path request queue.
4. Batched debug boxes/paths.
5. Pathfinding heap and packed keys.
6. HUD/loadout dirty revisions.

These should improve village/combat-map FPS without sacrificing the debug
information needed for development.

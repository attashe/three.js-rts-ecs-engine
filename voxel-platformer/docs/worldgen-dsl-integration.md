# Worldgen DSL Native Integration

This document reviews the standalone DSL playground in
`import/voxel_world_dsl_playground/` and defines how to integrate its best ideas
into the native procedural level pipeline. The goal is not to port
`static/playground_core.js` line-for-line. The goal is a typed, deterministic
world-generation extension that can build larger and more complex locations:
landscape, underground spaces, structures, NPCs, quests, shops, pickups, travel
points, and validation from one reviewable spec.

The existing engine remains authoritative. Generated locations should compile
into `ChunkManager` voxels plus `LevelMeta`, then export through the same
`.vplevel` path as current procedural levels.

## Goals

- Let generated locations be larger and more structured than the current
  hand-authored generator functions.
- Reuse existing engine primitives: `terrain()`, `ChunkManager`,
  procedural structures, prefabs, props, `LevelMeta`, NPC templates, zones, and
  scripts.
- Refine the playground DSL into an engine-facing spec format with typed
  materials, anchors, reusable definitions, content binding, and validation.
- Make generated locations editor-saveable and human-refinable after export.
- Produce deterministic reports so authors and agents can review generated
  anchors, placements, warnings, validation results, and hashes.

Non-goals for the first implementation:

- No runtime infinite generation.
- No new quest runtime.
- No separate voxel palette or marker-block gameplay layer.
- No direct dependency on the playground's browser compiler.

## Playground Review

The playground is a compact deterministic compiler for static voxel worlds. It
supports two useful families of generation:

- Surface worlds: height noise, mountain peaks, cliff bands, flatten discs,
  road splines, anchors, structures, scatter, and path validation.
- Underground worlds: solid volume fill, strata, shafts, ellipsoid chambers,
  rectangular rooms, mine networks, noise-tube connectors, canyons, guaranteed
  paths, scatter, surface queries, and validation.

### Strengths To Preserve

- Deterministic seed model. The compiler uses stable hash/RNG helpers and
  reports a world hash.
- Clear semantic primitives. A spec can say "road", "shaft", "chamber",
  "scatter pines", or "required path" instead of hand-writing voxel loops.
- Useful reports. Placement lists, validation results, errors, and metrics make
  generated output inspectable.
- Anchor-based authoring. Named anchors and object access points are the right
  abstraction for generated content.
- Surface and underground separation. The distinction maps well to separate
  native compiler modules.
- Path validation. The idea is essential for generated quests and travel, even
  though the native implementation should use engine pathfinding.
- Reservation-aware scatter. Deterministic scatter plus footprint checks is the
  right basis for forests, villages, props, encounters, and resource nodes.

### Problems To Fix

- Separate world model. The playground owns a `World` class and a monolithic
  `Uint8Array` grid. Native generation must write to `ChunkManager`.
- Separate semantic palette. The prototype has its own 26-block vocabulary.
  Native generation must use engine `BLOCK` values and material traits.
- Marker voxels for gameplay. Spawn, player, portal, shrine, and similar
  gameplay concepts should compile to metadata, zones, props, structures, or
  scripts, not special marker voxels.
- Hard-coded asset branches. `pasteAsset` couples asset IDs to hand-written
  block stamping. Native structures should route through `StructureSource`,
  `generateStructureAsset`, `placeStructureAsset`, prefabs, props, and zones.
- No interactivity layer. The playground has no NPCs, quests, shops, scripted
  triggers, cinematics, weather, or travel metadata.
- Mixed coordinate conventions. Surface coordinates, underground points,
  anchors, objects, access points, and rooms need explicit native types.
- Post-hoc validation only. The native compiler should validate before and
  after compilation, and should use engine movement/pathing assumptions.
- Monolithic compiler. Native code should be modular enough to test each
  primitive without compiling a full location.
- Limited composition. Large locations need reusable definitions and
  parameterized place templates, not only one flat list of primitives.

## Current Engine Integration Points

The native compiler should build on the current procedural pipeline:

- Voxel storage: `ChunkManager` and sparse 32-cell chunks.
- Palette: `BLOCK` and palette traits in `src/engine/voxel/palette.ts`.
- Terrain authoring: `terrain(chunks, { size, groundY })`,
  `heightfield`, `fill`, `platform`, `stairs`, `path`, `pond`, masks, and
  noise helpers under `src/game/level-builder/`.
- Metadata: `defineLevel`, `outdoorDay`, `zoneBox`, and `interactZone`.
- Structures: `generateStructureAsset`, `measureStructurePlacement`,
  `placeStructureAsset`, `structurePropPlacements`, `prefabSource`, and
  `proceduralSource`.
- NPCs: `NpcConfig`, `normalizeNpcConfig`, NPC templates, and behavior script
  generation.
- Scripts: existing `ScriptEntry` source strings and the script API for flags,
  dialogue, trade, NPC behavior, pickups, audio, travel, pistons, props, zones,
  weather, and cinematics.
- Validation: `findPath` from `src/engine/voxel/voxel-path.ts`.
- Export: `createProceduralEditorLevel`, `editorMetaFromRuntimeLevel`, and
  `serializeLevel`.

The important architectural rule is simple: the worldgen compiler emits the
same artifacts hand-written procedural levels already emit.

## Refined WorldSpec

The DSL should be a typed spec format expressed in engine terms. JSON should be
supported for tool and agent authoring, while TypeScript definitions should be
the source of truth.

Illustrative shape:

```ts
export interface WorldSpec {
    version: 1
    world: {
        id: string
        name: string
        type: 'surface' | 'underground' | 'hybrid'
        seed: string
        size: [number, number, number]
        defaultGroundY?: number
    }
    defs?: Record<string, unknown>
    materials?: Record<string, keyof typeof BLOCK>
    terrain?: SurfaceSpec
    volume?: VolumeSpec
    carvers?: CarverSpec[]
    connectors?: ConnectorSpec[]
    paths?: PathSpec[]
    anchors?: AnchorSpec[]
    structures?: StructurePlacementSpec[]
    scatter?: ScatterSpec[]
    content?: ContentSpec
    validation?: ValidationSpec
}
```

Key refinements over the playground:

- Materials map to engine block names or declared aliases.
- Spawn, portals, shops, quest objects, NPCs, and triggers are metadata/content.
- Every generated gameplay object has a stable ID.
- Placement supports explicit coordinates and anchor-relative references.
- Content binds to anchors, structures, rooms, paths, and access points by ID.
- `defs` and `$ref` allow reusable village blocks, cave clusters, encounter
  packs, shop rows, and quest templates.
- Validation rules operate on resolved anchors and emitted metadata, not only
  raw voxels.

### Coordinate Policy

Use explicit coordinate kinds instead of overloading arrays:

- `xz`: horizontal terrain coordinate.
- `xyz`: voxel/world coordinate.
- `anchor`: named resolved location.
- `surface_at_xz`: find standable surface at an XZ coordinate.
- `room_center`: center of a carved room feature.
- `object_access`: access point reported by a placed structure.
- `path_point`: point sampled along a generated path.
- `feature_surface`: floor, wall, or ceiling point in an underground feature.

The compiler report must include resolved coordinates for every anchor and
placed object so scripts and content are never forced to guess numbers.

## Native Compiler Architecture

Add a package under `src/game/worldgen/`.

Implemented modules:

- `spec-types.ts`: public spec, normalized spec, and report types.
- `normalize-spec.ts`: defaulting, `$ref` expansion, ID checks, and reference
  collection.
- `material-map.ts`: material aliases to engine `BLOCK` values.
- `rng.ts`: stable hash, seeded random, and world hash helpers.
- `compile-context.ts`: shared access to the normalized spec, chunk manager,
  material resolution, keyed random, bounds checks, and report mutation.
- `surface-grid.ts`: surface-height sampling, column rewrites, and footprint
  sampling.
- `compile-surface.ts`: surface heightfields, roads, cliffs, peaks, terraces,
  flattening, paths, surface anchors, and surface validation.
- `asset-registry.ts`: maps stable DSL asset ids to engine prefab/procedural
  structure sources.
- `surface-structures.ts`: structure placement, group placement, scatter,
  footprint reservation, prop recovery, and placement diagnostics.
- `level-draft.ts`: mutable `LevelMeta` draft used while compiler phases add
  zones, props, NPCs, scripts, and other engine metadata.
- `resolve-content.ts`: MVP content compiler for props, zones, NPCs, and
  explicit scripts.
- `content-common.ts`: shared rich-content placement, target lookup,
  diagnostics, and generated-script helpers.
- `resolve-pickups.ts` / `resolve-shops.ts` / `resolve-quests.ts`: rich
  content compilers that emit ordinary `ScriptEntry` source or NPC
  `scriptSource` snippets.
- `resolve-content-metadata.ts`: direct mapping for cinematics, environment,
  sound/weather metadata, and travel zones.
- `compile-underground.ts`: native underground compiler for volume fill,
  strata, rooms, shafts, tunnels, canyons, mine networks, and underground
  scatter.
- `validate.ts`: shared required-path validation using engine `findPath`.
- `compile-world.ts`: orchestration API.
- `compile-result.ts`: shared finalization for world hash, metrics, and
  normalized compile results.

Planned modules:

- `carve3d.ts`: reusable 3D carving primitives.
- `compile-world-cli.ts`: JSON spec input, schema validation, report output,
  and `.vplevel` export.
- Rich validation extensions beyond required paths: required objects, emitted
  metadata checks, and content reference checks.

Public API:

```ts
export interface WorldgenCompileResult {
    chunks: ChunkManager
    meta: LevelMeta
    report: WorldgenReport
}

export function compileWorldSpec(
    spec: WorldSpec,
    opts?: WorldgenCompileOptions,
): WorldgenCompileResult
```

The compiler should be deterministic for the same spec, seed, and engine
version. When generation must skip a non-required placement, it should emit a
warning, not silently degrade the result.

## Primitive Mapping

| Playground primitive | Native implementation |
| --- | --- |
| `terrain.base_height` plus noise | `terrain().heightfield(...)` with engine noise helpers |
| `mountain_peak` | Masked height contribution with roughness, material paint, optional snowline material alias |
| `flatten_disc` | New terrain flatten helper over a circle/ellipse mask with blend shoulder |
| `cliff_band` | Height offset along a segment/path mask with face-side falloff |
| `road_spline` | `terrain().path(...)` plus optional grade smoothing and shoulder material |
| `volume.initial: solid` | Bulk fill of bounded volume through `ChunkManager.withBulkEdit` |
| `strata` | Per-Y material bands during volume fill |
| `vertical_shaft` | Cylinder/rough cylinder carve, optional stairs/ladder/rail/lift socket |
| `chamber_ellipsoid` | Ellipsoid carve with roughness, floor flatten, surface classification |
| `rect_room` / `dwarf_room` | Rectangular clear space with floor material, pillars, lights, and sockets |
| `mine_tunnel_network` | Orthogonal corridor carves with rails, supports, lanterns, and room connections |
| `noise_tube` | Spline or segment tube carve with noise offsets and walkable floor stamping |
| `underground_canyon` | Wide spline carve, wall roughness, ledges, crossing sockets, cleanup pass |
| `main_paths` | Guaranteed walkable route stamping, then path validation |
| `anchors` | Resolved coordinate records, plus optional reservation and terrain patch |
| `structures` | Engine structure assets or prefabs with footprint checks |
| `scatter` | Deterministic placement over masks/features using asset measurement |
| `validation.require_paths` | Engine `findPath` with actor movement settings |

## Content Layer

The playground has no interactivity. The native extension should add content as
first-class spec data, then compile it into existing engine metadata.

Current MVP content categories:

- `npcs`: emit `NpcConfig`; optional template ID; optional behavior config;
  optional script source.
- `zones`: emit trigger, interact, arrival, portal, or custom zones. Portal
  zones fail closed: a missing destination is a report error and does not emit
  a broken runtime zone.
- `props`: emit `EditorProp` placements with resolved object ids.
- `scripts`: emit explicit `ScriptEntry` source.

Remaining rich content categories:

- `quests`: compile small state-machine scripts using flags, pickups, dialogue,
  rewards, and stable IDs.
- `shops`: compile trade-opening scripts using current `TradeResource` values.
- `pickups`: emit coin piles or script-spawned pickup bootstrap code.
- `cinematics`: emit current cinematic metadata.
- `environment`: emit ambient music and weather state.
- `travel`: emit portal zones and arrival zones.

The content compiler should not introduce a second quest engine. It should
generate ordinary `ScriptEntry` source that uses the same patterns as existing
example scripts: idempotent `level-start`, `flags`, `ui.dialogue`,
`trade.open`, `pickups.spawn`, `zone`, `travel`, and `npc` calls.

## Example Translations

These are not final JSON files. They describe how the four playground examples
should map to the refined spec.

### Surface Valley

Original: `static/surface_example.json`.

Native version:

- World: `surface`, `64 x 32 x 64`, seed `demo/world-001`.
- Terrain: base grass heightfield with noise.
- Features: `north_cliff` as `cliff_band`; `pilgrim_road` as `road_spline`.
- Anchors: `spawn`, `portal_plaza`.
- Structures: blue portal prefab bound to `portal_plaza`; hermit cottage as a
  procedural house with footprint flattening.
- Scatter: pine trees with road-distance and reservation masks.
- Content: optional hermit NPC at cottage access point; portal zone emitted as
  metadata.
- Validation: player path from `spawn` to portal and cottage.

### Mountain Village

Original: `static/mountain_village_example.json`.

Native version:

- World: `surface`, `128 x 72 x 128`, seed
  `demo/surface-mountain-village-001`.
- Terrain: mountain peak, village terrace, upper meadow, spiral road.
- Anchors: spawn, village square, upper viewpoint.
- Structures: portal, shrine, cabins, lodge, all using engine structure assets.
- Scatter: mountain pines filtered by road distance, slope, reservation, and
  elevation.
- Content: village NPCs and shops can bind to cabin/lodge access points.
- Validation: required paths from spawn to village square, viewpoint, shrine,
  and portal.

### Dungeon

Original: `static/dungeon_example.json`.

Native version:

- World: `underground`, `96 x 48 x 96`, seed `demo/dungeon-001`.
- Volume: dark stone/dark limestone/rootbound dirt strata.
- Carvers: entrance shaft, echo cavern, mushroom grove, deep canyon, crystal
  vault.
- Connectors: noise tubes between critical rooms.
- Main path: guaranteed route through critical path.
- Structures: broken bridge at canyon crossing, moon shrine, portal in vault.
- Scatter: glow mushrooms, wall crystals, stalactites.
- Content: optional hostile encounters or lore NPCs bound to room anchors.
- Validation: required path from spawn to portal; optional path to shrine.

### Mineshaft Village

Original: `static/mineshaft_example.json`.

Native version:

- World: `underground`, `112 x 56 x 112`, seed
  `demo/mineshaft-dwarf-village-001`.
- Volume: solid strata.
- Carvers: entrance lift, entry hub, open caves, dwarf hall, living rooms,
  forge, storage, portal vault.
- Connectors: mine tunnel network and noise tubes.
- Details: rails, supports, lanterns, room floors, room props, forge details.
- Structures: dwarf living, forge, storage, shrine, portal.
- Content: trader, forge shop, storage quest, miners, guards, and portal
  travel.
- Validation: paths to living rooms, forge, storage, shrine, and portal.

## Phased Roadmap

### Phase 1 - Documentation And Example Translation

Create this source-of-truth design doc, capture the critical review, refine the
DSL, and translate the playground examples into engine-facing intent.

Acceptance criteria:

- A reader can understand the playground and the native plan without opening
  the playground files first.
- Every playground primitive has a native equivalent or a clear defer decision.
- The refined DSL covers terrain, underground, structures, scatter, anchors,
  content, and validation.
- The roadmap is implementation-ready.

### Phase 2 - Foundation Types And Reports

Add `src/game/worldgen/` with spec/report types, normalization, material map,
and deterministic RNG/hash helpers. This phase does not write voxels, emit
`LevelMeta`, register procedural levels, or expose `compileWorldSpec` yet; that
waits until the surface compiler can produce honest chunks and metadata.

Acceptance criteria:

- Unknown materials, duplicate IDs, and missing required top-level fields fail
  clearly.
- Known sections have the expected object/array shape, and ID-bearing entries
  must declare stable IDs before later compilers see them.
- Reports are deterministic and include status, warnings, errors, metrics,
  empty anchor/placement/validation collections, and a `specHash`.
- `$ref` composition is explicitly rejected as unsupported until the macro
  design is implemented.
- Tests cover normalization, material mapping, ID validation, report status,
  and hash helpers.

### Phase 3 - Surface MVP

Compile the surface valley example natively.

Acceptance criteria:

- Surface compilation consumes `NormalizedWorldSpec` only. Raw user input must
  pass through Phase 2 normalization first.
- Introduce a small compile context that owns `ChunkManager`, material
  resolution, bounds checks, report mutation, and deterministic keyed random
  helpers. Feature code should not mutate reports ad hoc.
- Add `compileSurfaceWorld(spec, opts)` returning `{ chunks, meta, report }`.
  The report gains `worldHash` and `resolvedObjects` so generated chunks,
  metadata, anchors, and structure access points can be compared
  deterministically.
- Phase 3 is a square-world MVP. It rejects rectangular X/Z worlds until
  `LevelMeta.size` and the terrain frame support rectangular dimensions.
- Heightfield, cliff band, road spline, flatten disc, mountain peak, anchors,
  spawn, and required path validation work from the normalized spec.
- Include a narrow surface-example structure/scatter bridge: portal gate,
  hermit cottage, and compact pine scatter. The broad asset registry,
  advanced overlap policy, and general scatter system remain Phase 4.
- Portal structures emit inactive marker zones only. Real travel binding stays
  in the content/pipeline phases.
- Unsupported surface feature types fail as report errors rather than being
  ignored.
- The generated output exports through existing `.vplevel` serialization.
- Tests assert deterministic hash, anchor resolution, scatter count, and path
  validation.

### Phase 4 - Structures And Scatter

Status: implemented and checkpointed.

Generalize the asset registry and scatter placement for villages, forests,
prop clusters, and structure groups. Phase 4 keeps the compiler native: specs
resolve into existing `prefabSource` / `proceduralSource` values, assets are
measured with the procedural-structures package, and placements mutate the same
Phase 3 compile context/report.

Implementation shape:

- `surface-grid.ts` owns surface-height sampling, terrain-column rewrites, and
  footprint sampling so terrain and placement code share one grid contract.
- `asset-registry.ts` maps DSL ids to engine assets. Legacy ids remain stable:
  `fixed.portal.blue_stone`, `proc.house.hermit_cottage`, and `proc.tree.pine`.
  General ids now include `prefab.<prefab-id>`, `proc.house.<style>`,
  `proc.tree.<style>`, `proc.tower.<style>`, and `proc.wall.<style>`.
- `surface-structures.ts` owns structure placement, group placement, weighted
  scatter, reservation checks, prop recovery, and placement diagnostics.
- `compile-surface.ts` stays focused on surface terrain, anchors, orchestration,
  validation, and final report/metadata assembly.

Acceptance criteria:

- Structure/scatter placement consumes resolved anchors and compile-context
  services from Phase 3 rather than re-reading raw placement coordinates.
- Structure specs resolve to `prefabSource` or `proceduralSource` through a
  central registry that can classify portals, trees, houses, towers, walls,
  shops, forges, and generic prefabs for report and access-point behavior.
- Placement uses `measureStructurePlacement` and `placeStructureAsset`.
- Footprint reservation prevents overlap.
- Prop recovery through `structurePropPlacements` is preserved.
- Structure groups support a parent `place_at` / `place_at_xz`, parent rotation,
  per-child `offset_xz`, child rotation, inherited `auto_y`, and stable
  resolved object ids such as `village_core.well`.
- Scatter supports either one `asset` or weighted `assets[]`, deterministic
  asset choice, deterministic rotations, footprint-aware candidate checks, and
  explicit skip reasons (`bounds`, `reserved`, `road`, `slope`, `elevation`,
  `mask`, `placement`, `asset`).
- Scatter reports requested, candidates, placed, skipped, `skippedByReason`,
  and warning counts.
- Unsupported structure assets and invalid scatter masks produce explicit
  report diagnostics instead of silently dropping content.
- Tests cover prefab shop prop recovery, procedural tower placement, grouped
  structures, weighted scatter rotations, skip reason reporting, and the legacy
  Phase 3 valley spec.

### Phase 5 - Orchestration And Content MVP

Status: implemented as the architecture bridge before underground work.

This phase introduces the public compiler entrypoint and the first usable
content compiler without creating a parallel runtime model. Surface generation
still owns terrain; shared finalization owns hashes and metrics; content
resolves into a mutable `WorldgenLevelDraft` that emits ordinary `LevelMeta`.

Implementation shape:

- `compileWorldSpec(spec, opts)` normalizes raw specs and dispatches by
  normalized `world.type`.
- `compileNormalizedWorldSpec(spec, opts)` is the internal typed dispatcher.
- Phase 5 originally failed non-surface worlds explicitly. After Phase 6,
  `underground` dispatches to the native compiler and `hybrid` remains the
  only unsupported world type.
- `compile-result.ts` owns inert fallback metadata, shared chunk allocation,
  fail-fast checks, world hashing, and final metric counts.
- `WorldgenLevelDraft` is the only intermediate metadata surface. It mirrors
  existing `LevelMeta` fields and finishes through `defineLevel`.
- `resolve-content.ts` compiles MVP content in this order: props, zones, NPCs,
  scripts. Later content may bind to earlier content ids through
  `resolvedObjects`.
- Forest Lift Valley uses content specs for its road sign, lift props, levers,
  wagon scene, repair crate, arrival/interact zones, and Brann NPC. Its custom
  quest script, piston mechanism, intro cinematic, rabbits, and starter player
  settings remain in the procedural wrapper because they are not generic
  content compilers yet.

Acceptance criteria:

- `compileSurfaceLevelOrThrow` routes through `compileWorldSpec`, so procedural
  levels use the same public orchestration path as future JSON specs.
- Normalization failures return a failed report plus inert fallback metadata,
  not thrown exceptions from the public compiler.
- Unsupported world types fail with explicit diagnostics and inert metadata;
  after Phase 6 this applies to `hybrid`.
- MVP content supports `place_at`, `place_at_xz`, offsets, resolved object ids,
  and placement report entries.
- Props validate against known `PROP_KINDS`.
- Zones support arrival, interact, portal, trigger/custom kinds, active flags,
  trigger sources, prompts, and portal destinations. Invalid required portals
  do not emit broken runtime zones.
- NPCs support template application, direct config overrides, equipment,
  voices, behavior-to-script merging, and custom script source.
- Explicit content scripts emit `ScriptEntry`.
- Metrics count emitted metadata (`meta.npcs`, `meta.zones`, `meta.scripts`)
  rather than broad spec intent.
- Focused tests cover successful content compilation, unsupported world types,
  normalization fallback metadata, and invalid portal fail-closed behavior.

### Phase 6 - Underground MVP

Compile the dungeon and mineshaft examples natively.

Status: implemented as a native `NormalizedWorldSpec` compiler in
`src/game/worldgen/compile-underground.ts`.

Acceptance criteria:

- Underground compilation reuses the same report, material, bounds, and
  deterministic RNG context introduced for surface compilation.
- Volume fill, strata, shafts, chambers, rooms, tunnels, canyons, mine networks,
  main path stamping, surface queries, and underground scatter work.
- Required underground paths validate with `findPath`.
- Reports include carver, connector, structure, scatter, resolved object, and
  validation entries. Raw feature surface sets remain compiler-internal so the
  report stays stable and compact.
- Underground features compile into the same `WorldgenLevelDraft` and
  `finishWorldgenCompile` path as surface worlds.

Implemented scope:

- `compileWorldSpec` dispatches `world.type: "underground"` to the native
  underground compiler; `hybrid` remains explicitly unsupported until the
  surface/underground merge contract is designed.
- Solid volume fill and strata write directly through the shared
  `WorldgenCompileContext`, material resolver, bounds checks, keyed RNG, and
  diagnostics.
- Supported carvers are `vertical_shaft`, `chamber_ellipsoid`, `rect_room`,
  `dwarf_room`, `mine_tunnel_network`, and `underground_canyon`.
- Supported connectors are `noise_tube`; guaranteed walkable routes use
  top-level `main_paths`.
- Underground structures support metadata markers, portal gates, bridge
  sockets, shrine decor, and dwarf room decor. Full prefab growth should move
  into a reusable underground asset registry in a later phase.
- Underground scatter supports passable glow mushrooms, wall crystals, and
  stalactites with deterministic candidate scoring and minimum-distance
  filtering.
- Required path validation uses the shared `findPath` validator, so surface and
  underground specs fail through the same report path.

Known limits to keep in the next phase plan:

- The MVP compiler still assumes square X/Z worlds because `LevelMeta.size` is
  scalar.
- `hybrid` worlds are not merged yet.
- Feature surface sets are local compiler indexes, not report payloads or
  stable external API.
- Some underground decor is stamped in the compiler as temporary lightweight
  assets; future work should move it behind the same asset-source registry used
  by surface structures.

### Phase 7 - Rich Content Compilers

Compile higher-level interactive content into existing engine metadata and
scripts. This builds on the MVP content resolver rather than replacing it.

Status: implemented as focused content resolvers that compile to existing
`LevelMeta`, NPC `scriptSource`, and plain `ScriptEntry` source.

Acceptance criteria:

- NPCs continue to compile to `NpcConfig` with behavior scripts where
  requested.
- Shops compile to `trade.open` scripts. NPC-bound shops append an NPC script
  snippet; zone-bound shops emit a level script.
- Collect-and-return quests compile to idempotent state machines using
  `flags`, `pickups.spawn`, `pickup-taken`, `ui.dialogue`, rewards, and
  stable ids.
- Pickups compile to idempotent startup scripts with per-pickup collected
  flags, stable pickup ids, and durable inventory metadata.
- Cinematics, level environment, sound sources, sound zones, weather zones, and
  travel zones compile into existing metadata arrays.
- Content reference validation detects missing NPC/zone/prop ids before
  scripts are emitted.
- Tests run generated scripts with stub facades for at least one generated
  quest and shop.

Implemented scope:

- `resolve-content.ts` remains the orchestration point and keeps the original
  prop, zone, NPC, and raw script behavior.
- `content-common.ts` owns shared position resolution, required/optional
  diagnostics, target lookup, runtime script-id collision checks, generated
  script insertion, and replacement of worldgen-marked NPC template starter
  scripts.
- Rich generated scripts deliberately use the existing script API instead of a
  new quest/trade runtime.
- Required rich content entries fail closed. Optional entries warn and skip.
- Metadata content uses the same `place_at` / `place_at_xz` placement contract
  as props, zones, NPCs, pickups, and travel entries.
- Pickup persistence is based on explicit per-pickup taken flags. Inventory
  checks can suppress startup spawning, but they must not mark authored pickups
  as permanently taken.
- Generated dialogue and cinematic payloads are validated before scripts or
  metadata are emitted.

Known limits to keep in the next phase plan:

- Quest compilation supports the collect-and-return pattern only.
- Generated shops and quests target NPCs or interact zones; arbitrary props
  still need an interact zone.
- Pickup persistence is flag-based inside generated scripts, not a separate
  world persistence layer.
- Rich content does not yet include a JSON schema or CLI report output; that
  remains Phase 8.

### Phase 8 - Pipeline And Export

Add authoring/export utilities and register one generated spec as a procedural
level.

Status: implemented as a JSON-spec-to-editor-level pipeline.

Implementation shape:

- `src/editor/worldgen-level-export.ts` is the reusable bridge from
  `WorldSpec` to editor-saveable output. It calls `compileWorldSpec`, adapts
  runtime `LevelMeta` through `editorMetaFromRuntimeLevel`, and serializes a
  `.vplevel` buffer only when the compiler report is not failed.
- `scripts/compile-world-spec.ts` is the authoring CLI. It accepts a JSON spec,
  writes a stable report JSON, writes a `.vplevel` for ok/warning reports, and
  exits non-zero for invalid JSON or failed compiler reports.
- `schemas/worldspec.schema.json` provides broad authoring assistance for JSON
  files without replacing TypeScript normalization and compiler diagnostics.
- `examples/worldgen/phase8-pipeline-sample.json` is the first checked-in JSON
  spec. It compiles a small surface road scene with anchors, a cottage,
  deterministic tree scatter, props, an interact sign, NPCs, a shop, a
  collect-and-return quest, pickups, cinematic metadata, ambience, travel
  zones, and required path validation.
- `worldgen-pipeline-sample` is registered in
  `PROCEDURAL_LEVEL_DEFINITIONS`, so the normal procedural export command emits
  `public/levels/worldgen-pipeline-sample.vplevel` beside code-authored
  locations.
- `scripts/file-output.ts` shares idempotent file-writing helpers between the
  worldgen CLI and the existing procedural export script.

Acceptance criteria:

- A CLI can compile a JSON spec, write a report, and export `.vplevel`.
- The CLI reports resolved anchors, resolved objects, placements, validation,
  metrics, warnings, and world hash in a stable machine-readable format.
- Generated levels can be loaded in game and refined in the editor.
- Existing procedural levels remain unchanged.
- The Forest Lift Valley production-slice level remains a compatibility test
  for the code-authored path while JSON specs are introduced.

Implemented scope:

- CLI usage:

  ```bash
  npm run worldgen:compile -- examples/worldgen/phase8-pipeline-sample.json
  npm run worldgen:compile -- examples/worldgen/phase8-pipeline-sample.json --out public/levels/worldgen-pipeline-sample.vplevel --report .tmp/worldgen/worldgen-pipeline-sample.report.json
  ```

- Valid and warning reports export levels; failed reports write diagnostics and
  suppress broken level output.
- JSON parse errors produce a report with `specId: "invalid-world-spec"` and a
  deterministic hash over the input path/source.
- Procedural export still owns tracked level artifacts. The CLI is primarily an
  authoring and inspection tool; it does not register levels by itself.
- Tests cover editor serialization, procedural registration, valid CLI output,
  failed CLI output, and warning-preserving CLI output.

Critical review findings fixed after implementation:

- The public compiler/export boundary now accepts `unknown`, not only
  `WorldSpec`. JSON files and imported JSON modules flow through the same
  normalizer as code-authored specs, so call sites no longer need unsafe casts
  to satisfy tuple types.
- Worldgen-authored local FX zones validate `presetId` against the runtime
  `ZONE_PRESETS` registry before export. Unknown required presets fail closed;
  optional entries can be downgraded by the usual content-required policy.
- Metadata placement now accepts `offset_y` / `offsetY` in addition to `dy`.
  This makes vertical placement explicit for effects that should be centered
  above the surface, such as falling leaves.
- Shared file-output helpers now derive relative paths with `path.relative`
  instead of checking a raw string prefix.

Known limits to keep in the next phase plan:

- The schema is intentionally permissive. It catches authoring shape mistakes,
  but compiler normalization remains authoritative.
- The sample spec targets a small surface world. It proves the pipeline, not
  large-location streaming or hybrid terrain.
- Reports are emitted by the standalone CLI only. The editor does not yet show
  report diagnostics or resolved anchor coordinates in a dedicated UI.
- `PROCEDURAL_LEVEL_DEFINITIONS` still uses code registration. A future phase
  can add a manifest-driven registry once JSON-authored production locations
  are common enough to justify it.

### Phase 9 - Large-Location Readiness

Keep v1 author-time compiled and resident, but design the spec/report so it can
later target region generation.

Updated starting state after the Phase 8 review:

- The compiler pipeline is now a safe JSON boundary: CLI input, imported JSON,
  and code literals all enter as `unknown` and are normalized before dispatch.
- The export path can serialize ok and warning reports, while failed reports
  suppress `.vplevel` output.
- The first JSON sample is registered and exported, but it is still intentionally
  small. It proves the artifact pipeline and rich-content metadata, not scale.
- Runtime FX preset ids used by generated content are validated at compile
  time. Future generated ambience should follow this rule for other runtime
  registries as well: fail before export when a runtime id is unknown.
- Hand-authored procedural locations remain the compatibility baseline. Forest
  Lift Valley and Teleport Garden should keep passing unchanged while JSON specs
  grow more capable.

Acceptance criteria:

- Specs avoid assumptions that prevent future region streaming.
- Reports include chunk/region metrics.
- Large-world risks from `docs/large-worlds-plan.md` are documented before any
  runtime streaming work begins.
- Phase 9 does not introduce runtime streaming yet. It should stay author-time
  compiled and resident, but make generated outputs and reports region-aware:
  stable chunk keys, region grouping metrics, voxel/write density summaries,
  and explicit warnings for worlds that exceed comfortable resident budgets.
- Add at least one larger JSON stress spec or generated test fixture that
  compiles through the CLI without being registered as a normal game location.
  It should exercise roads, scatter, structures, content references, and path
  validation at a larger footprint than the Phase 8 sample.
- Keep the schema broad, but add report-driven guardrails before more DSL
  expressiveness: region metrics, object counts, placement-skip rates, and
  validation summaries should be sufficient for an authoring agent to iterate
  without opening the editor first.

Phase 9 implementation direction:

- Region readiness is a report contract, not a save/load contract. The compiler
  still emits one resident `ChunkManager` and, for exported specs, one ordinary
  `.vplevel`.
- Reports group stored chunks into report-only X/Z regions using 8x8 chunk
  regions, matching the future `large-worlds-plan.md` direction without
  versioning a region file format yet.
- `WorldgenReport.metrics` now includes chunk bounds, region size, region
  count, and per-region chunk/non-air voxel summaries. These numbers are for
  authoring feedback and automated review.
- The compiler emits a non-failing `resident_world_budget` warning when a
  generated world exceeds the current comfortable resident footprint:
  `chunkCount > 96`, `writtenVoxels > 1,500,000`, or `regionCount > 4`.
- `scripts/compile-world-spec.ts --report-only` compiles a JSON spec and writes
  the report without serializing or writing a `.vplevel`. This is the preferred
  loop for stress fixtures and large authoring iterations.
- `examples/worldgen/phase9-region-stress.json` is the first large JSON stress
  fixture. It exercises roads, scatter, structures, content references,
  environment metadata, and path validation, but is intentionally not registered
  as a normal playable location.
- The generated-level falling-leaves regression fixed before this phase was a
  render initialization/lifecycle issue. Phase 9 should not add false placement
  restrictions for FX zones; runtime registry validation remains the right
  worldgen guardrail for FX metadata.

## Architecture Review And Deferred Debt (post Phase 8/9 checkpoint)

A full architectural review of the Phase 5→9 pipeline lives in
`docs/worldgen-architecture-review.md`. It rates the direction sound and
disciplined (the "no parallel runtime / emit the same artifacts hand-authored
levels emit" rule held across all content phases). Outcomes recorded here so the
roadmap reflects reality:

Landed since the review:

- **Rectangular worlds (review item H1).** `LevelMeta`/`LevelSpec` gained optional
  `sizeX`/`sizeZ` that default to the scalar `size` (square stays the
  zero-change path). The surface grid and both compilers are now per-axis; the
  square-only guards are gone. This is the enabler for non-square region
  footprints — the world shape is the chunk geometry (the editor and serializer
  never depended on a square `size`), so it is a back-compat, geometry-true
  change.
- **Shared `isRecord` util** (`worldgen-util.ts`) and a single `scriptIdent`
  (in `content-common.ts`, alongside the documented "all interpolated runtime
  values go through `scriptLiteral`" invariant).
- **Draft drift guard.** `WorldgenLevelDraft` now fails to compile if it stops
  covering every `LevelSpec` field, so generated levels can't silently drop a
  new level field.

Remaining future work (intentionally deferred — do not block production on
these):

- Richer macro syntax beyond simple object reuse. Phase 11 adds practical
  `defs`/`$ref`, but not loops, parameters, conditionals, or expression
  evaluation.
- Full content dependency graphs for future generated script categories. Phase
  11 removes order dependence for spatial content placement and current
  shop/quest targets, while keeping deterministic metadata/script emission.

Resolved in Phase 10:

- **Bounded world hash (review H2).** Chunks now maintain a `contentHash` as
  voxel data changes, and worldgen finalization mixes sorted chunk coordinates,
  `nonAirCount`, and `contentHash` instead of scanning every allocated voxel.
  This intentionally changes `report.worldHash` values once while preserving
  generated chunks and metadata.
- **Split `compile-underground.ts` (review M3).** The underground compiler is now
  an orchestration entrypoint backed by `underground-volume`,
  `underground-carvers`, `underground-surfaces`, `underground-structures`,
  `underground-scatter`, `underground-stamping`, `underground-types`,
  `worldgen-math`, and `worldgen-parse`.
- **Tighten public surface (review L8).** `index.ts` keeps the authoring-facing
  APIs; white-box compiler entrypoints moved to `internal.ts`.

Resolved in Phase 11:

- **Authoring composition (review L7).** Normalization now expands local
  `#/defs/...` `$ref` objects before ID/material validation and before any
  compiler sees the spec. Local fields override referenced fields, nested plain
  objects merge, arrays replace, and `defs` are removed from
  `NormalizedWorldSpec` so `specHash` reflects expanded semantics.
- **Order-independent spatial content (review M6, practical scope).** Content
  resolution now builds a spatial declaration index for props, zones, NPCs,
  pickups, and travel entries. `place_at` may target those IDs regardless of
  category or array order, with cycle detection and fail-closed diagnostics.
- **Generated-script hardening.** Quest, shop, and pickup script emitters share
  helpers for generated constants, line assembly, and script-entry naming. The
  invariant remains: all author/runtime values go through `scriptLiteral`, and
  only `scriptIdent` output may become raw identifiers.
- **Authoring-scale fixture.** `examples/worldgen/phase11-authoring-scale.json`
  is a report-only JSON fixture that exercises `defs`, nested `$ref`, forward
  content placement, shop/quest generation, ambience, travel, and path
  validation without registering a new playable level.

Recommended sequence from here (the linear Phase 1→9 build is effectively
complete; this is the forward plan the review and the rectangular-worlds work
imply):

- **Phase 10 — Stabilize before scale (behaviour-preserving).** Implemented:
  bounded world hashing, underground compiler split, and public surface
  tightening. Generated `.vplevel` bytes remain stable; `report.worldHash`
  intentionally changed because the digest algorithm changed.
- **Phase 11 — Authoring scale.** Implemented: `defs`/`$ref` object
  composition, order-independent spatial content references, generated-script
  helper hardening, and a report-only authoring-scale fixture.
- **Phase 12 — Runtime scale.** Region footprints (now expressible thanks to
  rectangular worlds) → optional streaming. Research note: the world shape is
  the chunk geometry — the editor and serializer never depended on a square
  scalar `size` — so region streaming is less risky than the original
  `large-worlds-plan.md` framing assumed. Still gate the streaming work on a
  concrete world-size need, not on capability for its own sake.

## Detailed Phase 1 Work

Phase 1 is intentionally documentation-only. It should turn the design from a
conversation into a durable artifact.

Tasks:

1. Add this document at `docs/worldgen-dsl-integration.md`.
2. Record the playground review with concrete strengths and weaknesses.
3. Describe native engine integration points and make the "no parallel runtime"
   rule explicit.
4. Define the refined `WorldSpec` direction and coordinate policy.
5. Map every playground primitive to a native implementation strategy.
6. Describe the content layer and how it compiles to current metadata/scripts.
7. Translate the four playground examples at behavior level.
8. Write the phased roadmap with acceptance criteria.
9. Document test strategy, risks, and assumptions.

Phase 1 verification:

- Confirm the doc exists and is readable.
- Check that every current playground example is mentioned.
- Check that every implementation phase has concrete acceptance criteria.
- No build is required for Markdown-only work.

## Test Strategy For Implementation Phases

Future implementation should add tests incrementally:

- Determinism: same spec and seed produce identical world hash, anchors,
  placements, metadata IDs, and validation report.
- Material mapping: known aliases resolve; unknown materials fail.
- Surface: heightfield, mountain, cliff, road, flatten disc, and anchor
  placement.
- Structures: asset registry, placement measurement, stamping, prop recovery,
  rotation, reservations, and skipped-placement warnings.
- Scatter: deterministic distribution, spacing, mask filtering, and reports.
- Underground: volume fill, strata, rooms, shafts, chambers, tunnels, canyons,
  main path stamping, and feature surface queries.
- Content: NPC templates, behavior scripts, shops, quests, pickups, zones,
  portals, cinematics, weather, and export metadata.
- Validation: `findPath` required paths, optional path warnings, missing
  required references, and no silent failures.
- Round trip: spec to chunks/meta to `.vplevel` to deserialize to runtime meta.

## Risks

- Scope creep. Terrain generation, structures, content, and quests are all
  large enough to become separate systems. Keep the compiler modular and phase
  acceptance small.
- Save compatibility. Generated levels should use the existing export path
  until a region format is actually implemented.
- Coordinate bugs. Anchor reports and explicit coordinate kinds are required to
  keep generated scripts reliable.
- Path validation mismatch. Always prefer engine `findPath` over a new
  playground-style BFS so validation matches runtime movement.
- Palette drift. Use engine block names and aliases; do not introduce a second
  material enum.
- Performance. Large underground carves can touch hundreds of thousands of
  voxels. Use `ChunkManager.withBulkEdit`, bounded loops, and metrics from the
  first implementation.
- Script generation quality. Generated quests must be idempotent and stable-ID
  based, matching current script-engine patterns.

## Open Questions

- Whether `WorldSpec` should be authored primarily as JSON files, TypeScript
  literals, or both.
- Whether composition should grow beyond simple `defs`/`$ref` into
  parameterized macros once specs become repetitive enough to justify it.
- Which generated location should be the first registered in
  `PROCEDURAL_LEVEL_DEFINITIONS`.
- Whether underground vertical traversal should prefer stairs, ladders, rails,
  lifts, or a per-feature option.
- How much editor UI should exist for compiled world specs versus ordinary
  post-export level editing.

## Assumptions

- The playground remains reference material only.
- The native compiler is deterministic and author-time compiled.
- The current engine metadata and script systems remain the integration target.
- Generated gameplay content must round-trip through `.vplevel` export.
- Large/infinite streaming is deferred until the existing large-world roadmap
  is implemented.

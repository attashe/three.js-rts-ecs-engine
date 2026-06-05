# Large Worlds: Analysis & Improvement Plan

How big locations are created today — programmatically and in the editor —
where the pipeline strains as worlds grow, and a phased plan to improve the
authoring process, runtime performance, the programmatic API, and the editor.

This is a living design doc, not a commitment. It assumes the work already
landed this cycle: **mesh streaming** (`chunk-streaming.ts` +
`ChunkRenderer` streaming mode), the **structure-asset API**
(`src/procedural-structures/`), and the **indoor roof cut** system.

---

## 1. Current state

### 1.1 Data model

- A world is one `ChunkManager` (`src/engine/voxel/chunk-manager.ts`): a
  sparse `Map<ChunkKey, Chunk>`, `CHUNK_DIM = 32`, each chunk a 32 KB
  `Uint16Array` (`src/engine/voxel/chunk.ts`). No world bounds, no eviction —
  `clear()` is all-or-nothing.
- On-disk `.vplevel` (`src/engine/voxel/level-serializer.ts`) enumerates
  **every** chunk and writes all 32 768 voxels per non-empty chunk. No
  compression, no partial/region reads. The Large Town boulevard is ~2.6 MB
  for this reason.
- A location loads whole: `client.ts::activateLocation` →
  `replaceChunks` copies the entire `ChunkManager`; travel is a full swap.

### 1.2 Programmatic authoring

- Generators write voxels into one `ChunkManager` and return `LevelMeta`
  via the level builder (`src/game/level-builder/`: `terrain()`,
  `defineLevel()`, masks, `path/pond/platform/heightfield`).
- Registered in `src/game/procedural-levels.ts`; exported to tracked
  `.vplevel` by `scripts/export-procedural-levels.ts`.
- **Structures**: `src/procedural-structures/` generates deterministic
  tree/house/tower assets + prefabs; `placeStructureAsset(chunks, asset,
  transform)` stamps them with predictable footprints (used by the Large
  Town generator).
- There is **no tiling/region concept** — each location is one monolithic
  footprint authored by one generator function.

### 1.3 Editor (manual) authoring

- One `ChunkManager` + `ChunkRenderer` for the session (`src/editor.ts`);
  streaming now focused on the camera pivot.
- Painting, brushes, prop/structure placement, zones, etc. all mutate the
  resident world. New-level cap is 256 cells (`src/editor/save-load.ts`).
- Save = full serialize; load = full deserialize + `rebuildAll`.

### 1.4 Rendering / runtime (post-streaming)

- `ChunkRenderer` meshes only chunks within a radius of a focus point and
  budgets (re)meshes per frame; distant meshes are disposed (voxel data
  stays resident). Meshing is still **synchronous on the main thread**.
- Frustum culling is per-chunk-mesh (Three.js default). No LOD.
- Collision (`voxel-collide.ts`), zones, scripts, pickups, props, NPCs, and
  sound all assume the **whole location is resident** and query/iterate a
  single flat world.

---

## 2. Where it strains as worlds grow

| # | Bottleneck | Where | Bites at |
| - | ---------- | ----- | -------- |
| B1 | Synchronous main-thread meshing | `chunk-renderer.ts::remesh` → `greedy-mesher.ts` | Fast camera moves / cut changes on dense worlds |
| B2 | All voxel data resident | `chunk-manager.ts` (no eviction) | Beyond ~town scale (memory) |
| B3 | Whole-level serialize/load | `level-serializer.ts`, `client.ts::replaceChunks` | Big files (2.6 MB+), slow travel, no autosave |
| B4 | Whole-level-resident runtime systems | `voxel-collide.ts`, zones, scripts, props, NPCs | Many entities far from player wasted each tick |
| B5 | No LOD / far rendering | renderer | Long sightlines, hilltop vistas |
| B6 | Editor cover-mask scans all voxels | `view-mode-system.ts::hiddenCellsAboveY` | Top-down editing on large levels |
| B7 | Monolithic generators, one-shot bake | `procedural-levels.ts`, `placeStructureAsset` | Iterating/regenerating sub-areas; deterministic chunk gen |
| B8 | Manual authoring doesn't scale | editor brushes/placement | Hand-building a town block-by-block |
| B9 | Global flat-Y indoor cut | `indoor-cut-system.ts` | Slices distant geometry while indoors |
| B10 | Shadows/lights only near player | `client.ts` sun-follow, block lights | Acceptable, but caps perceived draw distance |

---

## 3. Roadmap

Phased so each step ships value and de-risks the next. **P0 = quick wins**,
**P1 = scale enablers**, **P2 = massive-world / polish**.

### P0 — Quick wins (low risk, immediate)

1. **Worker-pool meshing (B1).** `greedyMesh` is already a pure function over
   a sampler. Ship the chunk + a one-voxel neighbour skirt to a worker pool;
   `ChunkRenderer` consumes finished geometry in `update()`. Removes the last
   main-thread stall. (The renderer's Phase-3 comment already anticipates
   this drop-in.)
2. **Scope the editor cover-mask (B6).** Limit `hiddenCellsAboveY` to chunks
   in the streamed/active set (or near the cursor column) instead of all
   chunks; rebuild on a throttle. Top-down editing on big levels stays cheap.
3. **Cut only affected chunks (B9 perf).** When `setCutY` changes, re-queue
   only active chunks whose vertical extent crosses the cut (track a per-chunk
   max-Y), not the whole active set — faster roof reveal.
4. **Localised indoor cut (B9 correctness).** Optionally fade/cut only columns
   within a radius of the player rather than a global plane, so distant
   terrain isn't sliced while indoors.

### P1 — Scale enablers (the structural work)

5. **Region file format (B3).** Replace the monolithic `.vplevel` body with
   region files (e.g. 8×8-chunk regions) + an index, so the loader fetches
   only regions near the player and editors autosave dirty regions. Keep the
   current format as a single-region degenerate case for back-compat.
   Touch: `level-serializer.ts` (+ a `region-store.ts`), `client.ts` load
   path, `editor/save-load.ts`.
6. **Voxel data streaming (B2).** With region files, `ChunkManager` gains
   load/unload-by-region keyed off the same focus the mesh streamer uses.
   Add `ChunkManager.unloadChunk`/`loadRegion`; mesh streaming already
   tolerates chunks appearing/disappearing.
7. **Streaming-safe runtime systems (B4).** Index zones/props/NPCs/sound by
   region and activate only near the player. Make collision tolerant of
   not-yet-loaded chunks (treat unloaded as a load request or solid stop).
   Touch: `world.zones`, prop/npc/sound systems, `voxel-collide.ts`.

### P2 — Massive worlds & polish

8. **LOD / far rendering (B5).** Coarse meshes (or 2× downsampled chunks /
   impostors) beyond the high-detail radius; merge distant chunk geometry.
9. **Streaming props + cascaded shadows.** Instanced-prop streaming by region;
   a near shadow cascade so draw distance can grow without shadow cost.
10. **Deterministic infinite/biome generation.** Per-region seeded generation
    so a world can be generated on demand as the player explores (optional —
    only if "near-infinite" becomes a goal).

---

## 4. Programmatic API improvements

Goal: author a large location as *composed regions + scattered content*
instead of one long imperative function.

- **World/region builder.** Extend the level builder with a region-aware
  frame: author per-region terrain (heightfields, biomes) that the pipeline
  tiles across a large footprint, instead of `terrain({ size })` filling one
  square. Keep `terrain()` as the single-region path.
- **Scatter / biome API.** A declarative scatter layer over
  `placeStructureAsset`: "place N houses along this spline / in this polygon
  with spacing S and seed K", "scatter trees by density mask". Deterministic,
  footprint-aware (reuses `measureStructurePlacement` for collision-free
  placement). The Large Town's hand-listed plots become a few scatter rules.
- **Structure collections / templates.** Named bundles (a "village block":
  houses + well + fence) placed as one unit; rotation/anchor already exist.
- **Generation budget + async.** Let generators yield so very large worlds
  generate in chunks without blocking (pairs with region files).
- **LOD hints from generators.** Let a generator tag regions with an
  importance/LOD so the renderer can simplify far ones.

Reuse, don't reinvent: `placeStructureAsset`, `measureStructurePlacement`,
`structureSourceKey` (caching), the `terrain()` masks, and `makeRng`.

---

## 5. Editor improvements (manual authoring)

- **Chunked / region autosave & load.** Save dirty regions incrementally
  (depends on P1.5); large levels stop round-tripping multi-MB on every save.
- **Run generators in the editor.** A panel to invoke a procedural generator
  or scatter rule into the *current* working area (a "generate terrain /
  scatter structures here" brush), bridging programmatic and manual flows.
  The structure-asset API already supports preview + stamp; generalise it to
  terrain/scatter.
- **Region navigation / minimap.** A top-down minimap + jump-to-region so
  authors can move the streamed window across a large world quickly.
- **Streaming-aware overlays.** Cover mask, working-plane outlines, and
  selection gizmos should operate on the active region, not all voxels (B6).
- **Performance HUD.** Surface meshed-chunk count, mesh-queue depth, and
  per-frame mesh budget so authors see streaming working and spot stalls.
- **Large-area edit tools.** Box-fill/replace/flood across regions with a
  bounded preview; line/spline structure placement; copy/paste regions.
- **Raise/remove the 256 cap** once region save + streaming-safe overlays
  land; until then 256 is a safe ceiling.

---

## 6. Performance optimization checklist

- [ ] Off-thread greedy meshing (worker pool) — P0.1, biggest single win.
- [ ] Geometry/buffer pooling in `ChunkRenderer` to cut GC on stream churn.
- [ ] Per-chunk max-Y cache to scope cut/LOD remeshes (P0.3).
- [ ] Tune `radiusChunks` / `budgetPerFrame` per device; expose as settings.
- [ ] Optional greedy-mesh skirt sharing so worker payloads stay small.
- [ ] Distant-chunk LOD / merged geometry (P2.8).
- [ ] Region-indexed zone/entity activation (P1.7) to bound per-tick work.
- [ ] Frustum + (optional) simple occlusion culling for dense towns.
- [ ] Shadow cascade scoped near the player so draw distance can grow.

---

## 7. Sequencing & risks

**Do first (P0):** worker meshing, cover-mask scoping, scoped cut. All are
local, low-risk, and immediately improve the experience on the worlds we can
already build (≤ town scale resident).

**Then (P1):** region file format is the keystone — voxel streaming,
incremental save, and streaming-safe runtime systems all hang off it. Land it
behind back-compat (single-region = today's `.vplevel`) and migrate the
loader/editor incrementally.

**Defer (P2):** LOD, infinite generation, prop/shadow streaming — only worth
it once region streaming exists and a concrete need (sightlines, world size)
justifies the cost.

**Risks:**
- Region format is a save/compat contract — version it and keep a one-region
  fallback; regenerate tracked demo levels in the same change.
- Streaming-safe collision must never let the player fall through
  not-yet-loaded ground — gate movement on the player's own region being
  resident (it always is, since streaming follows the player).
- Worker meshing adds async ordering — guard against meshing a chunk whose
  version changed while in flight (re-queue on version mismatch, mirroring the
  existing `meshedVersion` check).

**Open questions:** target max world size; whether "near-infinite" is ever a
goal (drives P2.10); device floor for tuning streaming defaults.

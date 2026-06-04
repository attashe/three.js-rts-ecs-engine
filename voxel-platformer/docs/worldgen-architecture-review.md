# Worldgen Pipeline Architecture Review (Phase 5 → 9)

> Snapshot review of the worldgen pipeline as it stood after the Phase 8 (JSON
> export) checkpoint. Companion to `docs/worldgen-dsl-integration.md` (the design
> doc / roadmap). This file is the critique; the roadmap is the plan.

## 0. Scope of the rework

Since the Phase-5 checkpoint, four phases landed:

| Phase | What landed | Key files |
| --- | --- | --- |
| 6 | Underground MVP (volume fill, strata, 5 carvers, connectors, mine networks, surface classification, scatter) | `compile-underground.ts` (~1,121 LOC) |
| 7 | Rich content compilers (quests, shops, pickups, environment/cinematics/travel metadata) | `resolve-quests/shops/pickups/-content-metadata.ts` |
| 8 | JSON-spec → editor-level export + CLI | `src/editor/worldgen-level-export.ts`, `scripts/compile-world-spec.ts` |
| 9 (partial) | Region/resident-load metrics + budget warnings (foresight, not streaming) | `region-metrics.ts`, `compile-result.ts` |

Module grew from ~12 files to ~25 files / ~6,100 LOC, plus 6 test files (47
tests). The content layer was refactored into `content-common.ts` + per-category
resolvers.

**Verdict: the direction is architecturally sound and unusually disciplined
(≈ A‑).** The rule that normally breaks in code-generation systems — "don't grow
a parallel runtime" — held across all four phases. The real risk is *sequencing*,
not design: capability is being added on top of a base that, until the
rectangular-size change, could not express a non-square or genuinely large
footprint.

## 1. The spine (what's right structurally)

```
compileWorldSpec(unknown)                      ← single public entry, untrusted input
  → normalizeWorldSpec()                        ← validates/defaults/dedupes; rejects $ref
  → compileNormalizedWorldSpec(typed)           ← dispatch by world.type
      → compileSurfaceWorld / compileUndergroundWorld
          → WorldgenCompileContext              ← owns RNG, material, bounds, report, reservations
          → WorldgenLevelDraft                  ← single mutable metadata surface
          → resolveContent(...)                 ← props→zones→npcs→metadata→pickups→shops→quests→scripts
          → validateRequiredPaths()             ← engine findPath, not a bespoke BFS
      → finishWorldgenCompile()                 ← world hash, region metrics, budget warn, finalize
  ⇒ { chunks: ChunkManager, meta: LevelMeta, report }   ← same artifacts hand-authored levels emit
```

Things done correctly:

- **One artifact contract.** Everything converges on `WorldgenLevelDraft.toMeta()`
  → `defineLevel()` → `LevelMeta`, then the *same* `editorMetaFromRuntimeLevel` +
  `serializeLevel` path hand-authored procedural levels use. No parallel
  serialization. The spec → chunks/meta → `.vplevel` → deserialize round-trip is
  tested.
- **"No second engine" held.** Quests/shops/pickups emit ordinary `ScriptEntry`
  source using `on('level-start')`, `flags`, `ui.dialogue`, `trade.open`,
  `pickups.spawn` — idempotent, stable `worldgen.<kind>.<id>.<state>` flag IDs —
  and the rich-content tests **execute the generated scripts** through
  `createScriptEngineSystem`.
- **Determinism end-to-end.** Seeded `ctx.rand01/randInt`; `specHash` + `worldHash`
  make output diffable. No `Math.random()` in either compiler.
- **Diagnostics-first / fail-closed.** `required` vs `optional` → error vs warning;
  reference validation before script emission; `runtimeScriptIdConflict` blocks
  duplicate script/NPC-script IDs; portals fail closed. Nothing silently dropped.
- **Underground reuses the spine** (same context, draft, finish, checkpoints, RNG)
  rather than forking it.
- **Clean layering.** `game/worldgen` imports nothing from `editor`; the editor
  export bridges to the engine serializer. The CLI exits non-zero on failure and
  suppresses `.vplevel` output for failed reports.
- **Phase-9 foresight without over-building.** `region-metrics.ts` + the
  resident-budget warning surface scale risk at author time without committing to
  streaming.

## 2. Findings (by severity)

### HIGH — structural

**H1. Scalar `LevelMeta.size` ceiling caps the "larger locations" premise.**
Both compilers rejected rectangular X/Z worlds (`compile-surface.ts`,
`compile-underground.ts`: *"requires square X/Z worlds because LevelMeta.size is
scalar"*). Region streaming (Phase 9) presumes rectangular footprints. Inherited
from the engine (`LevelMeta.size: number`), so worldgen designed around it but
could not lift it alone. *Status: fixed via back-compat optional `sizeX/sizeZ`.*

**H2. `hashWorldOutput` is O(all allocated voxels), including air.**
`compile-result.ts` used to mix every `chunk.data[i]` per compile. Underground
does a full solid fill then carves, so large worlds hashed millions of voxels
each run. *Status: fixed in Phase 10.* Chunks now maintain a `contentHash`, and
worldgen finalization hashes sorted chunk coords, `nonAirCount`, and
`contentHash`. This intentionally changes `report.worldHash` values once without
changing generated chunks or metadata.

### MEDIUM — cohesion / maintainability

**M3. `compile-underground.ts` is a ~1,121-line monolith.** Five+ separable
pipelines (carvers, connectors, paths, structures, scatter, surface
classification, spline math, parsing) stacked in one file, while the surface side
is split. Cohesion-justified (shared in-memory `UndergroundState`) but the
least-tested-per-line file. *Status: fixed in Phase 10.* The file now
orchestrates modules for volume, carvers/connectors/paths, surfaces, structures,
scatter, stamping, shared types, math, and parse helpers.

**M4. Duplicated `isRecord` (4 copies).** The noise/spline/bounds "duplication" is
mostly domain-specific (surface 2D road math vs underground 3D spline math), not
truly shared. *Status: fixed enough for Phase 10.* `isRecord` lives in
`worldgen-util.ts`, and underground 3D math/parse helpers now live in
`worldgen-math.ts` and `worldgen-parse.ts`.

**M5. Generated-script templating is safe-by-convention.** `scriptLiteral`
(JSON.stringify) is used correctly today, but safety is a convention; any future
field not routed through it regresses. `scriptIdent()` was duplicated in quests
and shops. *Status: `scriptIdent` centralized; invariant documented.*

**M6. Content resolution is a fixed linear order, forward-reference-only.**
Deterministic and simple, but cross-category back-references are impossible and
the 8-category order is load-bearing. Diagnostics explain it. A two-pass model
(declare all IDs, then resolve) would lift the constraint. *Status: deferred.*

### LOW — watch

- **L7. `$ref`/`defs` composition unimplemented** (rejected in normalize). Without
  it, large specs are huge flat lists — the authoring-scalability counterpart to
  H1's runtime scalability. *Deferred.*
- **L8. `index.ts` over-exports internals** (`compileSurfaceWorld`/
  `compileUndergroundWorld`/`resolveContent` consume `NormalizedWorldSpec` but are
  public) — invites bypassing normalization. *Status: fixed in Phase 10.*
  Public imports use `index.ts`; white-box tests and compiler internals use
  `internal.ts` or direct modules.
- **L9. `WorldgenLevelDraft` mirrors `LevelMeta` by hand** — every new field must
  be added in two places. *Status: a compile-time drift guard now fails the build
  if the draft stops covering `LevelSpec`.*

## 3. Direction verdict

Right direction, one sequencing caveat: the project was accumulating content
breadth (Phase 7) and export polish (Phase 8) on a base that could not yet express
a non-square or large world (H1 + H2 + no `$ref`). Recommended ordering from here:

1. Rectangular `LevelMeta.size` (lifts H1; unblocks Phase 9 region footprints). — *done*
2. Bound the world hash (H2) before worlds grow. — *done in Phase 10*
3. Split `compile-underground.ts` + hoist shared `worldgen-math/parse` (M3/M4) and
   add carver/path determinism tests. — *done in Phase 10*
4. Harden script codegen (M5): single `scriptIdent`, single emit helper,
   adversarial round-trip test. — *partially done*
5. Then resume content breadth / `$ref` composition.

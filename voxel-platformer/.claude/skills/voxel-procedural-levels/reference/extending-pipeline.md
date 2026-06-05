# Extending The Procedural Pipeline

Use this when changing how procedural levels are authored, exported, or
loaded by the editor.

## File Chain

1. `src/game/level-builder/terrain.ts`
   - Shape helpers that write voxels into `ChunkManager`.
   - Add helpers only when they remove repeated shape logic across real
     generators.
2. `src/game/level-builder/meta.ts`
   - `defineLevel`, `outdoorDay`, `zoneBox`, `interactZone`.
   - Add helpers for repeated `LevelMeta` or zone math.
3. `src/game/level-builder/index.ts`
   - Re-export new helpers and types.
4. `src/game/level.ts`
   - Main demo generator and the `LevelMeta` interface.
   - If metadata shape changes, update this type first.
5. `src/game/procedural-level-ids.ts`
   - Stable IDs for levels and cross-level arrival zones.
6. `src/game/procedural-levels.ts`
   - Registry, generated level definitions, script source metadata.
7. `src/editor/procedural-level-export.ts`
   - Converts runtime `LevelMeta` to editor metadata and serialized
     `.vplevel`.
8. `src/editor/ui/level-tab.ts`
   - Browser raw script imports for built-in procedural levels.
9. `scripts/export-procedural-levels.ts`
   - Writes generated files to `public/levels/`.
10. Tests and docs.

## Adding A New Builder Helper

Use this sequence:

1. Add the helper to `terrain.ts` or `meta.ts`.
2. Export it from `level-builder/index.ts`.
3. Use it in at least one existing or new generator.
4. Add focused tests in `tests/level-builder.test.ts`.
5. Add a short example to `docs/procedural-levels.md`.

Do not add speculative helper APIs. If only one level uses the shape and it
is not clearer than direct `t.set(...)` calls, keep it local to that
generator.

## Adding A New Procedural Level

Use this sequence:

1. Add `MY_LEVEL_ID` and any arrival IDs to
   `src/game/procedural-level-ids.ts`.
2. Write `generateMyLevel(chunks, scriptSources?)`.
3. Register it in `PROCEDURAL_LEVEL_DEFINITIONS` with stable `id`, `file`,
   `name`, and `generate`.
4. Add script file metadata if needed.
5. Run `npm run levels:procedural`.
6. Extend `tests/procedural-level-export.test.ts` so the level exports and
   important metadata survives serialization.

## Adding A New Metadata Field

This is a wider change. Touch the full chain:

1. Runtime shape in `src/game/level.ts`.
2. Editor shape/copy helpers in `src/editor/editor-state.ts`.
3. Runtime conversion in `src/game/level-from-meta.ts`.
4. Save/load defaults if old `.vplevel` files need compatibility.
5. Procedural export in `src/editor/procedural-level-export.ts`.
6. Tests for editor round trip and procedural export.
7. Docs and skill references if the field becomes part of authoring.

## Verification

Run from repo root:

```bash
npm run levels:procedural
npm test
npm run build
```

If generated `.vplevel` files changed, inspect that the change is expected
and not caused by non-deterministic generation.

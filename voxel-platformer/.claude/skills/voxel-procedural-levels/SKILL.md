---
name: voxel-procedural-levels
description: >-
  Author, edit, export, or test code-generated procedural locations for the
  voxel-platformer engine. Use when working on procedural level generators,
  level builder helpers, travel portals between locations, generated
  `.vplevel` files, or files such as docs/procedural-levels.md,
  src/game/level.ts, src/game/procedural-levels.ts,
  src/game/procedural-level-ids.ts, src/game/level-builder/*,
  src/editor/procedural-level-export.ts, scripts/export-procedural-levels.ts,
  tests/level-builder.test.ts, and tests/procedural-level-export.test.ts.
  Triggers: "create a procedural level", "add a location", "export
  procedural levels", "add a portal destination", "generate a .vplevel",
  "terrain(...)", "defineLevel(...)", "procedural location", and "travel
  destination".
---

# Voxel procedural levels

Procedural locations are TypeScript generators that write voxels into a
`ChunkManager`, return `LevelMeta`, and export into ordinary editor-saveable
`.vplevel` files. Use the level builder for regular shapes and metadata
defaults; drop to explicit loops only for irregular details.

Full design guide: `docs/procedural-levels.md`.

## Two jobs this skill covers

1. **Authoring a procedural location** - terrain, metadata, props, zones,
   portals, ambience, scripts, and generated `.vplevel` output.
2. **Extending the level builder/export pipeline** - new helper functions,
   new metadata round-trips, or tests for generator/export behavior.

For details beyond the quick path below, read the matching file in
`reference/`.

---

## Path 1 - Authoring a procedural location

Start from the closest existing generator:

- `src/game/level.ts::generatePlatformerLevel` for a large demo-style level.
- `src/game/procedural-levels.ts::generateTeleportGardenLevel` for a small
  travel destination.

Canonical workflow:

1. Add stable IDs in `src/game/procedural-level-ids.ts` for the level and
   any cross-level arrival zones.
2. Write a generator using `terrain(chunks, { size, groundY })`.
3. Return metadata with `defineLevel({ name, size, spawn, ... })`; include
   only meaningful non-empty fields.
4. Register the generator in `PROCEDURAL_LEVEL_DEFINITIONS`.
5. If it bundles scripts, add source metadata to
   `PROCEDURAL_LEVEL_SCRIPT_FILES` and ensure browser raw imports in
   `src/editor/ui/level-tab.ts` stay in sync.
6. Run `npm run levels:procedural`.
7. Add or extend tests for export, travel, scripts, and metadata.

Minimal shape:

```ts
export function generateMyLevel(chunks: ChunkManager): LevelMeta {
    const size = 24
    const groundY = 4
    const t = terrain(chunks, { size, groundY })

    t.ground({ top: BLOCK.grass })
        .fill([3, 8], [groundY, groundY], [10, 12], BLOCK.sand)
        .platform({ x: [12, 18], z: [14, 18], topY: groundY + 3, top: BLOCK.grass, fill: BLOCK.stone })

    return defineLevel({
        name: 'My Level',
        size,
        spawn: t.stand(4.5, 11.5),
        environment: { soundId: 'music.background', volume: 0.24 },
        ambient: outdoorDay({ timeOfDay: 16 }),
    })
}
```

Read `reference/builder-cheatsheet.md` for terrain/meta helpers and
`reference/contracts-and-gotchas.md` before changing portals or scripted
levels.

---

## Path 2 - Extending Builder Or Export

Keep builder helpers small and semantic. A good helper replaces repeated
coordinate math or repeated `LevelMeta` defaults; it should not hide unique
level design behind a generic abstraction.

Typical chain:

1. Add or adjust helper code under `src/game/level-builder/`.
2. Use the helper in one real generator so the shape is proven.
3. Update `docs/procedural-levels.md`.
4. Add focused tests in `tests/level-builder.test.ts`.
5. If serialization output changes, update
   `src/editor/procedural-level-export.ts` and
   `tests/procedural-level-export.test.ts`.

Read `reference/extending-pipeline.md` for the file-by-file map.

---

## Testing

From repo root:

```bash
npm run levels:procedural
npm test
npm run build
```

For a narrow helper-only edit, run the full test suite before finishing if
generated levels or metadata could change; `npm test` runs the procedural
exporter first.

## File Map

| File | Role |
| ---- | ---- |
| `docs/procedural-levels.md` | Canonical authoring guide |
| `src/game/level-builder/{terrain,meta,index}.ts` | Terrain and `LevelMeta` authoring helpers |
| `src/game/level.ts` | Main demo generator and `LevelMeta` type |
| `src/game/procedural-level-ids.ts` | Stable level/arrival IDs |
| `src/game/procedural-levels.ts` | Procedural registry, small generated levels, script source list |
| `src/editor/procedural-level-export.ts` | Runtime `LevelMeta` -> editor `.vplevel` export |
| `scripts/export-procedural-levels.ts` | Writes tracked generated levels under `public/levels/` |
| `tests/level-builder.test.ts` | Builder helper unit tests |
| `tests/procedural-level-export.test.ts` | Generated `.vplevel` export tests |
| `examples/scripts/*.js` | Script contracts hard-coded by generated levels |

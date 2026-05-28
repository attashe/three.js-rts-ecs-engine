# Procedural Levels

Procedural demo levels are generated from code and exported into ordinary
editor files (`.vplevel`). This keeps the runtime fallback, editor project
library, travel portals, and tests on the same serialization path.

## Files

- `src/game/level.ts` contains the original demo generator.
- `src/game/procedural-levels.ts` is the registry of procedural levels and
  their script sources.
- `src/editor/procedural-level-export.ts` converts runtime `LevelMeta` into
  `EditorLevelMeta` and serializes it with the normal voxel level serializer.
- `scripts/export-procedural-levels.ts` writes generated editor files to
  `public/levels`.

Generated files are tracked in `public/levels`:

- `demo.vplevel`
- `demo-teleport-garden.vplevel`

## Commands

```bash
npm run levels:procedural
```

The exporter compiles the Node-safe test build, regenerates every registered
procedural level, and writes files only when bytes changed.

```bash
npm test
```

The test command runs the exporter before `node --test`, so changes to the
procedural generators fail quickly if they no longer serialize or if required
script files are missing.

## Adding A Level

1. Add a stable id in `src/game/procedural-level-ids.ts`.
2. Add a generator in `src/game/procedural-levels.ts`.
3. Register it in `PROCEDURAL_LEVEL_DEFINITIONS`.
4. If the level needs bundled scripts, add their paths to
   `PROCEDURAL_LEVEL_SCRIPT_FILES`.
5. Run `npm run levels:procedural`.
6. Add or update tests that assert important portal, arrival, and script
   metadata survives export.

Portal arrival ids should point at non-trigger `arrival` zones and should not
overlap the outgoing portal volume. That avoids immediate bounce-back when the
player arrives from another location.

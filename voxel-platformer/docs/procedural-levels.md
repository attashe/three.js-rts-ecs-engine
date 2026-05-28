# Procedural Levels

Procedural levels are generated from code and exported into ordinary editor
files (`.vplevel`), so the runtime fallback, editor project library, travel
portals, and tests all ride the same serialization path.

They are authored through the **level builder** (`src/game/level-builder/`):
a fluent `terrain(...)` layer for voxel shapes plus `defineLevel(...)` +
helpers for the `LevelMeta` record. The builder exists because the old
generators were ~120 lines of nested `setVoxel` loops and an 18-field
`LevelMeta` literal that spelled out every empty array and a repeated
ambient-weather block. The canonical worked example is
`generatePlatformerLevel` in `src/game/level.ts`.

## The builder API

### Terrain - `terrain(chunks, { size, groundY })`

Owns the level frame and exposes chainable voxel shapes + coordinate
helpers. Spans are inclusive `[lo, hi]` tuples (either order).

```ts
const t = terrain(chunks, { size: 24, groundY: 4 })

t.ground({ top: BLOCK.grass })                 // base/soil/surface across size^2
 .ground({ top: (x, z) => edge(x, z) ? BLOCK.stone : BLOCK.grass }) // per-cell surface
 .heightfield({ heightAt: (x, z) => 4 + hills(x, z), top: BLOCK.grass })
 .fill([16, 20], [5, 7], [8, 9], BLOCK.plank)  // inclusive box (alias: .box)
 .stairs({ x: [16, 20], startZ: 8, steps: 3, depth: 2, block: BLOCK.plank, fillUnder: BLOCK.stone })
 .platform({ x: [14, 22], z: [16, 20], topY: 8, top: BLOCK.grass, fill: BLOCK.stone })
 .path({ points: [{ x: 3, z: 10 }, { x: 18, z: 10 }], width: 3, block: BLOCK.sand })
 .pond({ center: { x: 10, z: 10 }, radius: 4, waterY: 4 })
 .set(9, 5, 9, BLOCK.unlitLantern)             // single voxel (escape hatch)
 .clear(8, 7, 21)                              // set air (e.g. a piston shaft)

t.stand(x, z)        // { x, y: groundY + 1, z } - standing height
t.surface(x, z, dy)  // { x, y: groundY + dy, z } - surface-relative point
t.heightAt(x, z)     // current generated surface height for a column
t.standAt(x, z)      // standing height over uneven terrain
```

`ground`/`stairs`/`platform` default the soil/base/baseY to the common
choices (dirt over stone, risers starting at `groundY + 1`); override as
needed. `heightfield` records per-column surface heights so props and
pickups can use `standAt` on uneven terrain. For broad terrain edits,
combine mask helpers (`circle`, `ellipse`, `rect`, `pathMask`,
`anyMask`, `subtractMask`, `fbmNoise2D`, `noiseThreshold`) with
`paintSurface`, `raise`, `lower`, `carve`, and `fillWater`. Ordinary
water/lava pools should be authored as liquid blocks; exposed liquid block
tops render their animated surface automatically, so do not place a
separate Visual FX zone just to cover a pond.

```ts
import { fbmNoise2D, noiseThreshold } from './level-builder'

const noise = fbmNoise2D({ seed: 42, frequency: 0.08, octaves: 4 })
t.heightfield({ heightAt: (x, z) => 4 + Math.floor(noise(x, z) * 3), top: BLOCK.grass })
 .paintSurface(noiseThreshold(noise, 0.7), BLOCK.stone)
```

### Meta - `defineLevel`, `outdoorDay`, `interactZone`

```ts
return defineLevel({
    name: 'demo',
    size,
    spawn: t.stand(size / 2, size / 2),
    // Only the non-empty fields. stoneSpawners/stones/coinPiles/pistons/
    // zones/soundSources/soundZones/weatherZones/props/npcs/scripts each
    // default to []; player defaults to DEFAULT_PLAYER_SETTINGS.
    pistons, zones, props, coinPiles,
    environment: { soundId: 'music.background', volume: 0.36 },
    ambient: outdoorDay(),                       // alias for ambientWeather
})
```

- **`defineLevel(spec)`** - fills every empty/optional default so a level
  literal carries only what's meaningful.
- **`outdoorDay(overrides?)`** - a resolved clear animated outdoor day;
  pass only the fields that differ (`outdoorDay({ timeOfDay: 16, skyTint: [1, 0.96, 0.9] })`).
- **`zoneBox(center, half, yLo, yHi)`** -> `{ min, max }` from a center +
  half-extents.
- **`interactZone({ id, center, half, yLo, yHi, prompt, anchorDy, radius })`**
  - a `kind: 'interact'` zone whose AABB *and* prompt anchor both derive
  from one center (usually the matching prop's position), so the keeper /
  sundial / shrine pattern stops repeating the same coordinate three times.

## Files

- `src/game/level-builder/{terrain,meta,index}.ts` - the authoring API.
- `src/game/level.ts` - the demo generator + the `LevelMeta` type.
- `src/game/procedural-levels.ts` - the registry (`PROCEDURAL_LEVEL_DEFINITIONS`)
  and per-level script sources (`PROCEDURAL_LEVEL_SCRIPT_FILES`).
- `src/editor/procedural-level-export.ts` - runtime `LevelMeta` ->
  `EditorLevelMeta` -> serialized `.vplevel`.
- `scripts/export-procedural-levels.ts` - writes generated files to
  `public/levels/` (only when bytes change).

Generated, tracked binaries: `public/levels/{demo,demo-teleport-garden}.vplevel`.

## Commands

```bash
npm run levels:procedural   # regenerate every registered level (writes on change)
npm test                    # runs the exporter first, then node --test
npm run typecheck
```

## Adding a level

1. Add a stable id in `src/game/procedural-level-ids.ts`.
2. Write a generator using `terrain(...)` + `defineLevel(...)`.
3. Register it in `PROCEDURAL_LEVEL_DEFINITIONS` in
   `src/game/procedural-levels.ts`.
4. If it bundles scripts, add their paths to `PROCEDURAL_LEVEL_SCRIPT_FILES`.
5. `npm run levels:procedural`, then add/extend a test asserting the portal,
   arrival, and script metadata survives export.

Portal arrival ids should point at non-trigger `arrival` zones that don't
overlap the outgoing portal volume - otherwise the player bounces straight
back on arrival.

## The script contract

When a level loads editor-authored `.js` scripts (the demo loads four from
`examples/scripts/`), those scripts hard-code zone ids, piston ids, and key
coordinates. Treat them as a contract: preserve `zone.demo.*`,
`piston.elevator` / `piston.trap`, the lantern `(9,5,9)`, the Sun Shard /
reward positions, and the shrine zone positions - or update the dependent
script in the same change. The level-authoring skill
(`.claude/skills/voxel-procedural-levels/`) spells this out.

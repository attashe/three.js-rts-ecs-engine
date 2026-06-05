# Builder Cheatsheet

Use this when writing or reviewing a procedural level generator.

## Terrain

Create one frame per generator:

```ts
const size = 24
const groundY = 4
const t = terrain(chunks, { size, groundY })
```

Common helpers:

| Helper | Use |
| ------ | --- |
| `t.ground({ top })` | Base/soil/surface across `[0, size)` squared |
| `t.heightfield({ heightAt, top })` | Variable-height terrain columns |
| `t.fill(xSpan, ySpan, zSpan, block)` | Inclusive cuboid; spans accept either order |
| `t.box(...)` | Alias for `fill` |
| `t.stairs({ x, startZ, steps, depth, rise, block, fillUnder })` | Regular stairs |
| `t.platform({ x, z, topY, top, fill })` | Filled elevated slab |
| `t.path({ points, width, block })` | Paint a surface path along a polyline |
| `t.pond({ center, radius, waterY })` | Carve a simple shore + water mask |
| `t.paintSurface(mask, block)` | Paint current top voxels where a mask matches |
| `t.raise/lower/carve/fillWater(mask, ...)` | Masked terrain sculpting |
| `t.set(x, y, z, block)` | Sparse single-voxel placement |
| `t.clear(x, y, z)` | Air at one voxel |
| `t.stand(x, z)` | Standing coordinate `{ x, y: groundY + 1, z }` |
| `t.surface(x, z, dy)` | Ground-relative coordinate `{ x, y: groundY + dy, z }` |
| `t.heightAt/standAt/surfaceAt(x, z)` | Coordinates over uneven generated terrain |

Use mask helpers for larger irregular terrain before dropping to manual
loops: `circle`, `ellipse`, `rect`, `pathMask`, `anyMask`, `allMask`,
`subtractMask`, `fbmNoise2D`, and `noiseThreshold`. Use `t.set(...)` loops
only for one-off details that are clearer than a named mask operation.

Author ponds and lava pools as `BLOCK.water` / `BLOCK.lava` voxels. The
chunk renderer applies animated liquid surfaces to exposed liquid-block top
faces automatically; do not add a `water` or `lava` Visual FX zone merely to
cover an ordinary pool.

## Metadata

Return `defineLevel(...)` instead of hand-writing a full `LevelMeta`:

```ts
return defineLevel({
    name: 'Teleport Garden',
    size,
    spawn: t.stand(4.9, 11),
    zones,
    coinPiles: [{ position: { x: 10, y: groundY + 2, z: 10 }, amount: 5 }],
    environment: { soundId: 'music.background', volume: 0.24 },
    ambient: outdoorDay({ timeOfDay: 16 }),
})
```

`defineLevel` fills the defaults for:

- `stoneSpawners`
- `stones`
- `coinPiles`
- `pistons`
- `zones`
- `soundSources`
- `soundZones`
- `weatherZones`
- `props`
- `npcs`
- `scripts`
- `player`

Use `ambient: outdoorDay(overrides)` for normal outdoor levels. Override
only what differs from the default clear animated day.

## Zones

Use `zoneBox(center, half, yLo, yHi)` when the same center/half math appears
twice.

Use `interactZone(...)` for NPCs, shrines, sundials, books, tables, and any
other object where the AABB and the interaction prompt anchor should derive
from the same point:

```ts
interactZone({
    id: 'zone.demo.haste-shrine',
    label: 'Shrine of Haste',
    center: { x: 13.5, z: 9.5 },
    half: { x: 0.8, z: 0.8 },
    yLo: groundY + 1,
    yHi: groundY + 3,
    prompt: 'Press E',
    radius: 1.8,
})
```

## Scripts

If a procedural level includes scripts:

1. Store reusable script source under `examples/scripts/`.
2. Add `{ id, name, sourcePath }` to `PROCEDURAL_LEVEL_SCRIPT_FILES`.
3. Build `ScriptEntry[]` from source strings, following `createDemoScripts`.
4. Keep zone IDs, pickup IDs, and coordinates in the generator aligned with
   script constants.
5. Use the `voxel-script-authoring` skill for script internals.

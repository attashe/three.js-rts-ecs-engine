# Backdrop Scenery

Authored distant background scenery — ranges of simplified low-poly mountains
that fill the band between the playable level and the sky, so the player sees a
vista far below/beyond when they climb. Built for the orthographic iso view via
a perspective pre-pass.

## Why a perspective pre-pass

The game camera is **orthographic** — it has no foreshortening, so far geometry
renders at the same scale as near geometry. A distant vista drawn with the ortho
camera therefore looks flat (ranges don't shrink or converge into the haze), and
a wraparound ring just slides with the player.

The fix is a **perspective backdrop pre-pass**:

1. The authored ranges (+ sky + fog + sun) live in a separate backdrop scene.
2. A **perspective** camera that mirrors the iso camera's position + orientation
   renders that scene first, clearing to its sky colour — so far ranges
   foreshorten and converge.
3. Depth is cleared, and the ortho gameplay world is drawn on top.

Result: a deep, painted-looking vista behind crisp isometric gameplay — and
because the ranges' base Y is fixed while they follow the player in XZ, climbing
reveals more vista below.

A plain ortho/full-ring backdrop (no pre-pass) reads flat under the iso camera —
keep that mode only for perspective **cinematics**.

## Pieces

| File | Role |
| ---- | ---- |
| `src/engine/render/backdrop-scenery.ts` | `BackdropLayer` authoring type + `buildBackdropLayerGeometry` (deterministic silhouette) + `createBackdropScenery` (meshes in a group, follow-in-XZ). |
| `src/engine/render/backdrop-pass.ts` | `createBackdropPass` — self-contained backdrop scene (sky/fog/sun/ambient + ranges) and a perspective camera; `syncTo` / `update` / `setSky` / `setFog` / `setSun`. |
| `src/engine/render/renderer.ts` | `Renderer.setBackdrop(pass | null)` — the two-pass composite. |
| `backdrop-demo.html` / `src/backdrop-demo.ts` | Standalone showcase: ortho foreground + perspective ranges behind. |
| `tests/backdrop-scenery.test.ts` | Determinism + geometry bounds + seam-closing for the silhouette builder. |

## Authoring a layer

Each `BackdropLayer` is a designer-tuned band (deterministic via `seed` — not
random), so a story location's vista is hand-aligned:

```ts
{ seed: 23, distance: 320, baseY: -8, height: 110, ruggedness: 0.55,
  colorLow: [0.34, 0.30, 0.34], colorHigh: [0.62, 0.50, 0.46] }
```

Stack a few: nearer = darker + taller-contrast; farther = lighter and closer to
the sky colour so fog melts them into the horizon. Use `arcDeg` / `centerDeg`
for a directional range instead of a full ring.

## Integrating into a story location

1. Set the main scene `background = null` and **disable the ambient-weather sky
   dome** — the backdrop provides the sky now (keep fog).
2. Author a `backdrop` config on the level meta (`BackdropLayer[]` + sky/fog/sun).
3. In `installLocationSystems`:
   ```ts
   const bp = createBackdropPass({ layers: meta.backdrop, sky, fogDensity, fov, ... })
   renderer.setBackdrop(bp)
   // each render frame:
   bp.syncTo(renderer.iso.camera)
   bp.update(renderer.iso.target.x, renderer.iso.target.z)
   bp.setSun(dayCycle.sunColor, dayCycle.sunIntensity) // keep it weather-aligned
   bp.setFog(dayCycle.fogColor, dayCycle.fogDensity)
   // teardown:
   renderer.setBackdrop(null); bp.dispose()
   ```

## Tuning + caveats

- `fov` lower ⇒ flatter/more telephoto (ranges read more distant). ~42 is a good
  start. Tune in `backdrop-demo` against the target art.
- The two-pass `autoClear` / `clearDepth` sequencing can't be unit-tested (no GPU
  in CI) — verify visually in the demo that the foreground composites cleanly
  over the ranges with no depth bleed.

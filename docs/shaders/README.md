# Shaders

This folder is a small reference for writing materials in this engine.

The renderer is `WebGPURenderer` (locked decision; see the root `README.md`). All
materials are written in **TSL (Three Shading Language)** — a JS-based shader
graph that compiles to WGSL on WebGPU. You can also drop into raw WGSL via
`wgslFn` when TSL isn't expressive enough.

## Files in this folder

- [`tsl-cheatsheet.md`](./tsl-cheatsheet.md) — syntax reference. Imports, math chaining, common nodes, material slots, control flow, the `Fn` and `wgslFn` escape hatches.
- [`examples.md`](./examples.md) — annotated walkthroughs of the runnable example materials in `src/client/engine/render/materials/`. Read alongside the TS files.

## Runnable example materials

Five factories, each returning a configured `MeshStandardNodeMaterial` ready to
hand to a `Mesh`:

```ts
import { createPulsingEmissive } from './engine/render/materials'

const mat = createPulsingEmissive({ glow: 0xffd45a, speed: 2 })
mesh.material = mat
```

| Factory | What it shows | Likely game use |
|---|---|---|
| `createVoxelVertexColor` | per-vertex color attribute, flat shading | greedy-meshed voxel chunks (Phase 3) |
| `createPulsingEmissive` | `time` + `sin` driving `emissiveNode` | quest markers, selected unit pulse |
| `createFresnelRim` | `dot(normalView, viewDir)` rim-light | mouseover / hover highlight |
| `createDissolve` | `mx_noise_float` + `step` + `alphaTest` | spawn / despawn FX (returns the threshold uniform so you can animate it) |
| `createWindFoliage` | vertex displacement via `positionNode`, weighted by Y | grass, leaves, banners |

## Wiring an example into the running app

The example materials are not in the import graph by default — they're sample
code, not engine code. To try one in the demo, edit `src/client/client.ts`:

```ts
// At the top:
import { createFresnelRim } from './engine/render/materials'

// Inside the spawn loop, replace `MeshStandardNodeMaterial({...})` with:
const mesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    createFresnelRim({ base: palette[i], rim: 0x9fefff, power: 3 }),
)
```

For `createDissolve`, the factory returns `{ material, threshold }` — the
threshold is a TSL `uniform` you can drive from a system:

```ts
const { material, threshold } = createDissolve({ base: 0x66aaff })
// In a render-step system:
threshold.value = Math.min(1, threshold.value + dt * 0.3)  // dissolve over ~3 s
```

## Conventions

- All factories take an options object with sensible defaults — every option is optional.
- Factories return the constructed material directly, except `createDissolve` which also exposes its threshold uniform.
- Color options accept either a `THREE.Color` or a hex number.
- No factory mutates the inputs.
- Factories are pure JS — no async, no I/O. Safe to call before `engine.start()`.

## Why TSL and not GLSL/WGSL strings?

TSL is the canonical shader API in three.js r170+ for WebGPU. It compiles to
both WGSL and (on the legacy WebGL path) GLSL, so it's portable. It also
participates in three's lighting/shadow/post-processing graphs without manual
varying/uniform plumbing. Raw WGSL is still available via `wgslFn` for
hot-loop / numerically-tricky bits — see the cheatsheet's "Escape hatches"
section.

# TSL cheatsheet

Pragmatic reference for writing materials with the Three Shading Language in
this codebase. Not a full spec — see [three's TSL wiki](https://github.com/mrdoob/three.js/wiki/Three.js-Shading-Language)
for the comprehensive list.

## Imports

```ts
// Material classes — from three/webgpu
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial, MeshLambertNodeMaterial } from 'three/webgpu'

// Shader graph nodes — from three/tsl
import {
    // Coordinates / attributes
    positionLocal, positionWorld, positionView, positionViewDirection,
    normalLocal, normalView, normalWorld,
    uv, vertexColor, attribute,
    cameraPosition,

    // Time
    time, deltaTime,

    // Vector / scalar construction
    float, vec2, vec3, vec4, color,

    // Common math (chainable on any node)
    add, sub, mul, div, mod, mix, clamp, saturate, step, smoothstep,
    sin, cos, tan, abs, floor, fract, pow, sqrt, length, normalize, dot, cross,
    oneMinus, negate, min, max, sign,

    // Noise / hashing
    hash, mx_noise_float, mx_noise_vec3, mx_fractal_noise_float,

    // Control flow / functions
    Fn, If, Loop, Switch, Discard, Return, select,

    // Uniforms / constants
    uniform, uniformArray, attribute, buffer,

    // Escape hatch
    wgsl, wgslFn,
} from 'three/tsl'
```

## The fluent style (read this first)

Every TSL node has math methods chained on it:

```ts
// add(a, b)              ← prefix form
// a.add(b)               ← method form (preferred in three's own code)

const a = float(0.5)
const b = a.add(0.25).mul(2).sub(1)   // ((0.5 + 0.25) * 2) - 1 = 0.5
```

Mixing styles is fine but pick one per expression.

## Material slots

You assign nodes to specific slots on a `*NodeMaterial` to drive different
parts of the shader:

```ts
const m = new MeshStandardNodeMaterial({ color: 0xffffff })

m.colorNode      // base color (sampled where the legacy `color` was used)
m.emissiveNode   // additive emission (after lighting)
m.normalNode     // surface normal in tangent space — perturb for normal-mapping
m.positionNode   // per-vertex position override (vertex displacement)
m.opacityNode    // alpha (use with material.transparent = true or alphaTest)
m.roughnessNode  // PBR roughness scalar
m.metalnessNode  // PBR metalness scalar
m.aoNode         // ambient occlusion
```

If a slot is left null, the underlying material's default (constructor params,
texture maps, etc.) takes over.

## Common nodes you'll reach for

| Node | Returns | Notes |
|---|---|---|
| `positionLocal` | vec3 | vertex position before model matrix |
| `positionWorld` | vec3 | after model matrix |
| `positionView` | vec3 | in view (camera) space |
| `positionViewDirection` | vec3 | normalised vector from fragment to camera |
| `normalLocal` / `normalView` / `normalWorld` | vec3 | surface normal in each space |
| `uv()` | vec2 | first UV channel; `uv(1)` for second, etc. |
| `vertexColor()` | vec3/vec4 | reads the `color` attribute on the geometry |
| `time` | float | seconds since shader compile (auto-updated each frame) |
| `cameraPosition` | vec3 | world-space camera position |
| `attribute('myAttr', 'vec3')` | typed | reads any custom attribute |

## Vector construction

```ts
vec2(0.5, 0.0)            // literal
vec3(positionLocal.x, positionLocal.z, 0)   // from components
vec4(rgb, 1.0)            // promote vec3 → vec4 with alpha
color(0xff5566)           // Color → vec3 (handles colorspace)
```

## Uniforms (driven from CPU)

```ts
import { Color } from 'three'

const colorU = uniform(new Color(0xff5566))   // creates a vec3 uniform
const speedU = uniform(2.0)                    // creates a float uniform

// Later, from CPU:
speedU.value = 4.0                             // updates next frame, no re-bind
```

Use `uniform` for anything you want to animate from a system, change via UI, etc.
Embedded literals (`vec3(1,0,0)`) are baked into the shader at compile time and
can't be changed.

## Control flow

```ts
// Inline ternary
const c = select(uv().x.greaterThan(0.5), vec3(1, 0, 0), vec3(0, 1, 0))

// Statement-style
If(uv().x.greaterThan(0.5), () => {
    // ...
}).ElseIf(uv().y.greaterThan(0.5), () => {
    // ...
}).Else(() => {
    // ...
})

// Discard fragment
Discard(uv().x.greaterThan(0.9))

// Loop (1-D and N-D)
Loop(8, ({ i }) => {
    // i is a uint, accessible via i.toFloat() etc.
})
Loop(3, 3, 3, ({ i, j, k }) => { /* triple-nested */ })
```

## Functions

```ts
const remap = Fn(([x, fromMin, fromMax, toMin, toMax]) => {
    const t = x.sub(fromMin).div(fromMax.sub(fromMin))
    return toMin.add(t.mul(toMax.sub(toMin)))
})

const out = remap(positionLocal.y, float(-1), float(1), float(0), float(1))
```

Function arguments are nodes; the function body composes a node graph that gets
inlined by the TSL compiler.

## Common math gotchas

- **Order of types matters in `mix(a, b, t)`** — `a` and `b` must be the same type, `t` is a scalar **or** same-type vec for componentwise blend.
- **`smoothstep(edge0, edge1, x)`** returns 0 below `edge0`, 1 above `edge1`, smooth in between. To get a "peak around N" use `oneMinus(abs(x.sub(N)).mul(2)).max(0)` or two-sided smoothstep.
- **`mod` on negatives** — TSL `mod` follows GLSL `mod` (`x - y * floor(x/y)`), which differs from JS `%`.
- **`pow(0, 0)`** is undefined on some hardware. Add a tiny epsilon or `max(x, 1e-5)` before raising.

## Tone mapping & colorspace

Tone mapping happens **after** your `colorNode`/`emissiveNode` outputs go
through the lighting model. The renderer's `toneMapping` setter (we use
`ACESFilmicToneMapping`) handles it globally.

Don't pre-tonemap inside a material — you'll double-tonemap. Just author colors
in linear space (which `color(0xff5566)` gives you).

## Escape hatches

When TSL is too verbose or you want to inline an existing WGSL snippet:

```ts
import { wgslFn } from 'three/tsl'

const voronoi3d = wgslFn(`
    fn voronoi3d(p: vec3<f32>) -> f32 {
        // ... raw WGSL ...
        return result;
    }
`)

// Use as a regular node:
material.colorNode = vec3(voronoi3d(positionLocal))
```

`wgslFn` parses the function signature, registers it as a TSL node, and lets
you call it like any other node. You're responsible for making the WGSL
correct — the TSL type-checker doesn't help you here.

## Where to look in three's own code for inspiration

- `node_modules/three/examples/jsm/materials/WoodNodeMaterial.js` — non-trivial procedural material with `Fn` and `wgslFn`
- `node_modules/three/examples/jsm/tsl/display/FilmNode.js` — minimal `Fn`-based post-process
- `node_modules/three/src/nodes/materials/MeshStandardNodeMaterial.js` — the standard PBR graph
- `node_modules/three/build/three.tsl.js` — full export list (search for the `export {...}` block at the bottom)

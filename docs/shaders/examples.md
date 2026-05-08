# Material examples — annotated

Each section walks through one factory in `src/client/engine/render/materials/`.
Read this alongside the TS file; the explanations here cover *why* each line
exists.

---

## `voxel-vertex-color.ts`

**What it does:** PBR-lit material whose color comes entirely from the
geometry's per-vertex `color` attribute. Flat shading by default.

**Why it matters:** This is the material the Phase 3 voxel chunks will use.
The greedy mesher will emit one vertex color per face from the palette, so the
material itself stays trivial.

**Recipe:**

```ts
m.colorNode = vertexColor()           // reads the geometry's `color` attribute
m.flatShading = true                  // per-face normals (no smoothing)
m.metalness = 0; m.roughness = 0.85   // matte non-metal look
```

**To try it:**

```ts
const geom = new BoxGeometry(1, 1, 1)
geom.setAttribute('color', new Float32BufferAttribute([
    1,0,0, 1,0,0, 1,0,0, 1,0,0,    // +X face: red
    0,1,0, 0,1,0, 0,1,0, 0,1,0,    // -X face: green
    // ... etc per face
], 3))
const mesh = new Mesh(geom, createVoxelVertexColor())
```

---

## `pulsing-emissive.ts`

**What it does:** Object pulses between `base` color (PBR-lit) and `glow`
color (emissive add) at the configured `speed` (Hz).

**Why it matters:** Quest markers, selection halos, "loot here" indicators —
any always-visible UI cue stuck on a 3D object.

**Recipe:**

```ts
const pulse = sin(time.mul(speed)).mul(0.5).add(0.5)   // 0..1 sine wave
m.emissiveNode = uniform(glow).mul(pulse).mul(intensity)
```

`sin` returns -1..1; `.mul(0.5).add(0.5)` remaps to 0..1. Multiplying that
against the glow uniform gives a per-frame emissive boost that respects
the renderer's tone mapping.

**Performance note:** `time` is a single global uniform, so 1 000 cubes with
this material share one timer — no per-instance overhead.

---

## `fresnel-rim.ts`

**What it does:** Bright rim along the silhouette of the mesh (where the
surface normal is perpendicular to the view direction). Brightens with `power`
exponent — higher `power` = thinner rim.

**Why it matters:** Hover highlights, ghost shaders for placeable buildings,
"important NPC" outlines.

**Recipe:**

```ts
// dot(n,v): 1 face-on, 0 at silhouette
const ndotv = normalView.dot(positionViewDirection).clamp(0, 1)
// fresnel = (1 - n·v)^power: 0 face-on, peaking at silhouette
const fresnel = oneMinus(ndotv).pow(power)
m.emissiveNode = uniform(rim).mul(fresnel)
```

**Why view-space normals?** `positionViewDirection` is already in view space, so
`normalView.dot(positionViewDirection)` gives the angle between the surface and
the camera direction without extra matrix math. Using `normalWorld` would force
us to compute world-space view direction by hand — same result, more work.

**Tweaking:**
- `power = 1` → soft, painterly halo
- `power = 3` → typical hover glow
- `power = 8+` → razor-thin highlight pixel-line

---

## `dissolve.ts`

**What it does:** Procedural noise mask + alpha test discards fragments below
the threshold. Animate the threshold from 0 → 1 to make the mesh dissolve away.

**Why it matters:** Spawn-in / despawn-out FX without per-mesh particle systems.

**Recipe:**

```ts
const noise = mx_noise_float(positionLocal.mul(noiseScale))   // [-1, 1]
const remapped = noise.mul(0.5).add(0.5)                       // [0, 1]
m.opacityNode = step(thresholdU, remapped)                     // 0 if below, 1 if above
m.alphaTest = 0.5                                              // discard the 0s
m.transparent = true
```

The factory returns `{ material, threshold }` — the `threshold` is a TSL
`uniform`. Animate it from a system:

```ts
const { material, threshold } = createDissolve({ base: 0x66aaff })
// later, in a render-step system:
threshold.value = Math.min(1, threshold.value + dt * 0.5)   // dissolve over 2 s
```

**Why `mx_noise_float` and not `hash`?** `hash` is sharp/blocky; `mx_noise_float`
is the smooth MaterialX (Disney-style) noise — natural-looking dissolve edges.
Pay a tiny instruction-count cost for it.

**Why local position, not world?** Local-space input means the noise pattern
is stable as the object moves/rotates. World-space would make the dissolve
"swim" across the surface as the object animates.

---

## `wind-foliage.ts`

**What it does:** Vertex displacement that sways the top of the mesh while
keeping the base anchored.

**Why it matters:** Grass, leaves, banners — anything tall and skinny that
should react to wind without simulation cost.

**Recipe:**

```ts
const sway = positionLocal.y.clamp(0, 1).mul(amplitude)   // 0 at root, amplitude at top
const offsetX = sin(time.mul(frequency).add(positionLocal.z)).mul(sway)
const offsetZ = sin(time.mul(frequency).add(positionLocal.x)).mul(sway).mul(0.5)
m.positionNode = positionLocal.add(vec3(offsetX, 0, offsetZ))
```

**Why phase by `positionLocal.z` and `positionLocal.x`?** It varies the wave
phase across the geometry so different blades/leaves move out of sync — no
shader-side noise needed, just a position-coordinate offset.

**Why anchor with `clamp(0, 1)`?** It gates displacement to vertices above the
origin. If your grass model has its origin at the base (Y=0 = ground), this
gives a natural "rooted" sway. Models with a different pivot need a different
mask — e.g. read a custom `windWeight` attribute.

**Asymmetric Z-amplitude (`* 0.5`)** — main sway is left/right (X), minor
flutter front/back (Z). Cheap way to feel less mechanical.

---

## When you outgrow these

These five examples cover the majority of mesh effects you'll need for an
isometric voxel RPG. When you need something they can't express:

- **Volumetric / ray-march effects** — write a `wgslFn` and assign its output to `colorNode`.
- **Per-instance variation** (1000s of grass blades, each unique) — use `instanceIndex` in TSL to read per-instance attributes and multiply phases / colors / heights.
- **Multi-pass effects** — these aren't material-level, they're `RenderPipeline`-level. Phase 4+ territory.
- **Lighting customisation** — you can override `m.outputNode` to take full control of the post-lighting pixel value, but you lose three's PBR pipeline. Usually wrong.

See `tsl-cheatsheet.md` for the syntax reference and the inspiration list at
the bottom of that file for non-trivial three-source examples.

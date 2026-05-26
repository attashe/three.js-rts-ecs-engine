import type { BufferGeometry, InstancedMesh, Material, PointLight } from 'three'

/**
 * Public type surface for the FX package. Everything that crosses module
 * boundaries lives here so emitters, materials, registries, and the
 * top-level system can refer to the same shapes.
 */

export type EffectType =
    | 'rain'
    | 'snow'
    | 'fog'
    | 'dust'
    | 'embers'
    | 'magic'
    | 'fire'
    | 'fireTornado'
    | 'explosion'
    | 'leaves'
    | 'lightning'
    | 'boiling'
    | 'firefly'
    | 'water'
    | 'lava'

export interface Vec3Lite { x: number; y: number; z: number }

/** Serializable zone configuration. Only this object is saved to disk. */
export interface WeatherZoneParams {
    id?: string
    name: string
    type: EffectType

    position: Vec3Lite
    /** AABB extents in world units, centred on `position`. */
    size: Vec3Lite

    /** Primary tint (CSS hex). Liquid surfaces use this as base colour. */
    color: string

    /** Active particle count for the primary emitter. */
    count: number
    particleSize: number
    opacity: number
    /** Generic speed scalar — interpreted differently per emitter
     *  (m/s for rain, sway amplitude for snow, expansion rate for
     *  explosion, etc.). Keeps the editor surface uniform. */
    speed: number
    turbulence: number
    windX: number
    windZ: number
    gravity: number
    lifetime: number

    /** Stretched billboards for rain/dust streaks. */
    streaks: boolean
    streakLength: number

    lightEnabled: boolean
    lightColor: string
    lightIntensity: number
    lightDistance: number
    /** Sparse stochastic flashes coupled to the emitter (rain → storm,
     *  fire → explosion afterglow, embers → flares). */
    lightning: boolean

    /** Renderer hint: skip if it has been off-camera for at least this many
     *  seconds. The system applies a simple distance/visibility check. */
    cullAfterSeconds?: number
}

/** Compact preset entry consumed by `WeatherSystem.spawnPreset`. */
export interface ZonePreset {
    id: string
    label: string
    /** Defaults applied on top of the global zone defaults. */
    params: Partial<WeatherZoneParams> & Pick<WeatherZoneParams, 'type' | 'color'>
}

/**
 * Selects how the ambient pass paints sky, sun, and ambient light:
 *
 * - `outdoor` — derive sky/fog/sun/ambient from `timeOfDay` via the
 *   day-cycle table, then layer multiplicative modulators (`skyTint`,
 *   `sunIntensityMul`, `fogDensityMul`) on top. Authoring is "pick a
 *   time", not "pick seven colours that match".
 * - `indoor` — no sky dome, no directional sun, no hemisphere bounce.
 *   Ambient + fog are the only contributions; block-emitted PointLights
 *   are the primary illumination. Use for caves, dungeons, interiors.
 * - `custom` — read every colour field literally from state. Back-compat
 *   for stylised levels authored before the cycle existed, and the
 *   escape hatch for non-realistic palettes.
 */
export type EnvironmentMode = 'outdoor' | 'indoor' | 'custom'

export interface AmbientWeatherState {
    mode: EnvironmentMode
    /** Animate `timeOfDay` at runtime when true. Static (false) is the
     *  default so simple levels stay deterministic. */
    cycleEnabled: boolean
    /** Real-time seconds per full 24h cycle when `cycleEnabled` is true.
     *  600 = 10 minutes per in-game day. */
    cycleSeconds: number
    /** Multiplicative tint applied to derived sky top + bottom in outdoor
     *  mode (linear-space RGB, defaults to [1,1,1] = identity). */
    skyTint: [number, number, number]
    /** Multiplier on derived sun intensity in outdoor mode. */
    sunIntensityMul: number
    /** Multiplier on derived fog density in outdoor mode. */
    fogDensityMul: number
    skyTop: string
    skyBottom: string
    fogColor: string
    fogDensity: number
    sunIntensity: number
    sunColor: string
    ambientIntensity: number
    ambientColor: string
    timeOfDay: number
    sunAzimuth: number
    rainOn: boolean
    rainCount: number
    rainSpeed: number
    rainOpacity: number
    rainColor: string
    snowOn: boolean
    snowCount: number
    snowSpeed: number
    snowSway: number
    snowOpacity: number
    windX: number
    windZ: number
    windGusts: number
    lightningOn: boolean
    lightningRate: number
    lightningIntensity: number
    lightningColor: string
    cloudCoverage: number
}

export interface AmbientWeatherPreset {
    id: string
    label: string
    icon?: string
    apply: Partial<AmbientWeatherState>
}

/** Per-extra-layer data slot. Each emitter decides what scratch arrays
 *  live on `data`; the field is opaque to the rest of the system. */
export interface ExtraLayer {
    /** Stable identifier the emitter uses to look itself up via
     *  `WeatherZoneRuntime.findExtra`. */
    type: string
    count: number
    mesh: InstancedMesh
    geometry: BufferGeometry
    material: Material
    /** Free-form per-layer scratch state. Emitters cast it to their own
     *  per-layer interface; do NOT touch from outside the owning emitter. */
    data: Record<string, Float32Array | Float64Array | Uint32Array | Int32Array | number | boolean>
}

/** Live, non-serialized state owned by a single zone. Emitters receive
 *  this so they can read the params, read/write the particle pool, and
 *  cooperate with extra layers without holding refs to the Three group. */
export interface WeatherZoneRuntime {
    readonly params: WeatherZoneParams
    /** Time the zone has been alive (seconds, monotonic). */
    elapsed: number
    /** Particles pool — read/write directly from emitters. */
    readonly particles: ParticlePool
    /** Primary InstancedMesh that renders the particles. Set by the
     *  WeatherZone after the strategy's `create()` returns. */
    primary: InstancedMesh | null
    /** Extra emitter layers (smoke, sparks, splashes, halos…). */
    readonly extras: ExtraLayer[]
    /** Per-zone PointLight; emitters may modulate `intensity`/`position`. */
    readonly light: PointLight
    /** Optional liquid surface (water / lava). Owned by the zone group;
     *  emitters animate it from `update`. */
    surface: import('three').Mesh | null
    surfaceOverlay: import('three').Mesh | null
    /** Persistent random seed so an emitter's per-step jitter is
     *  reproducible if you re-init from the same zone params. */
    readonly seed: number
    /** Set to true while the zone is within the active LOD/visibility
     *  budget; emitters can skip work when false. */
    visible: boolean
    /** Set to true to schedule a re-build on the next update. */
    dirty: boolean
    findExtra(type: string): ExtraLayer | undefined
}

/** Per-particle typed arrays. The pool is allocated once at peak
 *  `count` and indexed by integer particle id. No per-frame GC. */
export interface ParticlePool {
    count: number
    capacity: number
    positions: Float32Array
    velocities: Float32Array
    phases: Float32Array
    ages: Float32Array
    lifetimes: Float32Array
    seeds: Float32Array
    sizes: Float32Array
}

/** Lifecycle contract every emitter implements. Stateless across zones —
 *  per-zone state lives on `WeatherZoneRuntime`. */
export interface EmitterStrategy {
    readonly type: EffectType
    /** Build the primary InstancedMesh and any extra layers. Called once
     *  per zone build/rebuild. Must return ready-to-render Three objects;
     *  the caller will attach them to the zone group. */
    create(runtime: WeatherZoneRuntime, deps: EmitterDeps): EmitterCreated
    /** Initialize particle `i`. `recycle = true` means the particle just
     *  died (or hit a respawn boundary) and needs to be repositioned in
     *  the spawn-side region; `false` is first-build initialization. */
    spawn(runtime: WeatherZoneRuntime, i: number, recycle: boolean, rng: () => number): void
    /** Advance particle positions/velocities/ages for `dt` seconds. Also
     *  steps the emitter's extra layers. */
    update(runtime: WeatherZoneRuntime, dt: number, elapsed: number, rng: () => number): void
    /** Push state into the InstancedMesh matrices/attributes. Called once
     *  per frame after `update`. */
    write(runtime: WeatherZoneRuntime, elapsed: number, ctx: WriteContext): void
    /** Tear down — geometries, materials, scratch arrays. */
    dispose(runtime: WeatherZoneRuntime): void
}

export interface EmitterDeps {
    textures: TextureRegistryView
    materials: MaterialRegistryView
}

export interface EmitterCreated {
    primary: InstancedMesh
    extras: ExtraLayer[]
    /** Optional liquid surface mesh (water / lava). The zone wraps it
     *  into its group; the emitter still owns simulation. */
    surface?: import('three').Mesh
    surfaceOverlay?: import('three').Mesh
}

export interface WriteContext {
    cameraPosition: { x: number; y: number; z: number }
    /** World position of the owning zone group. Instance matrices are
     *  written in zone-local space, but billboards still need world-space
     *  coordinates to face the camera correctly. */
    zonePosition: { x: number; y: number; z: number }
    /** Pre-allocated scratch Object3D the emitter can use for matrix
     *  composition (`updateMatrix` → `setMatrixAt`). Saves per-zone
     *  allocations. */
    dummy: import('three').Object3D
}

export interface TextureRegistryView {
    particle(kind: string): import('three').Texture
    surface(kind: string): import('three').Texture
}

export interface MaterialRegistryView {
    particleMaterial(opts: ParticleMaterialOpts): import('three').Material
    /** Mark a material returned earlier as no longer in use by this
     *  emitter. Registry refcounts and disposes when refs hit zero. */
    release(material: import('three').Material): void
}

export interface ParticleMaterialOpts {
    texture: import('three').Texture
    color: string | number
    opacity: number
    depthWrite?: boolean
    additive?: boolean
    /** Whether the registry should treat materials as cache-shared. Set
     *  to false for materials whose `color` you mutate per frame. */
    cacheable?: boolean
}

import {
    BufferAttribute,
    BufferGeometry,
    Group,
    Mesh,
    MeshStandardMaterial,
    type Scene,
} from 'three'

/**
 * Distant background scenery — authored, per-location ranges of simplified
 * low-poly mountains that fill the band between the playable level and the
 * sky so the player sees a vista far below/beyond when they climb.
 *
 * Deliberately *not* procedural-random: each layer is a designer-tuned band
 * (distance / height / colour / seed) so a story location's backdrop is
 * predictable and hand-aligned. It's real geometry — `MeshStandardMaterial`
 * picks up the scene's sun + ambient and `fog: true` fades it into the sky —
 * so it tracks the day-cycle and weather automatically, with no static image
 * to fall out of sync.
 *
 * The group recentres on a focus point in XZ each frame (Y fixed), so the
 * ranges read as unreachable distant scenery that surrounds the player
 * everywhere in the location, while staying *below* eye level as they ascend.
 */
export interface BackdropLayer {
    /** Determinism seed for the silhouette. Same seed ⇒ same ridge. */
    seed?: number
    /** Ring radius from the backdrop centre, world units. Farther + lighter +
     *  foggier layers read as more distant. */
    distance: number
    /** Arc the band spans, degrees. Default 360 (a full surrounding ring). */
    arcDeg?: number
    /** Centre compass direction of the arc, degrees (0 = +X, 90 = +Z).
     *  Default 0. Use with `arcDeg < 360` to place a range on one side. */
    centerDeg?: number
    /** Silhouette resolution across the arc. Default 96. */
    segments?: number
    /** World Y of the ridge base. */
    baseY: number
    /** Peak height above `baseY`. */
    height: number
    /** How far the bottom edge drops below `baseY` to avoid a gap under the
     *  ridge. Default = `height`. */
    skirt?: number
    /** Silhouette jaggedness, 0..1. Default 0.5. */
    ruggedness?: number
    /** Linear-RGB colour at the ridge base and the peaks; fog blends both
     *  toward the sky colour with distance. */
    colorLow: [number, number, number]
    colorHigh: [number, number, number]
}

export interface BackdropScenery {
    group: Group
    /** Recentre the ranges on a focus point (the camera target / player) in
     *  XZ. No-op when `follow` is false. */
    update(focusX: number, focusZ: number): void
    dispose(): void
}

export interface BackdropSceneryOptions {
    /** Keep the ranges centred on the focus point in XZ (Y stays fixed) so the
     *  vista surrounds the player everywhere in the location. Default true.
     *  Set false to pin the backdrop at world origin. */
    follow?: boolean
}

const DEFAULT_SEGMENTS = 96

/**
 * Build the non-indexed ridge "curtain" geometry for one layer: a strip of
 * silhouette columns around the arc, jagged top edge, flat skirt below.
 * Pure + deterministic — drives both the renderer and the tests.
 */
export function buildBackdropLayerGeometry(layer: BackdropLayer): BufferGeometry {
    const segments = Math.max(3, Math.floor(layer.segments ?? DEFAULT_SEGMENTS))
    const arc = ((layer.arcDeg ?? 360) * Math.PI) / 180
    const center = ((layer.centerDeg ?? 0) * Math.PI) / 180
    const skirt = layer.skirt ?? layer.height
    const ruggedness = clamp01(layer.ruggedness ?? 0.5)
    const bottomY = layer.baseY - skirt
    const octaves = ridgeOctaves(layer.seed ?? 1)

    // Column positions + top heights.
    const cols: { x: number; z: number; topY: number; h01: number }[] = []
    const closed = (layer.arcDeg ?? 360) >= 360
    for (let i = 0; i <= segments; i++) {
        const f = i / segments
        // For a full ring the last column must equal the first so the seam closes.
        const theta = closed ? center + f * Math.PI * 2 : center - arc / 2 + arc * f
        const h01 = ridge01(closed ? f : f, octaves, ruggedness)
        cols.push({
            x: Math.cos(theta) * layer.distance,
            z: Math.sin(theta) * layer.distance,
            topY: layer.baseY + layer.height * h01,
            h01,
        })
    }

    const quadCount = segments
    const positions = new Float32Array(quadCount * 6 * 3)
    const colors = new Float32Array(quadCount * 6 * 3)
    let p = 0
    let c = 0
    const lo = layer.colorLow
    const hi = layer.colorHigh
    const pushVert = (x: number, y: number, z: number, h01: number): void => {
        positions[p++] = x
        positions[p++] = y
        positions[p++] = z
        // Peaks tend toward colorHigh; the skirt is colorLow.
        const t = y <= bottomY + 1e-4 ? 0 : 0.35 + 0.65 * h01
        colors[c++] = lo[0] + (hi[0] - lo[0]) * t
        colors[c++] = lo[1] + (hi[1] - lo[1]) * t
        colors[c++] = lo[2] + (hi[2] - lo[2]) * t
    }

    for (let i = 0; i < segments; i++) {
        const a = cols[i]!
        const b = cols[i + 1]!
        // Tri 1: a-bottom, b-bottom, a-top
        pushVert(a.x, bottomY, a.z, 0)
        pushVert(b.x, bottomY, b.z, 0)
        pushVert(a.x, a.topY, a.z, a.h01)
        // Tri 2: a-top, b-bottom, b-top
        pushVert(a.x, a.topY, a.z, a.h01)
        pushVert(b.x, bottomY, b.z, 0)
        pushVert(b.x, b.topY, b.z, b.h01)
    }

    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(positions, 3))
    geo.setAttribute('color', new BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
}

/**
 * Build and own the backdrop meshes for a set of authored layers. Rebuild per
 * location (dispose + recreate on level load).
 */
export function createBackdropScenery(
    scene: Scene,
    layers: readonly BackdropLayer[],
    options: BackdropSceneryOptions = {},
): BackdropScenery {
    const follow = options.follow !== false
    const group = new Group()
    group.name = 'BackdropScenery'
    const meshes: Mesh[] = []

    for (const layer of layers) {
        const geometry = buildBackdropLayerGeometry(layer)
        const material = new MeshStandardMaterial({
            vertexColors: true,
            flatShading: true,
            roughness: 1,
            metalness: 0,
            fog: true,
        })
        const mesh = new Mesh(geometry, material)
        mesh.castShadow = false
        mesh.receiveShadow = false
        // Distant ridges read behind everything; they're far enough to depth-
        // sort correctly, but skip frustum culling so a recentred ring never
        // pops when the camera looks along its seam.
        mesh.frustumCulled = false
        group.add(mesh)
        meshes.push(mesh)
    }

    scene.add(group)

    return {
        group,
        update(focusX, focusZ) {
            if (!follow) return
            group.position.x = focusX
            group.position.z = focusZ
        },
        dispose() {
            for (const mesh of meshes) {
                group.remove(mesh)
                mesh.geometry.dispose()
                ;(mesh.material as MeshStandardMaterial).dispose()
            }
            meshes.length = 0
            scene.remove(group)
        },
    }
}

// ── Silhouette noise ────────────────────────────────────────────────────

interface RidgeOctave {
    freq: number
    amp: number
    phase: number
}

/** Derive a few sine octaves from a seed — deterministic, smooth, and seam-
 *  safe for a full ring (integer frequencies repeat over [0,1)). */
function ridgeOctaves(seed: number): RidgeOctave[] {
    const rng = mulberry32(seed >>> 0)
    const octaves: RidgeOctave[] = []
    let amp = 1
    let freq = 1
    let total = 0
    for (let i = 0; i < 5; i++) {
        const a = amp * (0.6 + rng() * 0.4)
        octaves.push({ freq: Math.round(freq), amp: a, phase: rng() * Math.PI * 2 })
        total += a
        amp *= 0.55
        freq *= 2
    }
    for (const o of octaves) o.amp /= total // normalise so the sum lands in [0,1]
    return octaves
}

/** Ridge height in [0,1] at arc fraction `f`. `rugged` sharpens the peaks. */
function ridge01(f: number, octaves: RidgeOctave[], rugged: number): number {
    let v = 0
    for (const o of octaves) v += o.amp * (0.5 + 0.5 * Math.sin(f * o.freq * Math.PI * 2 + o.phase))
    // Contrast curve: higher ruggedness pushes toward sharper, taller peaks.
    const gamma = 1 + rugged * 1.5
    return clamp01(Math.pow(clamp01(v), gamma))
}

function clamp01(v: number): number {
    return v < 0 ? 0 : v > 1 ? 1 : v
}

function mulberry32(seed: number): () => number {
    let t = seed || 1
    return () => {
        t += 0x6d2b79f5
        let r = t
        r = Math.imul(r ^ (r >>> 15), r | 1)
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
}

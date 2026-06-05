import { Color, PointLight, type Camera, type Scene } from 'three'
import type { System } from '../ecs/systems/system'
import { RenderOrder } from '../ecs/systems/orders'
import type { ChunkManager } from './chunk-manager'
import { CHUNK_DIM, chunkKey, type Chunk, type ChunkKey } from './chunk'
import { voxelLightSpec, type BlockLightSpec, type Palette } from './palette'
import { RENDER_LAYER } from '../render/render-layers'
import { chunkCoordsInRadius, focusChunk, sameChunk, type ChunkCoord } from './chunk-streaming'

export interface BlockLightSystemOptions {
    scene: Scene
    /** Camera provider — used to rank candidate light sources by distance.
     *  Match the renderer's camera so culling reflects what the player sees. */
    camera: () => Camera
    /** Max simultaneous lit block lights. Default 12 (above the FX budget of
     *  6–8 because a lamp-block-heavy level is a legitimate authored setup). */
    maxLights?: number
    /** Per-cell intensity scale. Default 1. Useful for global dimming when
     *  many emissive blocks would otherwise wash out the scene. */
    intensityScale?: number
    /** Focus point (player / camera target). When provided, only emissive
     *  voxels in chunks within `trackRadiusChunks` are tracked, so the source
     *  set — and the per-frame nearest-selection — is bounded by nearby
     *  content rather than the whole world. Without it, every chunk is scanned
     *  (back-compat). */
    focus?: () => { x: number; y: number; z: number }
    /** Chebyshev chunk radius for `focus` tracking. Default 6. */
    trackRadiusChunks?: number
}

export interface BlockLightSource {
    key: string
    chunkKey: ChunkKey
    x: number
    y: number
    z: number
    spec: BlockLightSpec
}

const SHADOW_NEAR = 0.1

/**
 * Per-voxel point lights driven by the palette's `lightIntensity` field.
 * Scans dirty chunks each frame, records every light-emitting voxel, then
 * maps the nearest sources onto a small fixed `PointLight` pool. The scene's
 * simultaneous-light count stays capped even if an author paints a large
 * cluster of emissive blocks.
 *
 * Lights are positioned at the voxel centre (cell + 0.5). castShadow is
 * off by default — block lights are a fill, not a shadow source — but
 * each palette entry can opt in via `lightCastsShadow: true`. Use this
 * flag to isolate shadow-pipeline artefacts in a controlled test room.
 *
 * Editor palette edits (which do NOT bump per-chunk versions) are picked
 * up via a cheap palette fingerprint check: when emissive/light fields
 * on any entry change, the system does one full rescan on the next frame.
 */
export function createBlockLightSystem(chunks: ChunkManager, opts: BlockLightSystemOptions): System {
    const { scene, camera } = opts
    const sources = new Map<string, BlockLightSource>()
    // Keyed by the Chunk object (stable) so the per-frame change scan never
    // allocates a `chunkKey` string. `epoch` marks chunks visited this pass for
    // focus-radius eviction.
    const scanned = new Map<Chunk, { version: number; epoch: number }>()
    const maxLights = opts.maxLights ?? 12
    const intensityScale = Math.max(0, opts.intensityScale ?? 1)
    const trackRadiusChunks = Math.max(1, Math.floor(opts.trackRadiusChunks ?? 6))
    const pool: PointLight[] = []
    let paletteFingerprint = 0
    let scanEpoch = 0
    let lastFocusChunk: ChunkCoord | null = null
    let lastChunkCount = -1

    function applySpec(light: PointLight, spec: BlockLightSpec): void {
        const wanted = spec.intensity * intensityScale
        light.color.setRGB(spec.color[0], spec.color[1], spec.color[2])
        light.intensity = wanted
        light.distance = spec.distance
        light.castShadow = spec.castShadow
        if (spec.castShadow) {
            light.shadow.mapSize.set(256, 256)
            light.shadow.camera.near = SHADOW_NEAR
            light.shadow.camera.far = Math.max(spec.distance, 4)
            light.shadow.bias = -0.0008
            light.shadow.normalBias = 0.04
            light.shadow.camera.updateProjectionMatrix()
        }
        ;(light.userData as Record<string, unknown>).wanted = wanted
    }

    function spawnPoolLight(): PointLight {
        const light = new PointLight(new Color(), 0, 1, 1.6)
        // Glow-block lights should also illuminate the player (who
        // lives on a non-default render layer — see render-layers.ts).
        // Without this, walking past a glow block leaves the player
        // unlit.
        light.layers.enable(RENDER_LAYER.PLAYER)
        scene.add(light)
        return light
    }

    function disposePool(): void {
        for (const light of pool) {
            light.removeFromParent()
            light.dispose()
        }
        pool.length = 0
    }

    function dropChunk(ck: ChunkKey): void {
        for (const [key, source] of sources) {
            if (source.chunkKey !== ck) continue
            sources.delete(key)
        }
    }

    function scanChunk(chunk: Chunk): void {
        // Build the string key only here (on an actual change), not in the
        // per-frame version scan below.
        const ck = chunkKey(chunk.cx, chunk.cy, chunk.cz)
        dropChunk(ck)
        const baseX = chunk.cx * CHUNK_DIM
        const baseY = chunk.cy * CHUNK_DIM
        const baseZ = chunk.cz * CHUNK_DIM
        chunk.forEachSolid((lx, ly, lz, value) => {
            const spec = voxelLightSpec(chunks.palette, value)
            if (!spec) return
            const wx = baseX + lx, wy = baseY + ly, wz = baseZ + lz
            const key = `${wx},${wy},${wz}`
            sources.set(key, { key, chunkKey: ck, x: wx + 0.5, y: wy + 0.5, z: wz + 0.5, spec })
        })
        scanned.set(chunk, { version: chunk.version, epoch: scanEpoch })
    }

    function reconcileChunk(chunk: Chunk): void {
        const entry = scanned.get(chunk)
        if (entry && entry.version === chunk.version) {
            entry.epoch = scanEpoch
            return
        }
        scanChunk(chunk)
    }

    /** Walk chunks (all, or only those near the focus) into the source set,
     *  then drop sources for chunks not visited this pass. */
    function reconcile(): void {
        scanEpoch++
        const focus = opts.focus?.()
        if (!focus) {
            for (const chunk of chunks.allChunks()) reconcileChunk(chunk)
        } else {
            const center = focusChunk(focus)
            const count = chunks.chunkCount()
            const reevaluate = !lastFocusChunk || !sameChunk(center, lastFocusChunk) || count !== lastChunkCount
            lastFocusChunk = center
            lastChunkCount = count
            if (reevaluate) {
                for (const cc of chunkCoordsInRadius(center, trackRadiusChunks)) {
                    const chunk = chunks.getChunk(cc.cx, cc.cy, cc.cz)
                    if (chunk) reconcileChunk(chunk)
                }
            } else {
                for (const [chunk, entry] of scanned) {
                    entry.epoch = scanEpoch
                    if (entry.version !== chunk.version) scanChunk(chunk)
                }
            }
        }
        for (const [chunk, entry] of scanned) {
            if (entry.epoch === scanEpoch) continue
            dropChunk(chunkKey(chunk.cx, chunk.cy, chunk.cz))
            scanned.delete(chunk)
        }
    }

    function fullRescan(): void {
        sources.clear()
        scanned.clear()
        lastFocusChunk = null // force a full radius re-walk
        reconcile()
    }

    function syncPool(cam: Camera): void {
        const selected = selectNearestSources(sources.values(), cam, maxLights)
        for (let i = 0; i < selected.length; i++) {
            const source = selected[i]!
            const light = pool[i] ?? (pool[i] = spawnPoolLight())
            light.position.set(source.x, source.y, source.z)
            applySpec(light, source.spec)
            light.visible = true
        }
        for (let i = selected.length; i < pool.length; i++) {
            const light = pool[i]!
            light.intensity = 0
            light.visible = false
            ;(light.userData as Record<string, unknown>).wanted = 0
        }
    }

    function fingerprintPalette(): number {
        return hashLightPalette(chunks.palette)
    }

    return {
        name: 'blockLights',
        order: RenderOrder.blockLights,
        init() {
            paletteFingerprint = fingerprintPalette()
            fullRescan()
        },
        update() {
            const fp = fingerprintPalette()
            if (fp !== paletteFingerprint) {
                paletteFingerprint = fp
                fullRescan()
            } else {
                reconcile()
            }
            syncPool(camera())
        },
        dispose() {
            disposePool()
            sources.clear()
            scanned.clear()
        },
    }
}

/**
 * Numeric fingerprint of the palette's emissive/light fields. Replaces a
 * per-frame ~40-entry string build with an allocation-free fold, so the
 * editor-palette-edit guard costs nothing at runtime (where the palette is
 * fixed). Changes only when an emissive/light field changes ⇒ one rescan.
 */
function hashLightPalette(palette: Palette): number {
    let h = 0x811c9dc5
    h = foldByte(h, palette.entries.length)
    for (const entry of palette.entries) {
        const e = entry.emissive
        const lc = entry.lightColor ?? entry.emissive ?? entry.color
        h = foldNum(h, e ? e[0] : 0)
        h = foldNum(h, e ? e[1] : 0)
        h = foldNum(h, e ? e[2] : 0)
        h = foldNum(h, entry.emissiveIntensity ?? 0)
        h = foldNum(h, lc[0])
        h = foldNum(h, lc[1])
        h = foldNum(h, lc[2])
        h = foldNum(h, entry.lightIntensity ?? 0)
        h = foldNum(h, entry.lightDistance ?? 0)
        h = foldByte(h, entry.lightCastsShadow ? 1 : 0)
    }
    return h >>> 0
}

/** Fold a (quantised) float into an FNV-1a-style hash, byte by byte. */
function foldNum(h: number, v: number): number {
    let q = Math.round(v * 1000) | 0
    h = foldByte(h, q & 0xff)
    q >>= 8
    h = foldByte(h, q & 0xff)
    q >>= 8
    h = foldByte(h, q & 0xff)
    return h
}

function foldByte(h: number, byte: number): number {
    return Math.imul((h ^ (byte & 0xff)) >>> 0, 16777619) >>> 0
}

export function selectNearestSources(
    sources: Iterable<BlockLightSource>,
    camera: Camera,
    maxLights: number,
): BlockLightSource[] {
    const arr: { source: BlockLightSource; d2: number }[] = []
    for (const source of sources) {
        const dx = source.x - camera.position.x
        const dy = source.y - camera.position.y
        const dz = source.z - camera.position.z
        arr.push({ source, d2: dx * dx + dy * dy + dz * dz })
    }
    arr.sort((a, b) => a.d2 - b.d2)
    const cap = Number.isFinite(maxLights)
        ? Math.max(0, Math.floor(maxLights))
        : arr.length
    return arr.slice(0, cap).map((entry) => entry.source)
}

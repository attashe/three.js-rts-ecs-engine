import { Color, PointLight, type Camera, type Scene } from 'three'
import type { System } from '../ecs/systems/system'
import { RenderOrder } from '../ecs/systems/orders'
import type { ChunkManager } from './chunk-manager'
import { CHUNK_DIM, chunkKey, type ChunkKey } from './chunk'
import { voxelLightSpec, type BlockLightSpec } from './palette'
import { RENDER_LAYER } from '../render/render-layers'

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
    const scannedVersion = new Map<ChunkKey, number>()
    const maxLights = opts.maxLights ?? 12
    const intensityScale = Math.max(0, opts.intensityScale ?? 1)
    const pool: PointLight[] = []
    let paletteFingerprint = ''

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

    function scanChunk(cx: number, cy: number, cz: number): void {
        const chunk = chunks.getChunk(cx, cy, cz)
        const ck = chunkKey(cx, cy, cz)
        dropChunk(ck)
        if (!chunk) {
            scannedVersion.delete(ck)
            return
        }
        const baseX = cx * CHUNK_DIM
        const baseY = cy * CHUNK_DIM
        const baseZ = cz * CHUNK_DIM
        chunk.forEachSolid((lx, ly, lz, value) => {
            const spec = voxelLightSpec(chunks.palette, value)
            if (!spec) return
            const wx = baseX + lx, wy = baseY + ly, wz = baseZ + lz
            const key = `${wx},${wy},${wz}`
            sources.set(key, { key, chunkKey: ck, x: wx + 0.5, y: wy + 0.5, z: wz + 0.5, spec })
        })
        scannedVersion.set(ck, chunk.version)
    }

    function fullRescan(): void {
        sources.clear()
        scannedVersion.clear()
        for (const chunk of chunks.allChunks()) {
            scanChunk(chunk.cx, chunk.cy, chunk.cz)
        }
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

    function fingerprintPalette(): string {
        // Length-prefix + per-entry emissive/light fields. Cheap to recompute
        // (we run it once per frame); changes only when an editor user
        // touches the palette UI, so the resulting full rescan is rare.
        const parts: string[] = [String(chunks.palette.entries.length)]
        for (const entry of chunks.palette.entries) {
            const e = entry.emissive ?? [0, 0, 0]
            const lc = entry.lightColor ?? entry.emissive ?? entry.color
            parts.push(
                `${e[0]},${e[1]},${e[2]}|${entry.emissiveIntensity ?? 0}|` +
                `${lc[0]},${lc[1]},${lc[2]}|${entry.lightIntensity ?? 0}|` +
                `${entry.lightDistance ?? 0}|${entry.lightCastsShadow ? 1 : 0}`,
            )
        }
        return parts.join(';')
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
                for (const chunk of chunks.allChunks()) {
                    const ck = chunkKey(chunk.cx, chunk.cy, chunk.cz)
                    if (scannedVersion.get(ck) === chunk.version) continue
                    scanChunk(chunk.cx, chunk.cy, chunk.cz)
                }
            }
            syncPool(camera())
        },
        dispose() {
            disposePool()
            sources.clear()
            scannedVersion.clear()
        },
    }
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

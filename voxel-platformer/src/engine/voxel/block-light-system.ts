import { Color, PointLight, type Camera, type Scene } from 'three'
import type { System } from '../ecs/systems/system'
import { RenderOrder } from '../ecs/systems/orders'
import { LightBudget } from '../fx/lights/light-budget'
import type { ChunkManager } from './chunk-manager'
import { CHUNK_DIM, chunkKey, type ChunkKey } from './chunk'
import { voxelLightSpec, type BlockLightSpec } from './palette'

export interface BlockLightSystemOptions {
    scene: Scene
    /** Camera provider — used by the LightBudget to rank lights by distance.
     *  Match the renderer's camera so culling reflects what the player sees. */
    camera: () => Camera
    /** Max simultaneous lit block lights. Default 12 (above the FX budget of
     *  6–8 because a lamp-block-heavy level is a legitimate authored setup). */
    maxLights?: number
    /** Per-cell intensity scale. Default 1. Useful for global dimming when
     *  many emissive blocks would otherwise wash out the scene. */
    intensityScale?: number
}

interface BlockLightRecord {
    key: string
    light: PointLight
    chunkKey: ChunkKey
}

const SHADOW_NEAR = 0.1

/**
 * Per-voxel point lights driven by the palette's `lightIntensity` field.
 * Scans dirty chunks each frame, syncs a pool of `PointLight`s to match
 * the current voxel state, then runs them through a `LightBudget` so the
 * scene's simultaneous-light count stays predictable.
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
    const records = new Map<string, BlockLightRecord>()
    const scannedVersion = new Map<ChunkKey, number>()
    const budget = new LightBudget(opts.maxLights ?? 12)
    const intensityScale = Math.max(0, opts.intensityScale ?? 1)
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

    function spawnRecord(spec: BlockLightSpec, wx: number, wy: number, wz: number, ck: ChunkKey): BlockLightRecord {
        const light = new PointLight(new Color(), 0, 1, 1.6)
        light.position.set(wx + 0.5, wy + 0.5, wz + 0.5)
        applySpec(light, spec)
        scene.add(light)
        return { key: `${wx},${wy},${wz}`, light, chunkKey: ck }
    }

    function disposeRecord(record: BlockLightRecord): void {
        record.light.removeFromParent()
        record.light.dispose()
    }

    function dropChunk(ck: ChunkKey): void {
        for (const [key, record] of records) {
            if (record.chunkKey !== ck) continue
            disposeRecord(record)
            records.delete(key)
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
            const record = spawnRecord(spec, wx, wy, wz, ck)
            records.set(record.key, record)
        })
        scannedVersion.set(ck, chunk.version)
    }

    function fullRescan(): void {
        for (const record of records.values()) disposeRecord(record)
        records.clear()
        scannedVersion.clear()
        for (const chunk of chunks.allChunks()) {
            scanChunk(chunk.cx, chunk.cy, chunk.cz)
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
            if (records.size === 0) return
            budget.apply(collectLights(records), camera())
        },
        dispose() {
            for (const record of records.values()) disposeRecord(record)
            records.clear()
            scannedVersion.clear()
        },
    }
}

function collectLights(records: Map<string, BlockLightRecord>): PointLight[] {
    const out: PointLight[] = new Array(records.size)
    let i = 0
    for (const record of records.values()) out[i++] = record.light
    return out
}

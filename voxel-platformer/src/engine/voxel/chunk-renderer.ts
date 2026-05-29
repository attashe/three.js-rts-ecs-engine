import { BufferAttribute, BufferGeometry, DataTexture, Mesh, type Scene } from 'three'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import type { ChunkManager } from './chunk-manager'
import { Chunk, CHUNK_DIM, chunkKey, type ChunkKey } from './chunk'
import { buildVoxelAtlas } from './atlas-builder'
import { greedyMesh, type VoxelSampler } from './greedy-mesher'
import { liquidTopSurfaceMesh, type LiquidSurfaceMeshData } from './liquid-surface-mesher'
import { createAtlasTexture, createVoxelVertexColor, type VoxelMaterial } from '../render/materials/voxel-vertex-color'
import { getDebugInfoEnabled, getRenderTextures, subscribeDebugInfo, subscribeRenderTextures } from '../render/render-settings'
import {
    createBlockLavaSurfaceMaterial,
    createBlockWaterSurfaceMaterial,
    type LavaBlockSurfaceMaterial,
    type WaterBlockSurfaceMaterial,
} from '../fx/materials/liquid-surfaces'
import { BLOCK, paletteEntry, type LiquidBlockKind, type Palette } from './palette'
import {
    chunkCoordsInRadius,
    chunkDistanceSq,
    coordKey,
    diffActiveSet,
    focusChunk,
    isWithinRadius,
    sameChunk,
    type ChunkCoord,
    type ChunkStreamingConfig,
} from './chunk-streaming'

const LIQUID_BLOCK_SURFACE_RENDER_ORDER = 32

type ChunkLiquidSurfaces = Partial<Record<LiquidBlockKind, Mesh>>

export interface ChunkRendererOptions {
    /** Enable mesh streaming around a focus point. Omit for the legacy
     *  "mesh every chunk" behaviour (still right for small levels + the
     *  editor). */
    streaming?: ChunkStreamingConfig
}

/**
 * Owns the THREE.Mesh per chunk. Each frame, drains `manager.drainDirty()`
 * and re-meshes whichever chunks changed. Empty chunks are removed from the
 * scene; new chunks are added on first build.
 *
 * Phase 3 ships synchronous meshing on the main thread — fine for the demo's
 * ~4 chunks. Phase 3+ can swap `greedyMesh` for a worker-pool variant in
 * `update()` without touching anything else.
 */
export class ChunkRenderer {
    private readonly scene: Scene
    private readonly manager: ChunkManager
    private readonly material: MeshStandardNodeMaterial
    private readonly voxelMaterial: VoxelMaterial
    private readonly atlasTexture: DataTexture
    private readonly waterSurfaceMaterial: WaterBlockSurfaceMaterial
    private readonly lavaSurfaceMaterial: LavaBlockSurfaceMaterial
    private readonly meshByKey: Map<ChunkKey, Mesh> = new Map()
    private readonly liquidSurfaceByKey: Map<ChunkKey, ChunkLiquidSurfaces> = new Map()
    private readonly meshedVersion: Map<ChunkKey, number> = new Map()
    private readonly unsubscribeTextures: () => void
    private readonly unsubscribeDebugInfo: () => void
    private debugInfoEnabled = getDebugInfoEnabled()
    private cutY: number | null = null

    // Mesh-streaming state (null config ⇒ legacy "mesh everything").
    private readonly streaming: ChunkStreamingConfig | null
    /** Chunk keys currently meshed (within the focus radius). Voxel data for
     *  these and all other chunks stays resident in the manager. */
    private readonly activeChunks: Map<ChunkKey, ChunkCoord> = new Map()
    /** Chunk keys awaiting a (re)mesh, drained nearest-first under the budget. */
    private readonly pending: Map<ChunkKey, ChunkCoord> = new Map()
    private lastFocusChunk: ChunkCoord | null = null

    constructor(scene: Scene, manager: ChunkManager, options: ChunkRendererOptions = {}) {
        this.scene = scene
        this.manager = manager
        this.streaming = options.streaming ?? null
        // Build the atlas once at startup — it's a few hundred KB of
        // RGBA, deterministic, and shared by every chunk mesh in the
        // scene. Mirror this in the chunk material so the toggle uniform
        // and the texture sampler refer to the same DataTexture.
        const atlas = buildVoxelAtlas()
        this.atlasTexture = createAtlasTexture(atlas.rgba, atlas.width, atlas.height)
        this.voxelMaterial = createVoxelVertexColor({
            flatShading: true,
            atlas: this.atlasTexture,
            texturesEnabled: getRenderTextures(),
        })
        this.material = this.voxelMaterial.material
        this.waterSurfaceMaterial = createBlockWaterSurfaceMaterial({
            depthTest: true,
            opacity: 0.70,
            shallowColor: paletteColorHex(this.manager.palette, 'water'),
        })
        this.lavaSurfaceMaterial = createBlockLavaSurfaceMaterial({
            depthTest: true,
            hotColor: paletteColorHex(this.manager.palette, 'lava'),
        })
        // Live toggle: when the user flips the Display setting we just
        // update the uniform. No remesh — geometry is unaffected, only
        // the per-fragment multiplier changes.
        this.unsubscribeTextures = subscribeRenderTextures((enabled) => {
            this.voxelMaterial.setTexturesEnabled(enabled)
        })
        this.unsubscribeDebugInfo = subscribeDebugInfo((enabled) => {
            if (this.debugInfoEnabled === enabled) return
            this.debugInfoEnabled = enabled
            this.remeshVisible()
        })
    }

    /** Rebuild whatever is currently on screen. Under streaming this re-queues
     *  the active working set (budgeted over the next frames); otherwise it
     *  remeshes every loaded chunk immediately. Used by cut + debug toggles
     *  that change geometry without bumping any chunk's version. */
    private remeshVisible(): void {
        if (this.streaming) {
            this.requeueActiveForRebuild()
            return
        }
        for (const c of this.manager.allChunks()) {
            this.remesh(c)
        }
        this.manager.drainDirty()
    }

    private requeueActiveForRebuild(): void {
        for (const [key, coord] of this.activeChunks) {
            this.meshedVersion.delete(key)
            this.pending.set(key, coord)
        }
    }

    /** Mark the working-plane row. The material uses this to fade covered
     *  active-layer cells. The remesh treats cells above this row as air so
     *  hidden upper layers expose readable faces below them. Pass `null` to
     *  disable the cut. */
    setCutY(y: number | null): void {
        if (this.cutY === y) return
        this.cutY = y
        this.voxelMaterial.setCutY(y)
        this.remeshVisible()
    }

    /** Replace the cover mask — world-cell XZ columns that have hidden
     *  geometry above the working plane. Matching active-layer cells render
     *  faded so the user can tell upper geometry exists there. */
    setCoverMaskCells(cells: Iterable<{ x: number; z: number }>): void {
        this.voxelMaterial.setCoverMaskCells(cells)
    }

    /** Force a full remesh (e.g. after bulk level generation). Discards any
     *  dirty markers since we've just rebuilt everything from scratch.
     *
     *  Under streaming this disposes any existing meshes and resets the
     *  working set; `update()` then repopulates it from the focus point over
     *  the next frames (budgeted), so a large location never stalls on load. */
    rebuildAll(): void {
        if (this.streaming) {
            for (const key of [...this.meshByKey.keys()]) this.disposeChunkMeshes(key)
            for (const key of [...this.liquidSurfaceByKey.keys()]) this.removeLiquidSurfaces(key)
            this.activeChunks.clear()
            this.pending.clear()
            this.meshedVersion.clear()
            this.lastFocusChunk = null
            this.manager.drainDirty()
            return
        }
        for (const c of this.manager.allChunks()) {
            this.remesh(c)
        }
        this.manager.drainDirty()
    }

    /** Drain the manager's dirty set and rebuild changed chunks. */
    update(): void {
        if (this.streaming) {
            this.updateStreaming(this.streaming)
            return
        }
        const dirty = this.manager.drainDirty()
        if (dirty.length === 0) return
        for (const c of dirty) {
            // Skip if our cached version is already up-to-date (multiple dirty markers, single rebuild).
            if (this.meshedVersion.get(chunkKey(c.cx, c.cy, c.cz)) === c.version) continue
            this.remesh(c)
        }
    }

    /**
     * Streaming update: keep the meshed working set within `radiusChunks` of
     * the focus point, dispose meshes that drift out (voxel data retained),
     * and (re)mesh up to `budgetPerFrame` chunks per frame, nearest first.
     */
    private updateStreaming(cfg: ChunkStreamingConfig): void {
        const center = focusChunk(cfg.focus())

        // Runtime voxel edits (arrows, pistons) + freshly-created chunks: if
        // they're inside the radius, (re)mesh them regardless of focus motion.
        for (const c of this.manager.drainDirty()) {
            const coord: ChunkCoord = { cx: c.cx, cy: c.cy, cz: c.cz }
            if (!isWithinRadius(center, coord, cfg.radiusChunks)) continue
            const key = chunkKey(c.cx, c.cy, c.cz)
            this.activeChunks.set(key, coord)
            this.meshedVersion.delete(key)
            this.pending.set(key, coord)
        }

        // Recompute the working set only when the focus crosses a chunk
        // boundary — the common case is no change, so this is usually free.
        if (!this.lastFocusChunk || !sameChunk(center, this.lastFocusChunk)) {
            this.lastFocusChunk = center
            const desired = new Set<ChunkKey>()
            const coords = new Map<ChunkKey, ChunkCoord>()
            for (const cc of chunkCoordsInRadius(center, cfg.radiusChunks)) {
                const chunk = this.manager.getChunk(cc.cx, cc.cy, cc.cz)
                if (!chunk || chunk.nonAirCount === 0) continue
                const key = coordKey(cc)
                desired.add(key)
                coords.set(key, cc)
            }
            const { enter, leave } = diffActiveSet(new Set(this.activeChunks.keys()), desired)
            for (const key of leave) {
                this.disposeChunkMeshes(key)
                this.activeChunks.delete(key)
                this.pending.delete(key)
                this.meshedVersion.delete(key)
            }
            for (const key of enter) {
                const coord = coords.get(key)!
                this.activeChunks.set(key, coord)
                this.pending.set(key, coord)
            }
        }

        this.processPending(center, cfg.budgetPerFrame)
    }

    private processPending(center: ChunkCoord, budget: number): void {
        if (this.pending.size === 0) return
        const queue = [...this.pending.values()]
            .sort((a, b) => chunkDistanceSq(a, center) - chunkDistanceSq(b, center))
        let remaining = budget
        for (const coord of queue) {
            if (remaining <= 0) break
            const key = coordKey(coord)
            this.pending.delete(key)
            const chunk = this.manager.getChunk(coord.cx, coord.cy, coord.cz)
            if (!chunk) {
                this.disposeChunkMeshes(key)
                this.activeChunks.delete(key)
                continue
            }
            // Up-to-date already (e.g. re-queued then nothing changed) → skip.
            if (this.meshedVersion.get(key) === chunk.version && this.meshByKey.has(key)) continue
            this.remesh(chunk)
            remaining--
        }
    }

    private disposeSolidMesh(key: ChunkKey): void {
        const old = this.meshByKey.get(key)
        if (!old) return
        this.scene.remove(old)
        old.geometry.dispose()
        this.meshByKey.delete(key)
    }

    private disposeChunkMeshes(key: ChunkKey): void {
        this.disposeSolidMesh(key)
        this.removeLiquidSurfaces(key)
    }

    private remesh(chunk: Chunk): void {
        const key = chunkKey(chunk.cx, chunk.cy, chunk.cz)

        // No solid voxels → ensure no mesh (solid or liquid) in the scene.
        if (chunk.nonAirCount === 0) {
            this.disposeChunkMeshes(key)
            this.meshedVersion.set(key, chunk.version)
            return
        }

        // Sample callback: in-bounds reads come from `chunk`, out-of-bounds reads
        // bounce to ChunkManager (which forwards to neighbour chunks or returns AIR).
        const baseX = chunk.cx * CHUNK_DIM
        const baseY = chunk.cy * CHUNK_DIM
        const baseZ = chunk.cz * CHUNK_DIM
        const sample = (lx: number, ly: number, lz: number): number => {
            const worldY = baseY + ly
            if (this.cutY !== null && worldY > this.cutY) return 0
            if (lx >= 0 && lx < CHUNK_DIM && ly >= 0 && ly < CHUNK_DIM && lz >= 0 && lz < CHUNK_DIM) {
                return chunk.getLocal(lx, ly, lz)
            }
            return this.manager.getVoxel(baseX + lx, baseY + ly, baseZ + lz)
        }

        this.remeshLiquidSurfaces(key, sample, baseX, baseY, baseZ)
        const data = greedyMesh(sample, CHUNK_DIM, this.manager.palette, {
            debugVisibleBlocks: this.debugInfoEnabled,
            skipLiquidTopFaces: true,
        })
        if (data.vertexCount === 0) {
            // Solid geometry is empty, but a liquid-only chunk keeps the
            // liquid surface built just above — only drop the solid mesh.
            this.disposeSolidMesh(key)
            this.meshedVersion.set(key, chunk.version)
            return
        }

        let mesh = this.meshByKey.get(key)
        if (!mesh) {
            const geom = new BufferGeometry()
            mesh = new Mesh(geom, this.material)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.position.set(baseX, baseY, baseZ)
            this.scene.add(mesh)
            this.meshByKey.set(key, mesh)
        }
        const geom = mesh.geometry
        geom.setAttribute('position', new BufferAttribute(data.positions, 3))
        geom.setAttribute('normal', new BufferAttribute(data.normals, 3))
        geom.setAttribute('color', new BufferAttribute(data.colors, 4))
        geom.setAttribute('emissive', new BufferAttribute(data.emissive, 3))
        geom.setAttribute('voxelUV', new BufferAttribute(data.uvs, 2))
        geom.setAttribute('voxelTileIndex', new BufferAttribute(data.tileIndices, 1))
        geom.setIndex(new BufferAttribute(data.indices, 1))
        geom.computeBoundingSphere()
        geom.computeBoundingBox()

        this.meshedVersion.set(key, chunk.version)
    }

    private remeshLiquidSurfaces(key: ChunkKey, sample: VoxelSampler, baseX: number, baseY: number, baseZ: number): void {
        const common = { baseX, baseY, baseZ, subdivisionsPerCell: 0, surfaceOffset: 0.045 }
        this.waterSurfaceMaterial.setColors({ shallow: paletteColorHex(this.manager.palette, 'water') })
        this.lavaSurfaceMaterial.setColors({ hot: paletteColorHex(this.manager.palette, 'lava') })
        this.remeshLiquidSurface(key, 'water', liquidTopSurfaceMesh(sample, CHUNK_DIM, this.manager.palette, 'water', common))

        if (this.manager.palette.entries.some((entry) => entry.liquid === 'lava')) {
            this.remeshLiquidSurface(key, 'lava', liquidTopSurfaceMesh(sample, CHUNK_DIM, this.manager.palette, 'lava', common))
        } else {
            this.removeLiquidSurface(key, 'lava')
        }
    }

    private remeshLiquidSurface(key: ChunkKey, kind: LiquidBlockKind, data: LiquidSurfaceMeshData): void {
        if (data.vertexCount === 0) {
            this.removeLiquidSurface(key, kind)
            return
        }

        let bucket = this.liquidSurfaceByKey.get(key)
        if (!bucket) {
            bucket = {}
            this.liquidSurfaceByKey.set(key, bucket)
        }

        let mesh = bucket[kind]
        if (!mesh) {
            const geometry = new BufferGeometry()
            writeLiquidGeometry(geometry, data)
            mesh = new Mesh(geometry, kind === 'water'
                ? this.waterSurfaceMaterial.material
                : this.lavaSurfaceMaterial.material)
            mesh.name = `LiquidBlockSurface:${key}:${kind}`
            mesh.castShadow = false
            mesh.receiveShadow = false
            mesh.renderOrder = LIQUID_BLOCK_SURFACE_RENDER_ORDER
            this.scene.add(mesh)
            bucket[kind] = mesh
        } else {
            writeLiquidGeometry(mesh.geometry as BufferGeometry, data)
        }
    }

    private removeLiquidSurface(key: ChunkKey, kind: LiquidBlockKind): void {
        const bucket = this.liquidSurfaceByKey.get(key)
        const mesh = bucket?.[kind]
        if (!mesh) return
        this.scene.remove(mesh)
        mesh.geometry.dispose()
        delete bucket![kind]
        if (!bucket!.water && !bucket!.lava) this.liquidSurfaceByKey.delete(key)
    }

    private removeLiquidSurfaces(key: ChunkKey): void {
        this.removeLiquidSurface(key, 'water')
        this.removeLiquidSurface(key, 'lava')
    }

    dispose(): void {
        this.unsubscribeTextures()
        this.unsubscribeDebugInfo()
        for (const mesh of this.meshByKey.values()) {
            this.scene.remove(mesh)
            mesh.geometry.dispose()
        }
        for (const key of [...this.liquidSurfaceByKey.keys()]) {
            this.removeLiquidSurfaces(key)
        }
        this.meshByKey.clear()
        this.meshedVersion.clear()
        this.material.dispose()
        this.waterSurfaceMaterial.dispose()
        this.lavaSurfaceMaterial.dispose()
        this.atlasTexture.dispose()
    }
}

function writeLiquidGeometry(geometry: BufferGeometry, data: LiquidSurfaceMeshData): void {
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
    geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2))
    geometry.setIndex(new BufferAttribute(data.indices, 1))
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
}

function paletteColorHex(palette: Palette, kind: LiquidBlockKind): string {
    const fallback = kind === 'water' ? BLOCK.water : BLOCK.lava
    let index: number = fallback
    if (palette.entries[index]?.liquid !== kind) {
        const found = palette.entries.findIndex((entry) => entry.liquid === kind)
        if (found >= 0) index = found
    }
    const [r, g, b] = paletteEntry(palette, index).color
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`
}

function toHexByte(v: number): string {
    const byte = Math.max(0, Math.min(255, Math.round((Number.isFinite(v) ? v : 0) * 255)))
    return byte.toString(16).padStart(2, '0')
}

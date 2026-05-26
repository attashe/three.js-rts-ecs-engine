import { BufferAttribute, BufferGeometry, DataTexture, Mesh, type Scene } from 'three'
import type { MeshStandardNodeMaterial } from 'three/webgpu'
import type { ChunkManager } from './chunk-manager'
import { Chunk, CHUNK_DIM, chunkKey, type ChunkKey } from './chunk'
import { buildVoxelAtlas } from './atlas-builder'
import { greedyMesh } from './greedy-mesher'
import { createAtlasTexture, createVoxelVertexColor, type VoxelMaterial } from '../render/materials/voxel-vertex-color'
import { getRenderTextures, subscribeRenderTextures } from '../render/render-settings'

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
    private readonly meshByKey: Map<ChunkKey, Mesh> = new Map()
    private readonly meshedVersion: Map<ChunkKey, number> = new Map()
    private readonly unsubscribeTextures: () => void
    private cutY: number | null = null

    constructor(scene: Scene, manager: ChunkManager) {
        this.scene = scene
        this.manager = manager
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
        // Live toggle: when the user flips the Display setting we just
        // update the uniform. No remesh — geometry is unaffected, only
        // the per-fragment multiplier changes.
        this.unsubscribeTextures = subscribeRenderTextures((enabled) => {
            this.voxelMaterial.setTexturesEnabled(enabled)
        })
    }

    /** Mark the working-plane row. The material uses this to fade covered
     *  active-layer cells. The remesh treats cells above this row as air so
     *  hidden upper layers expose readable faces below them. Pass `null` to
     *  disable the cut. */
    setCutY(y: number | null): void {
        if (this.cutY === y) return
        this.cutY = y
        this.voxelMaterial.setCutY(y)
        for (const c of this.manager.allChunks()) {
            this.remesh(c)
        }
        this.manager.drainDirty()
    }

    /** Replace the cover mask — world-cell XZ columns that have hidden
     *  geometry above the working plane. Matching active-layer cells render
     *  faded so the user can tell upper geometry exists there. */
    setCoverMaskCells(cells: Iterable<{ x: number; z: number }>): void {
        this.voxelMaterial.setCoverMaskCells(cells)
    }

    /** Force a full remesh (e.g. after bulk level generation). Discards any
     *  dirty markers since we've just rebuilt everything from scratch. */
    rebuildAll(): void {
        for (const c of this.manager.allChunks()) {
            this.remesh(c)
        }
        this.manager.drainDirty()
    }

    /** Drain the manager's dirty set and rebuild changed chunks. */
    update(): void {
        const dirty = this.manager.drainDirty()
        if (dirty.length === 0) return
        for (const c of dirty) {
            // Skip if our cached version is already up-to-date (multiple dirty markers, single rebuild).
            if (this.meshedVersion.get(chunkKey(c.cx, c.cy, c.cz)) === c.version) continue
            this.remesh(c)
        }
    }

    private remesh(chunk: Chunk): void {
        const key = chunkKey(chunk.cx, chunk.cy, chunk.cz)

        // No solid voxels → ensure no mesh in the scene.
        if (chunk.nonAirCount === 0) {
            const old = this.meshByKey.get(key)
            if (old) {
                this.scene.remove(old)
                old.geometry.dispose()
                this.meshByKey.delete(key)
            }
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

        const data = greedyMesh(sample, CHUNK_DIM, this.manager.palette)
        if (data.vertexCount === 0) {
            const old = this.meshByKey.get(key)
            if (old) {
                this.scene.remove(old)
                old.geometry.dispose()
                this.meshByKey.delete(key)
            }
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

    dispose(): void {
        this.unsubscribeTextures()
        for (const mesh of this.meshByKey.values()) {
            this.scene.remove(mesh)
            mesh.geometry.dispose()
        }
        this.meshByKey.clear()
        this.meshedVersion.clear()
        this.material.dispose()
        this.atlasTexture.dispose()
    }
}

import { CHUNK_DIM, Chunk, chunkKey, type ChunkKey } from './chunk'
import { AIR, clonePalette, type Palette } from './palette'

// Negative-safe integer floor. `Math.floor` already does this in JS, but
// `(x | 0)` truncates toward zero — wrong for negative coords. Using floor.
function chunkOf(worldVoxel: number): number {
    return Math.floor(worldVoxel / CHUNK_DIM)
}
function localOf(worldVoxel: number): number {
    // Modulo that wraps correctly for negative numbers.
    return ((worldVoxel % CHUNK_DIM) + CHUNK_DIM) % CHUNK_DIM
}

/** Convert world-space float coords to integer voxel coords. */
export function worldToVoxel(wx: number, wy: number, wz: number): { x: number; y: number; z: number } {
    return { x: Math.floor(wx), y: Math.floor(wy), z: Math.floor(wz) }
}

export interface VoxelEdit {
    x: number
    y: number
    z: number
    value: number
}

export interface BulkEditResult {
    changedVoxels: number
    dirtyChunks: number
}

/**
 * Owns the world's chunks. World-space voxel coords map to chunk coords via
 * `floor(coord / CHUNK_DIM)`; the local coord inside the chunk is the
 * positive-safe modulo. Out-of-bounds reads return AIR by convention so
 * renderers + raycasters don't need their own bounds checks.
 *
 * `dirty` accumulates chunk keys whose voxels changed; the chunk renderer
 * drains and rebuilds them once per frame.
 */
export class ChunkManager {
    readonly palette: Palette
    private readonly chunks: Map<ChunkKey, Chunk> = new Map()
    private readonly dirty: Set<ChunkKey> = new Set()
    private bulkDepth = 0
    private bulkDirty: Set<ChunkKey> | null = null

    constructor(palette: Palette) {
        this.palette = clonePalette(palette)
    }

    replacePalette(palette: Palette): void {
        this.palette.entries.length = 0
        this.palette.entries.push(...clonePalette(palette).entries)
        this.markAllDirty()
    }

    getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
        return this.chunks.get(chunkKey(cx, cy, cz))
    }

    /** Create the chunk if it doesn't exist. Used by level generators. */
    getOrCreate(cx: number, cy: number, cz: number): Chunk {
        const key = chunkKey(cx, cy, cz)
        let c = this.chunks.get(key)
        if (!c) {
            c = new Chunk(cx, cy, cz)
            this.chunks.set(key, c)
            // Newly-created chunk is implicitly "dirty" — the renderer needs to
            // produce its first geometry even though no setVoxel has been called.
            this.addDirty(cx, cy, cz)
        }
        return c
    }

    /** Read a voxel by world-voxel coord. Returns AIR for any unloaded chunk or out-of-range index. */
    getVoxel(wx: number, wy: number, wz: number): number {
        const c = this.getChunk(chunkOf(wx), chunkOf(wy), chunkOf(wz))
        if (!c) return AIR
        return c.getLocal(localOf(wx), localOf(wy), localOf(wz))
    }

    /**
     * Write a voxel by world-voxel coord. Auto-creates the host chunk if
     * needed. Marks the host chunk dirty AND any neighbor chunks if the
     * write was on a chunk-boundary face (so cross-chunk meshes update).
     */
    setVoxel(wx: number, wy: number, wz: number, value: number): boolean {
        const cx = chunkOf(wx)
        const cy = chunkOf(wy)
        const cz = chunkOf(wz)
        const lx = localOf(wx)
        const ly = localOf(wy)
        const lz = localOf(wz)

        const c = this.getOrCreate(cx, cy, cz)
        const changed = c.setLocal(lx, ly, lz, value)
        if (!changed) return false

        this.addDirty(cx, cy, cz)
        // Boundary writes can re-expose a face on the neighbour chunk.
        if (lx === 0)               this.markChunkDirty(cx - 1, cy, cz)
        if (lx === CHUNK_DIM - 1)   this.markChunkDirty(cx + 1, cy, cz)
        if (ly === 0)               this.markChunkDirty(cx, cy - 1, cz)
        if (ly === CHUNK_DIM - 1)   this.markChunkDirty(cx, cy + 1, cz)
        if (lz === 0)               this.markChunkDirty(cx, cy, cz - 1)
        if (lz === CHUNK_DIM - 1)   this.markChunkDirty(cx, cy, cz + 1)
        return true
    }

    /** Apply many edits as one logical operation. Dirty chunks are still
     *  tracked correctly, but callers get a compact summary for editor/generator
     *  command systems and future undo stacks. */
    applyBulk(edits: Iterable<VoxelEdit>): BulkEditResult {
        let changedVoxels = 0
        return this.withBulkEdit(() => {
            for (const edit of edits) {
                if (this.setVoxel(edit.x, edit.y, edit.z, edit.value)) changedVoxels++
            }
            return { changedVoxels, dirtyChunks: this.bulkDirty?.size ?? 0 }
        })
    }

    /** Run arbitrary `setVoxel` calls as one bulk operation. Nested calls are
     *  allowed; only the outermost call owns the temporary dirty summary. */
    withBulkEdit<T>(edit: () => T): T {
        const outer = this.bulkDepth === 0
        if (outer) this.bulkDirty = new Set()
        this.bulkDepth++
        try {
            return edit()
        } finally {
            this.bulkDepth--
            if (outer) this.bulkDirty = null
        }
    }

    private markChunkDirty(cx: number, cy: number, cz: number): void {
        if (this.chunks.has(chunkKey(cx, cy, cz))) {
            this.addDirty(cx, cy, cz)
        }
    }

    private addDirty(cx: number, cy: number, cz: number): void {
        const key = chunkKey(cx, cy, cz)
        this.dirty.add(key)
        this.bulkDirty?.add(key)
    }

    /** Iterate all chunks (any order). */
    *allChunks(): IterableIterator<Chunk> {
        for (const c of this.chunks.values()) yield c
    }

    /** Drain the dirty set. Caller is expected to remesh each chunk. */
    drainDirty(): Chunk[] {
        const out: Chunk[] = []
        for (const key of this.dirty) {
            const c = this.chunks.get(key)
            if (c) out.push(c)
        }
        this.dirty.clear()
        return out
    }

    /** Quick stat. */
    chunkCount(): number {
        return this.chunks.size
    }

    markAllDirty(): void {
        for (const c of this.chunks.values()) this.addDirty(c.cx, c.cy, c.cz)
    }
}

import { AIR } from './palette'

/** Edge length of a chunk along each axis, in voxels. Locked by Phase 3 plan. */
export const CHUNK_DIM = 32
const STRIDE_Y = CHUNK_DIM
const STRIDE_Z = CHUNK_DIM * CHUNK_DIM
const HASH_OFFSET = 2166136261
const HASH_PRIME = 16777619

/** Voxel-coord chunk key, used by ChunkManager's Map. */
export type ChunkKey = string

export function chunkKey(cx: number, cy: number, cz: number): ChunkKey {
    return `${cx},${cy},${cz}`
}

/**
 * A 32³ block of voxels. Storage is `Uint16Array` of palette indices in
 * x-major order (`x + y*32 + z*32*32`). Air (0) is the default fill.
 *
 * Chunks are owned by `ChunkManager`. Callers shouldn't construct them
 * directly — use `manager.getOrCreate(...)`.
 */
export class Chunk {
    /** Local chunk coords. World voxel coord = (cx*32, cy*32, cz*32) + local. */
    readonly cx: number
    readonly cy: number
    readonly cz: number

    /** Flat palette-index buffer, length 32*32*32 = 32_768. */
    readonly data: Uint16Array

    /**
     * Bumped each time `setVoxel` mutates. Renderers read this to detect they
     * have stale geometry. Don't reset it externally — readers compare to
     * their own cached value.
     */
    version = 0

    /** Convenience: count of non-air voxels. Maintained by setVoxel. */
    nonAirCount = 0

    /**
     * Order-independent digest of non-air voxel contents. This lets authoring
     * reports hash chunk output without rescanning all 32³ cells.
     */
    contentHash = 0

    constructor(cx: number, cy: number, cz: number) {
        this.cx = cx
        this.cy = cy
        this.cz = cz
        this.data = new Uint16Array(CHUNK_DIM * CHUNK_DIM * CHUNK_DIM)
    }

    /** Local-space voxel get. (lx, ly, lz) must each be in [0, 32). */
    getLocal(lx: number, ly: number, lz: number): number {
        return this.data[lx + ly * STRIDE_Y + lz * STRIDE_Z]!
    }

    /** Local-space voxel set. Returns true if the value changed. */
    setLocal(lx: number, ly: number, lz: number, value: number): boolean {
        const idx = lx + ly * STRIDE_Y + lz * STRIDE_Z
        const prev = this.data[idx]!
        if (prev === value) return false
        if (prev === AIR && value !== AIR) this.nonAirCount++
        else if (prev !== AIR && value === AIR) this.nonAirCount--
        this.contentHash = (this.contentHash ^ voxelContribution(idx, prev) ^ voxelContribution(idx, value)) >>> 0
        this.data[idx] = value
        this.version++
        return true
    }

    /** Replace all voxel data at once. Used by serializers/importers that
     *  already own chunk-level invalidation through ChunkManager. */
    replaceData(data: Uint16Array): void {
        if (data.length !== this.data.length) {
            throw new Error(`Chunk.replaceData: expected ${this.data.length} voxels, got ${data.length}`)
        }
        this.data.set(data)
        let count = 0
        let contentHash = 0
        for (let i = 0; i < this.data.length; i++) {
            const value = this.data[i]!
            if (value !== AIR) {
                count++
                contentHash = (contentHash ^ voxelContribution(i, value)) >>> 0
            }
        }
        this.nonAirCount = count
        this.contentHash = contentHash
        this.version++
    }

    /** Iterate every solid voxel. Callback gets local coords + value. */
    forEachSolid(callback: (lx: number, ly: number, lz: number, value: number) => void): void {
        for (let z = 0; z < CHUNK_DIM; z++) {
            for (let y = 0; y < CHUNK_DIM; y++) {
                for (let x = 0; x < CHUNK_DIM; x++) {
                    const v = this.data[x + y * STRIDE_Y + z * STRIDE_Z]!
                    if (v !== AIR) callback(x, y, z, v)
                }
            }
        }
    }
}

// Cheap, NON-cryptographic per-voxel digest. `index` (< 32³) and `value`
// (Uint16) each fit in 16 bits, so a single mix round over each captures all
// the information — the high words are always 0, so mixing them is pointless.
// XOR-accumulated across a chunk in `setVoxel`, this gives an order-independent
// content hash for authoring report / determinism use only; collisions are
// acceptable (it never feeds save data or gameplay).
function voxelContribution(index: number, value: number): number {
    if (value === AIR) return 0
    let h = HASH_OFFSET
    h = mixHash(h, index)
    h = mixHash(h, value)
    return h >>> 0
}

function mixHash(current: number, value: number): number {
    let h = current >>> 0
    h ^= value & 0xffff
    h = Math.imul(h, HASH_PRIME) >>> 0
    h ^= value >>> 16
    h = Math.imul(h, HASH_PRIME) >>> 0
    return h >>> 0
}

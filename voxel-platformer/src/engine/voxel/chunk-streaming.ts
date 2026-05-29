import { CHUNK_DIM, chunkKey, type ChunkKey } from './chunk'

/**
 * Pure helpers for mesh streaming — deciding *which* chunks the renderer
 * should keep meshed around a moving focus point (the player / camera
 * target). Voxel data stays fully resident in the `ChunkManager`; only the
 * Three.js meshes are built and torn down by distance, so a large location
 * never pays to mesh or draw the whole world at once.
 *
 * Kept free of Three.js / ChunkManager so the set math is unit-testable in
 * isolation; `ChunkRenderer` owns the side effects.
 */

export interface ChunkCoord {
    cx: number
    cy: number
    cz: number
}

export interface ChunkStreamingConfig {
    /** World-space point the working set is centred on (player / camera target). */
    focus: () => { x: number; y: number; z: number }
    /** Chebyshev radius, in chunks, of the meshed working set. */
    radiusChunks: number
    /** Max chunk (re)meshes processed per frame — spreads cost so load and
     *  cut changes never stall the main thread. */
    budgetPerFrame: number
}

/** World voxel coord → chunk coord (negative-safe). */
export function worldToChunk(v: number): number {
    return Math.floor(v / CHUNK_DIM)
}

/** Chunk coord of a world-space point. */
export function focusChunk(point: { x: number; y: number; z: number }): ChunkCoord {
    return { cx: worldToChunk(point.x), cy: worldToChunk(point.y), cz: worldToChunk(point.z) }
}

export function sameChunk(a: ChunkCoord, b: ChunkCoord): boolean {
    return a.cx === b.cx && a.cy === b.cy && a.cz === b.cz
}

/** Chebyshev (max-axis) distance between two chunk coords, in chunks. */
export function chunkChebyshev(a: ChunkCoord, b: ChunkCoord): number {
    return Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy), Math.abs(a.cz - b.cz))
}

/** Squared Euclidean distance between two chunk coords (for nearest-first ordering). */
export function chunkDistanceSq(a: ChunkCoord, b: ChunkCoord): number {
    const dx = a.cx - b.cx
    const dy = a.cy - b.cy
    const dz = a.cz - b.cz
    return dx * dx + dy * dy + dz * dz
}

export function isWithinRadius(center: ChunkCoord, chunk: ChunkCoord, radius: number): boolean {
    return chunkChebyshev(center, chunk) <= radius
}

/** Iterate every chunk coord within a Chebyshev radius of `center`. */
export function* chunkCoordsInRadius(center: ChunkCoord, radius: number): Generator<ChunkCoord> {
    for (let cy = center.cy - radius; cy <= center.cy + radius; cy++) {
        for (let cz = center.cz - radius; cz <= center.cz + radius; cz++) {
            for (let cx = center.cx - radius; cx <= center.cx + radius; cx++) {
                yield { cx, cy, cz }
            }
        }
    }
}

export interface ActiveSetDiff {
    enter: ChunkKey[]
    leave: ChunkKey[]
}

/**
 * Diff a desired active set against the current one: `enter` are keys to
 * start meshing, `leave` are keys whose meshes should be disposed (their
 * voxel data is kept).
 */
export function diffActiveSet(current: ReadonlySet<ChunkKey>, desired: ReadonlySet<ChunkKey>): ActiveSetDiff {
    const enter: ChunkKey[] = []
    const leave: ChunkKey[] = []
    for (const key of desired) if (!current.has(key)) enter.push(key)
    for (const key of current) if (!desired.has(key)) leave.push(key)
    return { enter, leave }
}

export function coordKey(coord: ChunkCoord): ChunkKey {
    return chunkKey(coord.cx, coord.cy, coord.cz)
}

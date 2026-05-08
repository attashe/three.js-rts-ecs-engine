import type { ChunkManager } from './chunk-manager'
import { isCollidable } from './palette'

export interface AABB {
    minX: number
    minY: number
    minZ: number
    maxX: number
    maxY: number
    maxZ: number
}

const EPS = 1e-6

/** Returns true if any solid voxel overlaps the AABB. */
export function voxelAABBOverlap(chunks: ChunkManager, aabb: AABB): boolean {
    // Inclusive on min, exclusive on max so an AABB whose face sits exactly
    // on an integer voxel boundary doesn't count that next voxel as overlap.
    const x0 = Math.floor(aabb.minX)
    const y0 = Math.floor(aabb.minY)
    const z0 = Math.floor(aabb.minZ)
    const x1 = Math.floor(aabb.maxX - EPS)
    const y1 = Math.floor(aabb.maxY - EPS)
    const z1 = Math.floor(aabb.maxZ - EPS)

    const palette = chunks.palette
    for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                if (isCollidable(palette, chunks.getVoxel(x, y, z))) return true
            }
        }
    }
    return false
}

/** Mutable AABB built from foot-anchored Position + BoxCollider half-extents.
 *  X/Z are centred on Position; Y spans `[pos.y, pos.y + 2*half.y]` so
 *  Position.y is the entity's *foot* (matching how player meshes are laid out
 *  with their Group origin at ground level). */
export function aabbFromFoot(
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    out: AABB,
): AABB {
    out.minX = pos.x - half.x
    out.maxX = pos.x + half.x
    out.minY = pos.y
    out.maxY = pos.y + half.y * 2
    out.minZ = pos.z - half.z
    out.maxZ = pos.z + half.z
    return out
}

/**
 * Sweep a single axis. Tries to displace `pos.{x,y,z}` along `axis` by
 * `delta` world units; if the resulting AABB overlaps a solid voxel, binary-
 * searches for the largest valid displacement. Returns `{ moved, blocked }`.
 *
 * Per-axis sweep is the standard "move and slide" pattern: call once for X,
 * once for Z, once for Y. Order matters slightly (axis-aligned slides depend
 * on which axis runs first); for the demo the X→Z→Y order works well since
 * gravity is on Y and we want to land cleanly.
 */
export function sweepAxis(
    chunks: ChunkManager,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    axis: 'x' | 'y' | 'z',
    delta: number,
): { moved: number; blocked: boolean } {
    if (delta === 0) return { moved: 0, blocked: false }

    const tmp: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const test = (offset: number): boolean => {
        const tryPos = {
            x: axis === 'x' ? pos.x + offset : pos.x,
            y: axis === 'y' ? pos.y + offset : pos.y,
            z: axis === 'z' ? pos.z + offset : pos.z,
        }
        aabbFromFoot(tryPos, half, tmp)
        return voxelAABBOverlap(chunks, tmp)
    }

    // Optimistic: full delta is fine.
    if (!test(delta)) {
        if (axis === 'x') pos.x += delta
        else if (axis === 'y') pos.y += delta
        else pos.z += delta
        return { moved: delta, blocked: false }
    }

    // Binary search [0, delta]. lo is always non-overlapping.
    let lo = 0
    let hi = delta
    for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) * 0.5
        if (test(mid)) hi = mid
        else lo = mid
    }
    if (axis === 'x') pos.x += lo
    else if (axis === 'y') pos.y += lo
    else pos.z += lo
    return { moved: lo, blocked: true }
}

/** Standing-on-ground check: is there a solid voxel within `epsilon` below the AABB? */
export function isGrounded(
    chunks: ChunkManager,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    epsilon = 0.05,
): boolean {
    const tmp: AABB = {
        minX: pos.x - half.x,
        maxX: pos.x + half.x,
        minY: pos.y - epsilon,
        maxY: pos.y,
        minZ: pos.z - half.z,
        maxZ: pos.z + half.z,
    }
    return voxelAABBOverlap(chunks, tmp)
}

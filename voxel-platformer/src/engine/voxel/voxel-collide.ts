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

/** Pluggable source of "extra" solid AABBs the sweep treats as walls — used
 *  for settled dynamic bodies that aren't baked into the voxel grid. */
export interface ObstacleSource {
    intersects(aabb: AABB, excludeEid?: number): boolean
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

/** Whether `Position.y` is the entity's foot or the centre of its AABB.
 *  See the `centerAnchored` flag on RigidBody for the rationale. */
export type ColliderAnchor = 'foot' | 'center'

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

/** AABB centred on Position on every axis. Used for round bodies whose visual
 *  Group origin sits at the body centre, so rotating the Group rotates the
 *  visual in place rather than swinging it through the ground. */
export function aabbFromCenter(
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    out: AABB,
): AABB {
    out.minX = pos.x - half.x
    out.maxX = pos.x + half.x
    out.minY = pos.y - half.y
    out.maxY = pos.y + half.y
    out.minZ = pos.z - half.z
    out.maxZ = pos.z + half.z
    return out
}

function aabbForAnchor(
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
    out: AABB,
): AABB {
    return anchor === 'center' ? aabbFromCenter(pos, half, out) : aabbFromFoot(pos, half, out)
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
    obstacles?: ObstacleSource | null,
    excludeEid?: number,
    anchor: ColliderAnchor = 'foot',
): { moved: number; blocked: boolean } {
    if (delta === 0) return { moved: 0, blocked: false }

    // If the body is already inside a wall (e.g. shoved there by a position
    // correction in another system), substepping makes things worse — every
    // intermediate position is still overlapping, so the escape branch in
    // sweepAxisOnce never sees a clear destination. Single-shot the full delta
    // and let the escape branch try the whole displacement at once.
    const tmpStart: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    aabbForAnchor(pos, half, anchor, tmpStart)
    const startOverlapping = voxelAABBOverlap(chunks, tmpStart) ||
        (obstacles ? obstacles.intersects(tmpStart, excludeEid) : false)
    if (startOverlapping) {
        return sweepAxisOnce(chunks, pos, half, axis, delta, obstacles, excludeEid, anchor)
    }

    // Tunnel-safe sub-stepping: a single binary-searched endpoint test misses
    // walls the body fully crossed in one frame. Cap the per-step distance at
    // ~half the body's extent on the swept axis (and ≤0.5 — half a voxel) so
    // every potential collider on the swept path appears as an overlap at the
    // end of some sub-step.
    const halfOnAxis = axis === 'x' ? half.x : axis === 'y' ? half.y : half.z
    const stepLimit = Math.min(Math.max(halfOnAxis * 1.5, 0.05), 0.5)
    const absDelta = Math.abs(delta)
    if (absDelta <= stepLimit) {
        return sweepAxisOnce(chunks, pos, half, axis, delta, obstacles, excludeEid, anchor)
    }

    const steps = Math.ceil(absDelta / stepLimit)
    const stepDelta = delta / steps
    let totalMoved = 0
    for (let i = 0; i < steps; i++) {
        const result = sweepAxisOnce(chunks, pos, half, axis, stepDelta, obstacles, excludeEid, anchor)
        totalMoved += result.moved
        if (result.blocked) return { moved: totalMoved, blocked: true }
    }
    return { moved: totalMoved, blocked: false }
}

function sweepAxisOnce(
    chunks: ChunkManager,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    axis: 'x' | 'y' | 'z',
    delta: number,
    obstacles: ObstacleSource | null | undefined,
    excludeEid: number | undefined,
    anchor: ColliderAnchor,
): { moved: number; blocked: boolean } {
    const tmp: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const test = (offset: number): boolean => {
        const tryPos = {
            x: axis === 'x' ? pos.x + offset : pos.x,
            y: axis === 'y' ? pos.y + offset : pos.y,
            z: axis === 'z' ? pos.z + offset : pos.z,
        }
        aabbForAnchor(tryPos, half, anchor, tmp)
        if (voxelAABBOverlap(chunks, tmp)) return true
        if (obstacles && obstacles.intersects(tmp, excludeEid)) return true
        return false
    }

    if (!test(delta)) {
        if (axis === 'x') pos.x += delta
        else if (axis === 'y') pos.y += delta
        else pos.z += delta
        return { moved: delta, blocked: false }
    }

    // Escape hatch: if the body started overlapping (e.g. it got shoved into a
    // wall by another system before this sweep ran), the binary-search
    // invariant `lo=0 non-overlapping` is broken. We can't bisect, but we also
    // shouldn't report "blocked" (which would zero the body's velocity and
    // trap it permanently). Just don't move along this axis this step — let
    // the caller's next frame, or a different axis, find a clear direction.
    if (test(0)) {
        return { moved: 0, blocked: false }
    }

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

/** Standing-on-ground check: is there a solid voxel (or registered obstacle)
 *  within `epsilon` below the AABB?
 *
 *  For foot-anchored bodies the probe sits in `[pos.y - epsilon, pos.y]`. For
 *  centre-anchored bodies the probe sits in `[pos.y - half.y - epsilon, pos.y - half.y]`. */
export function isGrounded(
    chunks: ChunkManager,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    epsilon = 0.05,
    obstacles?: ObstacleSource | null,
    excludeEid?: number,
    anchor: ColliderAnchor = 'foot',
): boolean {
    const baseY = anchor === 'center' ? pos.y - half.y : pos.y
    const tmp: AABB = {
        minX: pos.x - half.x,
        maxX: pos.x + half.x,
        minY: baseY - epsilon,
        maxY: baseY,
        minZ: pos.z - half.z,
        maxZ: pos.z + half.z,
    }
    if (voxelAABBOverlap(chunks, tmp)) return true
    if (obstacles && obstacles.intersects(tmp, excludeEid)) return true
    return false
}

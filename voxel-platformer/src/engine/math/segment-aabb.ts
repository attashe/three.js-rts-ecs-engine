/**
 * Slab test: distance along a unit-direction segment of length `segLen` at
 * which it first enters the AABB, or null if it misses within the segment.
 * Returns 0 when the origin already sits inside the box.
 */
export function segmentAabbEntry(
    sx: number, sy: number, sz: number,
    dx: number, dy: number, dz: number,
    segLen: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
): number | null {
    let tMin = 0
    let tMax = segLen
    const eps = 1e-9
    // X
    if (Math.abs(dx) < eps) {
        if (sx < minX || sx > maxX) return null
    } else {
        let t1 = (minX - sx) / dx
        let t2 = (maxX - sx) / dx
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        tMin = Math.max(tMin, t1)
        tMax = Math.min(tMax, t2)
        if (tMin > tMax) return null
    }
    // Y
    if (Math.abs(dy) < eps) {
        if (sy < minY || sy > maxY) return null
    } else {
        let t1 = (minY - sy) / dy
        let t2 = (maxY - sy) / dy
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        tMin = Math.max(tMin, t1)
        tMax = Math.min(tMax, t2)
        if (tMin > tMax) return null
    }
    // Z
    if (Math.abs(dz) < eps) {
        if (sz < minZ || sz > maxZ) return null
    } else {
        let t1 = (minZ - sz) / dz
        let t2 = (maxZ - sz) / dz
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        tMin = Math.max(tMin, t1)
        tMax = Math.min(tMax, t2)
        if (tMin > tMax) return null
    }
    return tMin
}

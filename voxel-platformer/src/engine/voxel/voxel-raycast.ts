import { Vector3 } from 'three'
import type { ChunkManager } from './chunk-manager'
import { isRaycastTarget } from './palette'

export interface VoxelHit {
    /** Voxel coords (integer) of the hit cell. */
    voxel: { x: number; y: number; z: number }
    /** Surface normal of the hit face (-1, 0, +1 components). */
    normal: { x: number; y: number; z: number }
    /** Ray distance to the hit. */
    t: number
}

/**
 * Amanatides-Woo voxel ray traversal. Steps along the ray cell-by-cell and
 * returns the first solid voxel hit, or null if `maxDistance` is exceeded.
 *
 * Ray origin is in world space; direction must be (approximately) unit length.
 * `maxDistance` is in world units. The returned `t` is the distance to the
 * entry plane of the hit voxel — convert to a hit point via
 * `origin + dir * t`.
 *
 * Reference: J. Amanatides & A. Woo, "A Fast Voxel Traversal Algorithm",
 * Eurographics 1987.
 */
export function voxelRaycast(
    manager: ChunkManager,
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
): VoxelHit | null {
    // Current voxel.
    let x = Math.floor(origin.x)
    let y = Math.floor(origin.y)
    let z = Math.floor(origin.z)

    // Step direction along each axis.
    const stepX = Math.sign(direction.x) || 0
    const stepY = Math.sign(direction.y) || 0
    const stepZ = Math.sign(direction.z) || 0

    // Distance the ray must travel to cross one voxel along each axis (in t-units).
    // For zero-component direction we set tDelta to Infinity so we never step that axis.
    const tDeltaX = stepX !== 0 ? Math.abs(1 / direction.x) : Infinity
    const tDeltaY = stepY !== 0 ? Math.abs(1 / direction.y) : Infinity
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / direction.z) : Infinity

    // Distance from origin to the first voxel boundary on each axis.
    let tMaxX = stepX > 0
        ? (Math.floor(origin.x) + 1 - origin.x) / direction.x
        : stepX < 0 ? (origin.x - Math.floor(origin.x)) / -direction.x : Infinity
    let tMaxY = stepY > 0
        ? (Math.floor(origin.y) + 1 - origin.y) / direction.y
        : stepY < 0 ? (origin.y - Math.floor(origin.y)) / -direction.y : Infinity
    let tMaxZ = stepZ > 0
        ? (Math.floor(origin.z) + 1 - origin.z) / direction.z
        : stepZ < 0 ? (origin.z - Math.floor(origin.z)) / -direction.z : Infinity

    // Check the starting voxel first (in case the origin is inside a solid).
    if (isRaycastTarget(manager.palette, manager.getVoxel(x, y, z))) {
        return { voxel: { x, y, z }, normal: { x: 0, y: 0, z: 0 }, t: 0 }
    }

    let stepAxis: 0 | 1 | 2 = 0
    let t = 0

    while (t <= maxDistance) {
        // Step to the next voxel along whichever axis crosses its boundary first.
        if (tMaxX < tMaxY && tMaxX < tMaxZ) {
            x += stepX
            t = tMaxX
            tMaxX += tDeltaX
            stepAxis = 0
        } else if (tMaxY < tMaxZ) {
            y += stepY
            t = tMaxY
            tMaxY += tDeltaY
            stepAxis = 1
        } else {
            z += stepZ
            t = tMaxZ
            tMaxZ += tDeltaZ
            stepAxis = 2
        }

        if (t > maxDistance) return null

        if (isRaycastTarget(manager.palette, manager.getVoxel(x, y, z))) {
            // Normal points back along the axis we stepped (away from the hit voxel).
            const normal = { x: 0, y: 0, z: 0 }
            if (stepAxis === 0) normal.x = -stepX
            else if (stepAxis === 1) normal.y = -stepY
            else normal.z = -stepZ
            return { voxel: { x, y, z }, normal, t }
        }
    }
    return null
}

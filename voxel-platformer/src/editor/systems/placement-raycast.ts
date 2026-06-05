/**
 * Shared click→world-cell placement geometry for editor tools that drop things
 * on the floor (NPC placement, NPC waypoints). Mirrors the original logic that
 * lived in `npc-place-system.ts` so both tools snap identically.
 */
import { makeRay, screenToWorldRay } from '../../engine/input/pointer'
import { voxelRaycast } from '../../engine/voxel/voxel-raycast'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { VoxelCoord } from '../../engine/ecs/world'

export type Ray = ReturnType<typeof makeRay>
export type VoxelRayHit = NonNullable<ReturnType<typeof voxelRaycast>>
export type WorldPoint = { x: number; y: number; z: number }
export type ClickPoint = { x: number; y: number }

export const MAX_PLACEMENT_RAY = 60

/** Cast a screen click into the voxel world; returns the nearest solid hit. */
export function raycastClick(
    click: ClickPoint,
    iso: IsometricCamera,
    chunks: ChunkManager,
    ray: Ray,
    maxRay = MAX_PLACEMENT_RAY,
): VoxelRayHit | null {
    screenToWorldRay(click.x, click.y, iso.camera, ray)
    return voxelRaycast(chunks, ray.origin, ray.direction, maxRay)
}

/**
 * Resolve where a placement lands: grid-aligned snaps to the hovered cell's
 * centre/top; free placement uses the raw ray hit, falling back to the working
 * plane or the cursor cell. Returns null if nothing resolves.
 */
export function resolvePlacement(opts: {
    gridAligned: boolean
    cursor: VoxelCoord | null
    ray: Ray
    workingPlaneY: number
    hit: VoxelRayHit | null
}): WorldPoint | null {
    const { gridAligned, cursor, ray, workingPlaneY } = opts
    // Grid mode prefers the hovered cursor cell over a ray hit (steadier).
    const hit = gridAligned && cursor ? null : opts.hit
    if (gridAligned) return gridAlignedPosition(cursor, hit)
    if (hit) return freeHitPosition(ray, hit)
    return intersectWorkingPlane(ray, workingPlaneY) ?? (cursor ? cursorFloorPosition(cursor) : null)
}

export function gridAlignedPosition(cursor: VoxelCoord | null, hit: VoxelRayHit | null): WorldPoint | null {
    if (cursor) return cursorFloorPosition(cursor)
    if (!hit) return null
    return {
        x: hit.voxel.x + hit.normal.x + 0.5,
        y: hit.voxel.y + hit.normal.y,
        z: hit.voxel.z + hit.normal.z + 0.5,
    }
}

export function freeHitPosition(ray: Ray, hit: VoxelRayHit): WorldPoint {
    return {
        x: ray.origin.x + ray.direction.x * hit.t,
        y: ray.origin.y + ray.direction.y * hit.t + 0.001,
        z: ray.origin.z + ray.direction.z * hit.t,
    }
}

/** Anchor cell for RMB-remove gestures (the cell face the ray struck). */
export function removeAnchor(hit: VoxelRayHit | null): WorldPoint | null {
    if (!hit) return null
    return {
        x: hit.voxel.x + hit.normal.x + 0.5,
        y: hit.voxel.y + hit.normal.y,
        z: hit.voxel.z + hit.normal.z + 0.5,
    }
}

export function cursorFloorPosition(cursor: VoxelCoord): WorldPoint {
    return { x: cursor.x + 0.5, y: cursor.y, z: cursor.z + 0.5 }
}

export function intersectWorkingPlane(ray: Ray, planeY: number): WorldPoint | null {
    if (Math.abs(ray.direction.y) < 1e-6) return null
    const t = (planeY - ray.origin.y) / ray.direction.y
    if (t < 0) return null
    return {
        x: ray.origin.x + ray.direction.x * t,
        y: planeY,
        z: ray.origin.z + ray.direction.z * t,
    }
}

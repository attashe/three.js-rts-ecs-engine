import { Vector3 } from 'three'
import { addComponent, hasComponent, query } from 'bitecs'
import type { Engine } from '../engine/engine'
import { CameraTarget, MoveAlongPath, Position } from '../engine/ecs/components'
import { findPath, voxelRaycast, type ChunkManager } from '../engine/voxel'
import type { System } from '../engine/ecs/systems/system'
import { makeRay, screenToWorldRay } from '../engine/input/pointer'

export interface ClickToMoveOptions {
    /** Walk speed in voxels (= world units) per second. Default 4. */
    speed?: number
    /** Max ray distance (world units). Default 200 — well past the demo level. */
    maxRayDistance?: number
}

/**
 * Render-step system. On each left-click:
 *   1. Build a world-space ray from the click.
 *   2. Voxel-raycast against the chunk manager.
 *   3. A* from the player's current cell to "top of the hit voxel".
 *   4. Set the path on the (single) `CameraTarget`-tagged player entity.
 *
 * Right-click cancels any in-progress movement. Multiple clicks within a
 * single frame are processed in order; only the last successful one's path
 * survives.
 */
export function createClickToMoveSystem(
    chunks: ChunkManager,
    engine: Engine,
    opts: ClickToMoveOptions = {},
): System {
    const speed = opts.speed ?? 4
    const maxRayDistance = opts.maxRayDistance ?? 200
    const ray = makeRay()

    return {
        update(world) {
            const clicks = engine.input.consumeClicks()
            if (clicks.length === 0) return

            const players = query(world, [CameraTarget, Position])
            if (players.length === 0) return
            const eid = players[0]

            for (const click of clicks) {
                if (click.button === 2) {
                    // Right-click cancels.
                    world.pathByEid.delete(eid)
                    continue
                }
                if (click.button !== 0) continue

                screenToWorldRay(click.x, click.y, engine.renderer.camera, ray, engine.renderer.webgpu.domElement)
                const hit = voxelRaycast(chunks, ray.origin, ray.direction, maxRayDistance)
                if (!hit) continue

                // Walk to the top face of the hit voxel.
                const target = { x: hit.voxel.x, y: hit.voxel.y + 1, z: hit.voxel.z }
                const start = {
                    x: Math.floor(Position.x[eid]),
                    y: Math.floor(Position.y[eid]),
                    z: Math.floor(Position.z[eid]),
                }
                const path = findPath(chunks, start, target)
                if (!path || path.length === 0) continue

                // Convert voxel-cell waypoints to world-space (cell centres).
                const points = path.map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5))
                world.pathByEid.set(eid, { points, index: 0, speed })
                if (!hasComponent(world, eid, MoveAlongPath)) {
                    addComponent(world, eid, MoveAlongPath)
                }
            }
        },
    }
}

import { hasComponent, query } from 'bitecs'
import { Vector3 } from 'three'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { voxelRaycast } from '../../voxel/voxel-raycast'
import {
    MovingObject,
    Position,
    Velocity,
} from '../components'
import { MovingObjectKind } from '../../../game/moving-objects'
import type { System } from './system'
import { FixedOrder } from './orders'

/**
 * Per-step voxel-vs-arrow probe. Most of the arrow's deceleration happens via
 * `physics-system.sweepAxis` (the arrow's BoxCollider gets blocked when it
 * hits a wall) — at which point `moving-object-system` flips it to a static
 * embedded visual. This system exists as the hook point for non-voxel targets
 * (chests, switches, buttons, levers — anything that wants to react to a
 * remote arrow trigger). It runs the same segment-vs-voxel ray each tick and
 * emits a hook callback when it detects the arrow has just landed against a
 * voxel surface.
 *
 * The parent engine used this system to apply damage to NPCs and check the
 * player's shield. With no NPCs in the platformer foundation, the only
 * `onArrowHit` consumer in v0 is the engine itself: register an
 * `onArrowLand` callback to drive future remote-activation behaviour.
 */
export interface ArrowHitOptions {
    /** Fires once when an arrow lands against a voxel cell. Receives the
     *  arrow eid and the voxel coord it terminated against. */
    onArrowLand?: (eid: number, voxel: { x: number; y: number; z: number }) => void
}

export function createArrowHitSystem(
    chunks: ChunkManager,
    opts: ArrowHitOptions = {},
): System {
    const tmpOrigin = new Vector3()
    const tmpDir = new Vector3()
    /** Track arrows we've already announced as landed so the callback fires once. */
    const landed = new Set<number>()

    return {
        fixed: true,
        order: FixedOrder.movement + 50,
        update(world, dt) {
            const arrows = query(world, [MovingObject, Position, Velocity])
            if (arrows.length === 0) return

            for (let i = 0; i < arrows.length; i++) {
                const arrow = arrows[i]!
                if (MovingObject.kind[arrow] !== MovingObjectKind.Arrow) continue
                if (landed.has(arrow)) continue

                const sx = Position.x[arrow]
                const sy = Position.y[arrow]
                const sz = Position.z[arrow]
                const vx = Velocity.x[arrow]
                const vy = Velocity.y[arrow]
                const vz = Velocity.z[arrow]
                const speedSq = vx * vx + vy * vy + vz * vz
                if (speedSq < 4) continue

                const segLen = Math.sqrt(speedSq) * dt
                if (segLen <= 0) continue
                tmpOrigin.set(sx, sy, sz)
                tmpDir.set(vx / Math.sqrt(speedSq), vy / Math.sqrt(speedSq), vz / Math.sqrt(speedSq))
                const wallHit = voxelRaycast(chunks, tmpOrigin, tmpDir, segLen)
                if (wallHit !== null) {
                    landed.add(arrow)
                    opts.onArrowLand?.(arrow, { x: wallHit.voxel.x, y: wallHit.voxel.y, z: wallHit.voxel.z })
                }
            }

            // Forget arrows that physics has already cleaned up so the set
            // doesn't grow unbounded.
            for (const eid of landed) {
                if (!hasComponent(world, eid, MovingObject)) landed.delete(eid)
            }
        },
    }
}

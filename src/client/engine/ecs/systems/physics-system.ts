import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { ChunkManager } from '../../voxel'
import { isGrounded, sweepAxis } from '../../voxel'
import { BoxCollider, Grounded, HorizontalBlocked, MovementState, Position, Velocity } from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { MovementStateId } from '../movement-state'

export interface PhysicsOptions {
    /** Downward acceleration in world-units / second². Default 24. */
    gravity?: number
    /** Terminal vertical fall speed (clamped). Default 40. */
    maxFallSpeed?: number
}

/**
 * Fixed-step physics. For each (Position, Velocity, BoxCollider) entity:
 *   1. Apply gravity to Velocity.y (clamped at terminal speed).
 *   2. Sweep X, then Z, then Y against voxel AABBs, clamping velocity on each blocked axis.
 *   3. Update the `Grounded` tag based on a thin probe under the AABB.
 *
 * Y-last so the ground sweep happens after horizontal motion — entities can
 * "step" up shallow ledges as a side effect (the upward Y sweep snaps to the
 * top of the ledge if the body is already partially inside it after X/Z).
 */
export function createPhysicsSystem(chunks: ChunkManager, opts: PhysicsOptions = {}): System {
    const gravity = opts.gravity ?? 24
    const maxFallSpeed = opts.maxFallSpeed ?? 40

    const pos = { x: 0, y: 0, z: 0 }
    const half = { x: 0, y: 0, z: 0 }

    return {
        fixed: true,
        order: FixedOrder.physics,
        update(world, dt) {
            const eids = query(world, [Position, Velocity, BoxCollider])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]

                // Apply gravity (clamped).
                let vy = Velocity.y[eid] - gravity * dt
                if (vy < -maxFallSpeed) vy = -maxFallSpeed

                pos.x = Position.x[eid]
                pos.y = Position.y[eid]
                pos.z = Position.z[eid]
                half.x = BoxCollider.x[eid]
                half.y = BoxCollider.y[eid]
                half.z = BoxCollider.z[eid]

                const dx = Velocity.x[eid] * dt
                const dz = Velocity.z[eid] * dt
                const dy = vy * dt

                const sweepX = sweepAxis(chunks, pos, half, 'x', dx)
                if (sweepX.blocked) Velocity.x[eid] = 0

                const sweepZ = sweepAxis(chunks, pos, half, 'z', dz)
                if (sweepZ.blocked) Velocity.z[eid] = 0

                const horizontalBlocked = sweepX.blocked || sweepZ.blocked
                const hadBlocked = hasComponent(world, eid, HorizontalBlocked)
                if (horizontalBlocked && !hadBlocked) addComponent(world, eid, HorizontalBlocked)
                else if (!horizontalBlocked && hadBlocked) removeComponent(world, eid, HorizontalBlocked)

                const sweepY = sweepAxis(chunks, pos, half, 'y', dy)
                if (sweepY.blocked) {
                    vy = 0
                }
                Velocity.y[eid] = vy

                Position.x[eid] = pos.x
                Position.y[eid] = pos.y
                Position.z[eid] = pos.z

                // Update Grounded — thin probe under the AABB so a tiny binary-search residual
                // doesn't cause false negatives.
                const grounded = isGrounded(chunks, pos, half, 0.08)
                const had = hasComponent(world, eid, Grounded)
                if (grounded && !had) addComponent(world, eid, Grounded)
                else if (!grounded && had) removeComponent(world, eid, Grounded)
                if (!grounded && Math.abs(Velocity.y[eid]) > 0.1) {
                    MovementState.value[eid] = MovementStateId.Airborne
                } else if (horizontalBlocked) {
                    MovementState.value[eid] = MovementStateId.Blocked
                }
            }
        },
    }
}

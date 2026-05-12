import { Vector3 } from 'three'
import { hasComponent, query, removeComponent } from 'bitecs'
import { Grounded, PlayerControlled, Position, Rotation, Velocity } from '../components'
import type { Input } from '../../input/input'
import type { ActionMap, ActionId } from '../../input/actions'
import type { IsometricCamera } from '../../render/isometric-camera'
import type { System } from './system'
import { FixedOrder } from './orders'
import { makeRay, screenToWorldRay } from '../../input/pointer'

export interface PlayerControlOptions {
    /** Horizontal speed (world units / second). Default 5. */
    moveSpeed?: number
    /** Initial vertical velocity on jump. With default gravity (24), v=8 gives ~1.3 voxel apex. Default 8. */
    jumpVelocity?: number
    /** How quickly horizontal velocity ramps up/down (1 / s). Higher = snappier. Default 18. */
    accel?: number
    /** Jump input buffer, in milliseconds. Default 200. */
    jumpBufferMs?: number
    /** Grace period after leaving ground where jump is still accepted, in milliseconds. Default 100. */
    coyoteMs?: number
    actions?: PlayerControlActions
}

export interface PlayerControlActions {
    forward: ActionId
    backward: ActionId
    left: ActionId
    right: ActionId
    jump: ActionId
}

/**
 * Reads WASD + Space and writes Velocity on every entity with `PlayerControlled`.
 * Movement direction is camera-relative (W = into the screen, derived from the
 * IsometricCamera's yaw); horizontal velocity is exponentially smoothed so input
 * doesn't feel teleporty.
 *
 * Jump: rising-edge on Space while `Grounded` → `Velocity.y = jumpVelocity`,
 * Grounded tag immediately removed so we don't double-jump on the same press.
 */
export function createPlayerControlSystem(
    input: Input,
    actions: ActionMap,
    iso: IsometricCamera,
    opts: PlayerControlOptions = {},
): System {
    const moveSpeed = opts.moveSpeed ?? 5
    const jumpVelocity = opts.jumpVelocity ?? 8
    const accel = opts.accel ?? 18
    const jumpBufferMs = opts.jumpBufferMs ?? 200
    const coyoteMs = opts.coyoteMs ?? 100
    const actionIds = opts.actions ?? {
        forward: 'move.forward',
        backward: 'move.backward',
        left: 'move.left',
        right: 'move.right',
        jump: 'move.jump',
    }

    const forward = new Vector3()
    const right = new Vector3()
    const pointerRay = makeRay()
    const lastGroundedAt = new Map<number, number>()

    return {
        fixed: true,
        order: FixedOrder.input,
        update(world, dt) {
            const eids = query(world, [PlayerControlled, Position, Velocity])
            if (eids.length === 0) return

            // Camera-relative basis. getPanForward points from target back toward
            // the camera (away from the view), so negate for "into the screen".
            iso.getPanForward(forward).negate()
            iso.getPanRight(right)

            // Read input direction.
            let inFwd = 0
            let inRight = 0
            if (actions.isHeld(actionIds.forward)) inFwd += 1
            if (actions.isHeld(actionIds.backward)) inFwd -= 1
            if (actions.isHeld(actionIds.right)) inRight += 1
            if (actions.isHeld(actionIds.left)) inRight -= 1

            // Compose into a world-space horizontal direction; normalise so diagonals aren't faster.
            let dirX = forward.x * inFwd + right.x * inRight
            let dirZ = forward.z * inFwd + right.z * inRight
            const dirLen = Math.hypot(dirX, dirZ)
            if (dirLen > 0) {
                dirX /= dirLen
                dirZ /= dirLen
            }
            // Armor weight scales the base walk speed. world.playerStats is
            // recomputed by hud-system whenever the armory changes; this just
            // reads the cached multiplier.
            const effectiveSpeed = moveSpeed * world.playerStats.moveSpeedMult
            const targetVx = dirX * effectiveSpeed
            const targetVz = dirZ * effectiveSpeed

            // Frame-rate independent exponential smoothing.
            const alpha = 1 - Math.exp(-accel * dt)

            let jumpBuffered = actions.hasBufferedPress(actionIds.jump)
            const pointer = input.getPointer()
            if (pointer) {
                screenToWorldRay(pointer.x, pointer.y, iso.camera, pointerRay)
            }
            const now = performance.now()

            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                const grounded = hasComponent(world, eid, Grounded)
                if (grounded) lastGroundedAt.set(eid, now)

                Velocity.x[eid] += (targetVx - Velocity.x[eid]) * alpha
                Velocity.z[eid] += (targetVz - Velocity.z[eid]) * alpha

                const canJump = grounded || now - (lastGroundedAt.get(eid) ?? -Infinity) <= coyoteMs
                if (jumpBuffered && canJump) {
                    actions.consumePressed(actionIds.jump, eid)
                    jumpBuffered = false
                    Velocity.y[eid] = jumpVelocity
                    removeComponent(world, eid, Grounded)
                    lastGroundedAt.delete(eid)
                }

                // Aim follows the mouse on the player's current ground plane.
                // Movement remains camera-relative, so strafing and backing up are possible.
                if (hasComponent(world, eid, Rotation)) {
                    if (pointer && Math.abs(pointerRay.direction.y) > 0.0001) {
                        const t = (Position.y[eid] - pointerRay.origin.y) / pointerRay.direction.y
                        const lookX = pointerRay.origin.x + pointerRay.direction.x * t
                        const lookZ = pointerRay.origin.z + pointerRay.direction.z * t
                        const dx = lookX - Position.x[eid]
                        const dz = lookZ - Position.z[eid]
                        if (t > 0 && Math.hypot(dx, dz) > 0.08) {
                            Rotation.y[eid] = Math.atan2(dx, dz)
                        }
                    } else {
                        const horizSpeed = Math.hypot(Velocity.x[eid], Velocity.z[eid])
                        if (horizSpeed <= 0.5) continue
                        Rotation.y[eid] = Math.atan2(Velocity.x[eid], Velocity.z[eid])
                    }
                }
            }
        },
    }
}

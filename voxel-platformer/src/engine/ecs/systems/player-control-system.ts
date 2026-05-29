import { Vector3 } from 'three'
import { hasComponent, query, removeComponent } from 'bitecs'
import { BoxCollider, Grounded, PlayerControlled, Position, RidingCart, Rotation, Velocity } from '../components'
import type { Input } from '../../input/input'
import type { ActionMap, ActionId } from '../../input/actions'
import type { IsometricCamera } from '../../render/isometric-camera'
import type { System } from './system'
import { FixedOrder } from './orders'
import { makeRay, screenToWorldRay } from '../../input/pointer'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import { DEFAULT_MOVEMENT_ENVIRONMENT, movementEnvironmentForAABB } from '../../voxel/movement-effects'

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
    /** Optional voxel world query for non-physical movement effects such as water. */
    chunks?: ChunkManager
    actions?: PlayerControlActions
    /** Fires the frame a player jump is accepted (after coyote/buffer
     *  resolution). Used to drive the take-off audio cue. */
    onJump?: (eid: number) => void
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
    const moveSpeedOverride = opts.moveSpeed
    const jumpVelocityOverride = opts.jumpVelocity
    const accel = opts.accel ?? 18
    const jumpBufferMs = opts.jumpBufferMs ?? 200
    const coyoteMs = opts.coyoteMs ?? 100
    const chunks = opts.chunks
    const onJump = opts.onJump
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
    const playerAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }

    return {
        fixed: true,
        order: FixedOrder.input,
        update(world, dt) {
            const eids = query(world, [PlayerControlled, Position, Velocity, BoxCollider])
            if (eids.length === 0) return

            // Camera-relative basis. getPanForward points from target back toward
            // the camera (away from the view), so negate for "into the screen".
            iso.getPanForward(forward).negate()
            iso.getPanRight(right)

            const playerSettings = world.playerSettings

            // Read input direction.
            let inFwd = 0
            let inRight = 0
            if (playerSettings.abilities.movement) {
                if (actions.isHeld(actionIds.forward)) inFwd += 1
                if (actions.isHeld(actionIds.backward)) inFwd -= 1
                if (actions.isHeld(actionIds.right)) inRight += 1
                if (actions.isHeld(actionIds.left)) inRight -= 1
            }

            // Compose into a world-space horizontal direction; normalise so diagonals aren't faster.
            let dirX = forward.x * inFwd + right.x * inRight
            let dirZ = forward.z * inFwd + right.z * inRight
            const dirLen = Math.hypot(dirX, dirZ)
            if (dirLen > 0) {
                dirX /= dirLen
                dirZ /= dirLen
            }
            // Plain walk speed. Original engine modulated this by armor
            // weight via world.playerStats; the platformer foundation drops
            // that hook with the inventory layer.
            const moveSpeed = moveSpeedOverride ?? playerSettings.moveSpeed
            const baseTargetVx = dirX * moveSpeed
            const baseTargetVz = dirZ * moveSpeed

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
                if (hasComponent(world, eid, RidingCart)) {
                    Velocity.x[eid] = 0
                    Velocity.y[eid] = 0
                    Velocity.z[eid] = 0
                    continue
                }
                const grounded = hasComponent(world, eid, Grounded)
                if (grounded) lastGroundedAt.set(eid, now)

                const movement = chunks
                    ? movementEnvironmentForAABB(chunks, playerAABBForEid(eid, playerAabb))
                    : DEFAULT_MOVEMENT_ENVIRONMENT
                const targetVx = baseTargetVx * movement.speedMultiplier
                const targetVz = baseTargetVz * movement.speedMultiplier
                Velocity.x[eid] += (targetVx - Velocity.x[eid]) * alpha
                Velocity.z[eid] += (targetVz - Velocity.z[eid]) * alpha

                const canJump = grounded || now - (lastGroundedAt.get(eid) ?? -Infinity) <= coyoteMs
                const jumpVelocity = jumpVelocityOverride ?? playerSettings.jumpVelocity
                if (jumpBuffered && (!playerSettings.abilities.jump || movement.jumpDisabled)) {
                    actions.consumePressed(actionIds.jump, eid)
                    jumpBuffered = false
                } else if (jumpBuffered && canJump) {
                    actions.consumePressed(actionIds.jump, eid)
                    jumpBuffered = false
                    Velocity.y[eid] = jumpVelocity
                    removeComponent(world, eid, Grounded)
                    lastGroundedAt.delete(eid)
                    onJump?.(eid)
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

function playerAABBForEid(eid: number, out: AABB): AABB {
    return aabbFromFoot(
        { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
        { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] },
        out,
    )
}

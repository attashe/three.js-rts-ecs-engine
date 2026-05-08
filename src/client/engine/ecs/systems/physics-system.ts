import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { ChunkManager, ColliderAnchor } from '../../voxel'
import { aabbFromCenter, aabbFromFoot, isGrounded, sweepAxis } from '../../voxel'
import {
    BoxCollider,
    Grounded,
    HorizontalBlocked,
    MovementState,
    Position,
    RigidBody,
    Rotation,
    Sleeping,
    Velocity,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { MovementStateId } from '../movement-state'

const DEFAULT_GRAVITY_SCALE = 1
const DEFAULT_MASS = 1
const DEFAULT_SLEEP_THRESHOLD_SQ = 0.04
const DEFAULT_SLEEP_DELAY = 0.6
/** Below this inbound speed (m/s) we don't bother emitting an impact event,
 *  even if restitution is non-zero. Avoids per-frame noise from gentle landings. */
const IMPACT_MIN_SPEED = 3.0

export interface PhysicsOptions {
    /** Downward acceleration in world-units / second². Default 24. */
    gravity?: number
    /** Terminal vertical fall speed (clamped). Default 40. */
    maxFallSpeed?: number
}

/**
 * Fixed-step physics for everything with `Position + Velocity + BoxCollider`.
 *
 * Per entity:
 *   1. Gravity (scaled by RigidBody.gravityScale if present).
 *   2. Swept-AABB X → Z → Y against voxels AND the world's obstacle registry.
 *      Y-last so horizontal motion happens before the ground sweep — that's
 *      what gives characters a free 1-voxel "step up" onto ledges.
 *   3. Restitution on Y-block: if restitution>0 and the Y-block was a real
 *      slam (vy < -IMPACT_MIN_SPEED), bounce; emit an Impact event for
 *      damage/sound/FX downstream.
 *   4. Linear damping on horizontal velocity while grounded.
 *   5. Update Grounded/HorizontalBlocked tags + MovementState hint.
 *   6. Sleep tracking: low-speed grounded bodies with a RigidBody accumulate
 *      sleepTimer; on threshold the entity gains the Sleeping tag, loses
 *      Velocity, and registers an AABB in the obstacle registry. Subsequent
 *      sweeps will collide with it as if it were a voxel.
 *
 * Sleeping bodies are NOT in this system's query (they have no Velocity), so
 * there's no per-frame skip cost.
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
            const obstacles = world.obstacles
            const eids = query(world, [Position, Velocity, BoxCollider])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                const hasRb = hasComponent(world, eid, RigidBody)

                const gravityScale = hasRb && RigidBody.gravityScale[eid] !== 0
                    ? RigidBody.gravityScale[eid]
                    : DEFAULT_GRAVITY_SCALE
                const terminal = hasRb && RigidBody.maxFallSpeed[eid] > 0
                    ? RigidBody.maxFallSpeed[eid]
                    : maxFallSpeed

                let vy = Velocity.y[eid] - gravity * gravityScale * dt
                if (vy < -terminal) vy = -terminal

                pos.x = Position.x[eid]
                pos.y = Position.y[eid]
                pos.z = Position.z[eid]
                half.x = BoxCollider.x[eid]
                half.y = BoxCollider.y[eid]
                half.z = BoxCollider.z[eid]

                const anchor: ColliderAnchor = hasRb && RigidBody.centerAnchored[eid] === 1
                    ? 'center'
                    : 'foot'

                const dx = Velocity.x[eid] * dt
                const dz = Velocity.z[eid] * dt
                const dy = vy * dt

                const sweepX = sweepAxis(chunks, pos, half, 'x', dx, obstacles, eid, anchor)
                if (sweepX.blocked) Velocity.x[eid] = 0

                const sweepZ = sweepAxis(chunks, pos, half, 'z', dz, obstacles, eid, anchor)
                if (sweepZ.blocked) Velocity.z[eid] = 0

                const horizontalBlocked = sweepX.blocked || sweepZ.blocked
                const hadBlocked = hasComponent(world, eid, HorizontalBlocked)
                if (horizontalBlocked && !hadBlocked) addComponent(world, eid, HorizontalBlocked)
                else if (!horizontalBlocked && hadBlocked) removeComponent(world, eid, HorizontalBlocked)

                const sweepY = sweepAxis(chunks, pos, half, 'y', dy, obstacles, eid, anchor)

                let landedHard = false
                let inboundSpeed = 0
                if (sweepY.blocked) {
                    const incoming = vy
                    if (incoming < -IMPACT_MIN_SPEED) {
                        landedHard = true
                        inboundSpeed = -incoming
                    }
                    const restitution = hasRb ? RigidBody.restitution[eid] : 0
                    if (restitution > 0 && landedHard) {
                        // Bounce; remaining energy is restitution²·KE which we
                        // approximate by scaling vy directly.
                        vy = -incoming * restitution
                    } else {
                        vy = 0
                    }
                }
                Velocity.y[eid] = vy

                Position.x[eid] = pos.x
                Position.y[eid] = pos.y
                Position.z[eid] = pos.z

                const grounded = isGrounded(chunks, pos, half, 0.08, obstacles, eid, anchor)
                const had = hasComponent(world, eid, Grounded)
                if (grounded && !had) addComponent(world, eid, Grounded)
                else if (!grounded && had) removeComponent(world, eid, Grounded)
                if (!grounded && Math.abs(Velocity.y[eid]) > 0.1) {
                    MovementState.value[eid] = MovementStateId.Airborne
                } else if (horizontalBlocked) {
                    MovementState.value[eid] = MovementStateId.Blocked
                }

                // Linear damping (e.g. friction on rolling stones) — applied while
                // grounded only, so airborne velocity is preserved.
                if (hasRb && grounded && RigidBody.linearDamping[eid] > 0) {
                    const damp = Math.exp(-RigidBody.linearDamping[eid] * dt)
                    Velocity.x[eid] *= damp
                    Velocity.z[eid] *= damp
                }

                // Visual rolling tumble for stone-like bodies.
                if (hasRb && grounded && RigidBody.rollOnGround[eid] === 1) {
                    Rotation.x[eid] += Velocity.z[eid] * dt * 1.8
                    Rotation.z[eid] -= Velocity.x[eid] * dt * 1.8
                }

                // Hard-impact event — for damage / FX systems downstream.
                if (hasRb && landedHard && RigidBody.impactDamageScale[eid] > 0) {
                    const mass = RigidBody.mass[eid] > 0 ? RigidBody.mass[eid] : DEFAULT_MASS
                    world.impactEvents.push({
                        eid,
                        speed: inboundSpeed,
                        mass,
                        x: pos.x,
                        y: pos.y,
                        z: pos.z,
                    })
                }

                // Sleep tracking — only RigidBody entities can settle. The body
                // sleeps once it has been stationary on the ground for sleepDelay
                // seconds, at which point it becomes a static obstacle.
                if (!hasRb) continue

                const speedSq =
                    Velocity.x[eid] * Velocity.x[eid] +
                    Velocity.y[eid] * Velocity.y[eid] +
                    Velocity.z[eid] * Velocity.z[eid]
                const threshold = RigidBody.sleepThresholdSq[eid] > 0
                    ? RigidBody.sleepThresholdSq[eid]
                    : DEFAULT_SLEEP_THRESHOLD_SQ
                if (grounded && speedSq < threshold) {
                    RigidBody.sleepTimer[eid] += dt
                } else {
                    RigidBody.sleepTimer[eid] = 0
                }

                const delay = RigidBody.sleepDelay[eid] > 0
                    ? RigidBody.sleepDelay[eid]
                    : DEFAULT_SLEEP_DELAY
                if (RigidBody.sleepTimer[eid] >= delay) {
                    sleepBody(world, eid, half, anchor)
                }
            }
        },
    }
}

function sleepBody(
    world: Parameters<System['update']>[0],
    eid: number,
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
): void {
    Velocity.x[eid] = 0
    Velocity.y[eid] = 0
    Velocity.z[eid] = 0
    removeComponent(world, eid, Velocity)
    if (hasComponent(world, eid, HorizontalBlocked)) removeComponent(world, eid, HorizontalBlocked)
    addComponent(world, eid, Sleeping)
    const out = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
    const aabb = anchor === 'center'
        ? aabbFromCenter(pos, half, out)
        : aabbFromFoot(pos, half, out)
    world.obstacles.add(eid, aabb)
}

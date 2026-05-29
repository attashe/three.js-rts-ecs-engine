import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { aabbFromCenter, aabbFromFoot, isGrounded, sweepAxis, voxelAABBOverlap, type AABB, type ColliderAnchor } from '../../voxel/voxel-collide'
import {
    BoxCollider,
    Grounded,
    HorizontalBlocked,
    MovementState,
    MovingObject,
    Position,
    Renderable,
    RigidBody,
    RidingCart,
    Rotation,
    Sleeping,
    StaticRenderable,
    Velocity,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { MovementStateId } from '../movement-state'

export const DEFAULT_PHYSICS_GRAVITY = 24
const DEFAULT_GRAVITY_SCALE = 1
const DEFAULT_MASS = 1
const DEFAULT_SLEEP_THRESHOLD_SQ = 0.04
const DEFAULT_SLEEP_DELAY = 0.6
const STALLED_BODY_MOVE_RATIO = 0.04
const STALLED_BODY_MIN_INTENT_SQ = 0.000001
const STUCK_RECOVERY_STEP = 0.05
/** Below this inbound speed (m/s) we don't bother emitting an impact event,
 *  even if restitution is non-zero. Avoids per-frame noise from gentle landings. */
const IMPACT_MIN_SPEED = 3.0

export interface ImpactEvent {
    /** Entity that just slammed into a Y-blocking surface. */
    eid: number
    /** `MovingObject.kind` for this entity, or 0 if it has no
     *  `MovingObject` component. Lets the consumer filter by category
     *  (e.g. stone vs arrow vs player) without re-importing the
     *  component arrays. */
    movingObjectKind: number
    /** World-space contact position (the entity's centre at the moment
     *  of the block). */
    x: number
    y: number
    z: number
    /** Positive m/s — how fast the body was descending when blocked. */
    speed: number
    /** Horizontal speed at the moment of impact — useful for grit /
     *  scrape modulation on top of the vertical thud. */
    horizontalSpeed: number
}

export interface PhysicsOptions {
    /** Downward acceleration in world-units / second². Default 24. */
    gravity?: number
    /** Terminal vertical fall speed (clamped). Default 40. */
    maxFallSpeed?: number
    /** Fires every time a body's vertical sweep is blocked at a speed
     *  above the threshold. Use for FX / damage / one-shot sfx like a
     *  stone-impact clack. The callback runs inside the fixed step, so
     *  keep it cheap — push to a queue if you need to drain on the
     *  render thread. */
    onImpact?: (event: ImpactEvent) => void
    /** Minimum inbound speed before an impact event is emitted. Defaults
     *  to `IMPACT_MIN_SPEED` (3 m/s) — below that, a landing reads as
     *  "settled gently" and we don't want sfx noise on it. */
    impactMinSpeed?: number
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
    const gravity = opts.gravity ?? DEFAULT_PHYSICS_GRAVITY
    const maxFallSpeed = opts.maxFallSpeed ?? 40
    const onImpact = opts.onImpact
    const impactMinSpeed = Math.max(0, opts.impactMinSpeed ?? IMPACT_MIN_SPEED)

    const pos = { x: 0, y: 0, z: 0 }
    const half = { x: 0, y: 0, z: 0 }

    return {
        fixed: true,
        order: FixedOrder.physics,
        update(world, dt) {
            const obstacles = world.obstacles
            const eids = query(world, [Position, Velocity, BoxCollider])
            let sleepChecks = 0
            let sleptBodies = 0
            let recoveredBodies = 0
            let stuckBodies = 0
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                if (hasComponent(world, eid, RidingCart)) continue
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
                const startX = pos.x
                const startZ = pos.z
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
                    if (incoming < -impactMinSpeed) {
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

                if (landedHard && onImpact) {
                    const horizontalSpeed = Math.hypot(Velocity.x[eid], Velocity.z[eid])
                    const movingObjectKind = hasComponent(world, eid, MovingObject)
                        ? MovingObject.kind[eid]
                        : 0
                    onImpact({
                        eid,
                        movingObjectKind,
                        x: pos.x,
                        y: pos.y,
                        z: pos.z,
                        speed: inboundSpeed,
                        horizontalSpeed,
                    })
                }

                if (hasRb && RigidBody.rollOnGround[eid] === 1) {
                    const recovered = recoverVoxelOverlap(chunks, world, eid, pos, half, anchor)
                    if (recovered === 'recovered') {
                        Velocity.x[eid] = 0
                        Velocity.y[eid] = 0
                        Velocity.z[eid] = 0
                        vy = 0
                        recoveredBodies++
                    } else if (recovered === 'stuck') {
                        stuckBodies++
                    }
                }

                Position.x[eid] = pos.x
                Position.y[eid] = pos.y
                Position.z[eid] = pos.z

                const grounded = isGrounded(chunks, pos, half, 0.08, obstacles, eid, anchor)
                const had = hasComponent(world, eid, Grounded)
                if (grounded && !had) addComponent(world, eid, Grounded)
                else if (!grounded && had) removeComponent(world, eid, Grounded)
                if (
                    hasRb &&
                    grounded &&
                    Velocity.y[eid] < 0 &&
                    isOverlappingCompatibleSleepingBody(world, eid, half, anchor)
                ) {
                    Velocity.y[eid] = 0
                }
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
                    if (RigidBody.rollOnGround[eid] === 1 && isHorizontallyStalled(dx, dz, pos.x - startX, pos.z - startZ)) {
                        Velocity.x[eid] = 0
                        Velocity.z[eid] = 0
                    }
                }

                // Visual rolling tumble for stone-like bodies.
                if (hasRb && grounded && RigidBody.rollOnGround[eid] === 1) {
                    Rotation.x[eid] += Velocity.z[eid] * dt * 1.8
                    Rotation.z[eid] -= Velocity.x[eid] * dt * 1.8
                }

                // landedHard / inboundSpeed are consumed above via `onImpact`
                // when a callback is wired up. Without a callback they're
                // discarded — the locals are kept for cheap restitution gating.

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
                    sleepChecks++
                    if (canSleepHere(world, eid, half, anchor)) {
                        sleepBody(world, eid, half, anchor)
                        sleptBodies++
                    } else {
                        // Some other entity (player, NPC, another stone) is
                        // overlapping where the obstacle AABB would land — if
                        // we slept now we'd register an obstacle that contains
                        // the other body, trapping it. Hold the timer back so
                        // we re-check next frame; if the blocker moves away
                        // we'll settle then.
                        RigidBody.sleepTimer[eid] = delay * 0.5
                    }
                }
            }
            world.metrics.setGauge('physics.active', eids.length)
            world.metrics.setGauge('physics.sleepChecks', sleepChecks)
            world.metrics.setGauge('physics.slept', sleptBodies)
            world.metrics.setGauge('physics.recovered', recoveredBodies)
            world.metrics.setGauge('physics.stuck', stuckBodies)
        },
    }
}

const tmpAABB: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
const tmpOther: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
const tmpRecoveryAABB: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
const tmpRecoveryPos = { x: 0, y: 0, z: 0 }
const HORIZONTAL_RECOVERY_DIRS = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
    { x: Math.SQRT1_2, z: Math.SQRT1_2 },
    { x: -Math.SQRT1_2, z: Math.SQRT1_2 },
    { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
    { x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
] as const


function isHorizontallyStalled(
    intendedX: number,
    intendedZ: number,
    actualX: number,
    actualZ: number,
): boolean {
    const intendedSq = intendedX * intendedX + intendedZ * intendedZ
    if (intendedSq < STALLED_BODY_MIN_INTENT_SQ) return false
    const actualSq = actualX * actualX + actualZ * actualZ
    return actualSq < intendedSq * STALLED_BODY_MOVE_RATIO
}

function recoverVoxelOverlap(
    chunks: ChunkManager,
    world: Parameters<System['update']>[0],
    eid: number,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
): 'clear' | 'recovered' | 'stuck' {
    if (!overlapsVoxels(chunks, pos, half, anchor)) return 'clear'

    const maxHalf = Math.max(half.x, half.y, half.z)
    const maxDistance = Math.max(0.75, maxHalf * 2 + 0.25)
    for (let d = STUCK_RECOVERY_STEP; d <= maxDistance + 0.0001; d += STUCK_RECOVERY_STEP) {
        if (tryRecoveryOffset(chunks, world, eid, pos, half, anchor, 0, d, 0)) return 'recovered'
    }

    for (let d = STUCK_RECOVERY_STEP; d <= maxDistance + 0.0001; d += STUCK_RECOVERY_STEP) {
        for (let i = 0; i < HORIZONTAL_RECOVERY_DIRS.length; i++) {
            const dir = HORIZONTAL_RECOVERY_DIRS[i]!
            if (tryRecoveryOffset(chunks, world, eid, pos, half, anchor, dir.x * d, 0, dir.z * d)) {
                return 'recovered'
            }
            if (tryRecoveryOffset(chunks, world, eid, pos, half, anchor, dir.x * d, STUCK_RECOVERY_STEP, dir.z * d)) {
                return 'recovered'
            }
        }
    }

    return 'stuck'
}

function tryRecoveryOffset(
    chunks: ChunkManager,
    world: Parameters<System['update']>[0],
    eid: number,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
    dx: number,
    dy: number,
    dz: number,
): boolean {
    tmpRecoveryPos.x = pos.x + dx
    tmpRecoveryPos.y = pos.y + dy
    tmpRecoveryPos.z = pos.z + dz
    aabbForAnchor(tmpRecoveryPos, half, anchor, tmpRecoveryAABB)
    if (voxelAABBOverlap(chunks, tmpRecoveryAABB)) return false
    if (world.obstacles.intersects(tmpRecoveryAABB, eid)) return false
    pos.x = tmpRecoveryPos.x
    pos.y = tmpRecoveryPos.y
    pos.z = tmpRecoveryPos.z
    return true
}

function overlapsVoxels(
    chunks: ChunkManager,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
): boolean {
    aabbForAnchor(pos, half, anchor, tmpRecoveryAABB)
    return voxelAABBOverlap(chunks, tmpRecoveryAABB)
}

function aabbForAnchor(
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
    out: AABB,
): AABB {
    return anchor === 'center'
        ? aabbFromCenter(pos, half, out)
        : aabbFromFoot(pos, half, out)
}

function canSleepHere(
    world: Parameters<System['update']>[0],
    eid: number,
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
): boolean {
    const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
    const aabb = anchor === 'center'
        ? aabbFromCenter(pos, half, tmpAABB)
        : aabbFromFoot(pos, half, tmpAABB)

    const others = query(world, [Position, BoxCollider])
    for (let i = 0; i < others.length; i++) {
        const other = others[i]
        if (other === eid) continue
        const otherAnchor: ColliderAnchor =
            hasComponent(world, other, RigidBody) && RigidBody.centerAnchored[other] === 1
                ? 'center'
                : 'foot'
        const otherHalf = {
            x: BoxCollider.x[other],
            y: BoxCollider.y[other],
            z: BoxCollider.z[other],
        }
        const otherPos = { x: Position.x[other], y: Position.y[other], z: Position.z[other] }
        const otherBox = otherAnchor === 'center'
            ? aabbFromCenter(otherPos, otherHalf, tmpOther)
            : aabbFromFoot(otherPos, otherHalf, tmpOther)
        if (isSleepCompatibleRigidBodyOverlap(world, eid, other)) continue
        if (
            aabb.maxX > otherBox.minX && aabb.minX < otherBox.maxX &&
            aabb.maxY > otherBox.minY && aabb.minY < otherBox.maxY &&
            aabb.maxZ > otherBox.minZ && aabb.minZ < otherBox.maxZ
        ) {
            return false
        }
    }
    return true
}

function isSleepCompatibleRigidBodyOverlap(
    world: Parameters<System['update']>[0],
    eid: number,
    other: number,
): boolean {
    if (!hasComponent(world, eid, RigidBody) || !hasComponent(world, other, RigidBody)) return false
    if (!hasComponent(world, eid, MovingObject) || !hasComponent(world, other, MovingObject)) return false
    return MovingObject.kind[eid] === MovingObject.kind[other]
}

function isOverlappingCompatibleSleepingBody(
    world: Parameters<System['update']>[0],
    eid: number,
    half: { x: number; y: number; z: number },
    anchor: ColliderAnchor,
): boolean {
    const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
    const aabb = anchor === 'center'
        ? aabbFromCenter(pos, half, tmpAABB)
        : aabbFromFoot(pos, half, tmpAABB)
    const others = query(world, [Position, BoxCollider, Sleeping])
    for (let i = 0; i < others.length; i++) {
        const other = others[i]
        if (other === eid || !isSleepCompatibleRigidBodyOverlap(world, eid, other)) continue
        const otherAnchor: ColliderAnchor =
            hasComponent(world, other, RigidBody) && RigidBody.centerAnchored[other] === 1
                ? 'center'
                : 'foot'
        const otherHalf = {
            x: BoxCollider.x[other],
            y: BoxCollider.y[other],
            z: BoxCollider.z[other],
        }
        const otherPos = { x: Position.x[other], y: Position.y[other], z: Position.z[other] }
        const otherBox = otherAnchor === 'center'
            ? aabbFromCenter(otherPos, otherHalf, tmpOther)
            : aabbFromFoot(otherPos, otherHalf, tmpOther)
        if (
            aabb.maxX > otherBox.minX && aabb.minX < otherBox.maxX &&
            aabb.maxY > otherBox.minY && aabb.minY < otherBox.maxY &&
            aabb.maxZ > otherBox.minZ && aabb.minZ < otherBox.maxZ
        ) {
            return true
        }
    }
    return false
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
    if (hasComponent(world, eid, Renderable)) addComponent(world, eid, StaticRenderable)
    const out: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
    const aabb = anchor === 'center'
        ? aabbFromCenter(pos, half, out)
        : aabbFromFoot(pos, half, out)
    world.obstacles.add(eid, aabb)
}

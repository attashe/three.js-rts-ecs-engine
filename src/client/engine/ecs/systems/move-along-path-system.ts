import { hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxCollider,
    Grounded,
    HorizontalBlocked,
    Interactable,
    MoveAlongPath,
    MovementState,
    PlayerControlled,
    Position,
    Rotation,
    Velocity,
    Wanderer,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { MovementStateId } from '../movement-state'
import { pushGameLog } from '../world'
import { steerAroundActors, type AvoidanceActor } from '../actor-avoidance'

const EPSILON = 1e-3
const PHYSICS_ARRIVAL_RADIUS = 0.16
const PHYSICS_VERTICAL_ARRIVAL_RADIUS = 0.28
const WANDERER_JUMP_VELOCITY = 8.4
const STUCK_SIDESTEP_DELAY_SECONDS = 0.12
const STUCK_SIDESTEP_INTERVAL_SECONDS = 0.35
const BLOCKED_WAYPOINT_SKIP_SECONDS = 0.28
const BLOCKED_REPATH_SECONDS = 0.65
const MAX_BLOCKED_WAYPOINT_SKIPS = 2

/**
 * Walks each `MoveAlongPath` entity toward its current waypoint at the speed
 * stored in `world.pathByEid[eid].speed`. When the entity reaches the final
 * waypoint, the tag is removed and the path entry is deleted.
 *
 * Entities with Velocity are controller-driven: the system writes desired
 * horizontal velocity and leaves Position integration to physics/movement.
 * Entities without Velocity fall back to direct Position movement.
 */
export const MoveAlongPathSystem: System = {
    fixed: true,
    order: FixedOrder.movement,
    update(world, dt) {
        const eids = query(world, [MoveAlongPath, Position])
        const avoidanceActors = collectAvoidanceActors(world)
        for (let i = 0; i < eids.length; i++) {
            const eid = eids[i]
            const state = world.pathByEid.get(eid)
            if (!state) {
                if (hasComponent(world, eid, Velocity)) {
                    Velocity.x[eid] = 0
                    Velocity.z[eid] = 0
                }
                MovementState.value[eid] = MovementStateId.Idle
                if (hasComponent(world, eid, HorizontalBlocked)) removeComponent(world, eid, HorizontalBlocked)
                removeComponent(world, eid, MoveAlongPath)
                continue
            }

            // If we've consumed every waypoint, finish.
            if (state.index >= state.points.length) {
                if (hasComponent(world, eid, Velocity)) {
                    Velocity.x[eid] = 0
                    Velocity.z[eid] = 0
                }
                MovementState.value[eid] = MovementStateId.Idle
                if (hasComponent(world, eid, HorizontalBlocked)) removeComponent(world, eid, HorizontalBlocked)
                world.pathByEid.delete(eid)
                removeComponent(world, eid, MoveAlongPath)
                continue
            }

            const target = state.points[state.index]!
            const px = Position.x[eid]
            const py = Position.y[eid]
            const pz = Position.z[eid]
            const dx = target.x - px
            const dy = target.y - py
            const dz = target.z - pz
            const dist = Math.hypot(dx, dy, dz)

            const hasVelocity = hasComponent(world, eid, Velocity)
            const hasCollider = hasComponent(world, eid, BoxCollider)
            const horizDist = Math.hypot(dx, dz)
            const arrivalRadius = hasVelocity && hasCollider ? PHYSICS_ARRIVAL_RADIUS : EPSILON
            const arrived = hasCollider
                ? horizDist < arrivalRadius && Math.abs(dy) < PHYSICS_VERTICAL_ARRIVAL_RADIUS
                : dist < arrivalRadius

            if (arrived) {
                state.index++
                state.blockedTime = 0
                state.blockedSkips = 0
                if (hasVelocity) {
                    Velocity.x[eid] = 0
                    Velocity.z[eid] = 0
                }
                MovementState.value[eid] = MovementStateId.Idle
                continue
            }

            if (hasVelocity) {
                const wasActorBlocked = MovementState.value[eid] === MovementStateId.Blocked ||
                    MovementState.value[eid] === MovementStateId.Repathing
                // Physics-owned/collidable entities must not bypass collision.
                const denom = hasCollider ? horizDist : dist
                let desiredX = denom > EPSILON ? (dx / denom) * state.speed : 0
                let desiredZ = denom > EPSILON ? (dz / denom) * state.speed : 0
                if (hasCollider && denom > EPSILON) {
                    const steered = steerAroundActors(
                        {
                            eid,
                            x: Position.x[eid],
                            y: Position.y[eid],
                            z: Position.z[eid],
                            radius: Math.max(BoxCollider.x[eid], BoxCollider.z[eid]),
                        },
                        desiredX,
                        desiredZ,
                        avoidanceActors,
                    )
                    desiredX = steered.x
                    desiredZ = steered.z
                }
                Velocity.x[eid] = desiredX
                Velocity.z[eid] = desiredZ
                const blockedByContact = hasCollider && wasActorBlocked
                const blockedByVoxel = hasCollider && hasComponent(world, eid, HorizontalBlocked)
                if (blockedByContact || blockedByVoxel) {
                    state.blockedTime = (state.blockedTime ?? 0) + dt
                    applyStuckSidestep(eid, state.blockedTime, desiredX, desiredZ)
                    if (
                        state.blockedTime > BLOCKED_WAYPOINT_SKIP_SECONDS &&
                        state.index < state.points.length - 1 &&
                        (state.blockedSkips ?? 0) < MAX_BLOCKED_WAYPOINT_SKIPS
                    ) {
                        state.index++
                        state.blockedTime = 0
                        state.blockedSkips = (state.blockedSkips ?? 0) + 1
                        MovementState.value[eid] = MovementStateId.Repathing
                        continue
                    }
                    if (state.blockedTime > BLOCKED_REPATH_SECONDS && hasComponent(world, eid, Wanderer)) {
                        Velocity.x[eid] = 0
                        Velocity.z[eid] = 0
                        MovementState.value[eid] = MovementStateId.Repathing
                        pushGameLog(world, { type: 'path', message: 'Actor repathing after being blocked.', eid })
                        world.pathByEid.delete(eid)
                        removeComponent(world, eid, MoveAlongPath)
                        removeComponent(world, eid, HorizontalBlocked)
                        // Behaviour-system will request the next path on its
                        // own repath cooldown (no per-entity timer needed).
                        continue
                    }
                } else {
                    state.blockedTime = 0
                }
                if (
                    hasCollider &&
                    hasComponent(world, eid, Wanderer) &&
                    hasComponent(world, eid, Grounded) &&
                    dy > 0.2 &&
                    (hasComponent(world, eid, HorizontalBlocked) || horizDist < 0.9)
                ) {
                    Velocity.y[eid] = Math.max(Velocity.y[eid], WANDERER_JUMP_VELOCITY)
                    MovementState.value[eid] = MovementStateId.Airborne
                    removeComponent(world, eid, Grounded)
                    removeComponent(world, eid, HorizontalBlocked)
                }
                if (MovementState.value[eid] !== MovementStateId.Airborne) {
                    MovementState.value[eid] = blockedByVoxel
                        ? MovementStateId.Blocked
                        : MovementStateId.Moving
                }
                if (!hasCollider) Velocity.y[eid] = (dy / dist) * state.speed
            } else {
                const stepLen = state.speed * dt
                if (stepLen >= dist) {
                    Position.x[eid] = target.x
                    Position.y[eid] = target.y
                    Position.z[eid] = target.z
                    state.index++
                } else {
                    Position.x[eid] = px + (dx / dist) * stepLen
                    Position.y[eid] = py + (dy / dist) * stepLen
                    Position.z[eid] = pz + (dz / dist) * stepLen
                }
            }

            // Yaw-only facing toward the next waypoint (XZ plane).
            if (hasComponent(world, eid, Rotation)) {
                if (Math.abs(dx) + Math.abs(dz) > EPSILON) {
                    Rotation.y[eid] = Math.atan2(dx, dz)
                }
            }
        }
    },
}

function applyStuckSidestep(eid: number, blockedTime: number, desiredX: number, desiredZ: number): void {
    if (blockedTime < STUCK_SIDESTEP_DELAY_SECONDS) return

    const speed = Math.hypot(desiredX, desiredZ)
    if (speed <= EPSILON) return

    const dirX = desiredX / speed
    const dirZ = desiredZ / speed
    const phase = Math.floor(blockedTime / STUCK_SIDESTEP_INTERVAL_SECONDS)
    const side = ((phase + eid) & 1) === 0 ? 1 : -1
    const strafeX = -dirZ * side
    const strafeZ = dirX * side
    const blendX = dirX * 0.18 + strafeX * 0.82
    const blendZ = dirZ * 0.18 + strafeZ * 0.82
    const blendLen = Math.hypot(blendX, blendZ)
    if (blendLen <= EPSILON) return

    Velocity.x[eid] = (blendX / blendLen) * speed
    Velocity.z[eid] = (blendZ / blendLen) * speed
}

function collectAvoidanceActors(world: Parameters<System['update']>[0]): AvoidanceActor[] {
    const eids = query(world, [Position, BoxCollider])
    const actors: AvoidanceActor[] = []
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        if (!isAvoidanceActor(world, eid)) continue
        actors.push({
            eid,
            x: Position.x[eid],
            y: Position.y[eid],
            z: Position.z[eid],
            radius: Math.max(BoxCollider.x[eid], BoxCollider.z[eid]),
        })
    }
    return actors
}

function isAvoidanceActor(world: Parameters<System['update']>[0], eid: number): boolean {
    return hasComponent(world, eid, PlayerControlled) ||
        hasComponent(world, eid, Wanderer) ||
        hasComponent(world, eid, Interactable)
}

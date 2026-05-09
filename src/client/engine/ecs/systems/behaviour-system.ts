import { Vector3 } from 'three'
import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import { findPath, type ChunkManager } from '../../voxel'
import {
    Attackable,
    Behaviour,
    BoxCollider,
    Health,
    Interactable,
    MoveAlongPath,
    PlayerControlled,
    Position,
    Rotation,
    Sleeping,
    Velocity,
    Wanderer,
} from '../components'
import {
    BehaviourStateId,
    decideTransition,
    getBehaviourProfile,
    getBehaviourTarget,
    setBehaviourState,
    type ActorBlackboard,
    type BehaviourProfile,
    type BehaviourSnapshot,
} from '../behaviour'
import { applyDamagePacket } from '../damage'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog, type GameWorld } from '../world'

const WANDER_SPEED = 2.2
const CHASE_SPEED = 2.9
const RETURN_SPEED = 2.6
const TARGET_MOVE_REPATH = 1.5

/**
 * Drives every actor with a `Behaviour` component. One pure resolver decides
 * transitions; per-state handlers translate intent into path goals (read by
 * `MoveAlongPathSystem`) or AI attack strikes (read by `damage`). The system
 * never writes `Position` directly — physics, path-follow, and dynamic
 * collision still own movement.
 */
export function createBehaviourSystem(chunks: ChunkManager): System {
    return {
        fixed: true,
        order: FixedOrder.ai,
        update(world, dt) {
            const eids = query(world, [Behaviour, Position])
            const blockers = collectDynamicBlockers(world)
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                tickActor(world, eid, dt, chunks, blockers)
            }
        },
    }
}

function tickActor(
    world: GameWorld,
    eid: number,
    dt: number,
    chunks: ChunkManager,
    blockers: DynamicBlocker[],
): void {
    Behaviour.stateTime[eid] += dt
    Behaviour.nextThinkAt[eid] = Math.max(0, Behaviour.nextThinkAt[eid] - dt)
    Behaviour.nextRepathAt[eid] = Math.max(0, Behaviour.nextRepathAt[eid] - dt)

    const profile = getBehaviourProfile(Behaviour.profileId[eid])
    const blackboard = world.behaviourByEid.get(eid)
    if (!profile || !blackboard) return
    blackboard.stateTime = Behaviour.stateTime[eid]

    const snapshot = buildSnapshot(world, eid, blackboard, profile)
    const next = decideTransition(profile, snapshot)
    if (next !== null && next !== snapshot.state) {
        onExitState(world, eid, snapshot.state)
        setBehaviourState(world, eid, next)
        onEnterState(world, eid, next, blackboard)
    }

    const active = Behaviour.state[eid] as BehaviourStateId
    switch (active) {
        case BehaviourStateId.Wander: handleWander(world, eid, blackboard, profile, chunks, blockers); break
        case BehaviourStateId.Chase: handleChase(world, eid, blackboard, profile, chunks, snapshot); break
        case BehaviourStateId.Attack: handleAttack(world, eid, profile, snapshot); break
        case BehaviourStateId.ReturnHome: handleReturnHome(world, eid, blackboard, chunks); break
        case BehaviourStateId.Idle: handleIdle(world, eid); break
        case BehaviourStateId.Dead: /* nothing */ break
    }
}

function buildSnapshot(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    profile: BehaviourProfile,
): BehaviourSnapshot {
    const targetEid = getBehaviourTarget(eid)
    const visible = targetEid !== null
        && hasComponent(world, targetEid, Position)
        && (!hasComponent(world, targetEid, Health) || Health.current[targetEid] > 0)

    const px = Position.x[eid]
    const py = Position.y[eid]
    const pz = Position.z[eid]
    let dToTarget = 0
    if (visible && targetEid !== null) {
        const dx = Position.x[targetEid] - px
        const dy = Position.y[targetEid] - py
        const dz = Position.z[targetEid] - pz
        dToTarget = Math.hypot(dx, dy, dz)
    }
    const home = blackboard.home
    const dToHome = Math.hypot(home.x - px, home.y - py, home.z - pz)

    const health = hasComponent(world, eid, Health) ? Health.current[eid] : 1

    return {
        state: Behaviour.state[eid] as BehaviourStateId,
        health,
        targetEid: visible ? targetEid : null,
        targetVisible: visible,
        distanceToTarget: dToTarget,
        distanceToHome: dToHome,
    }
}

function onExitState(world: GameWorld, eid: number, state: BehaviourStateId): void {
    if (state === BehaviourStateId.Wander || state === BehaviourStateId.Chase || state === BehaviourStateId.ReturnHome) {
        clearPath(world, eid)
    }
}

function onEnterState(world: GameWorld, eid: number, state: BehaviourStateId, blackboard: ActorBlackboard): void {
    if (state === BehaviourStateId.Attack || state === BehaviourStateId.Idle) {
        clearPath(world, eid)
    }
    if (state === BehaviourStateId.Chase || state === BehaviourStateId.Wander || state === BehaviourStateId.ReturnHome) {
        blackboard.pathGoal = null
    }
    if (state === BehaviourStateId.Dead) {
        clearPath(world, eid)
        if (hasComponent(world, eid, Velocity)) {
            Velocity.x[eid] = 0
            Velocity.z[eid] = 0
        }
        if (hasComponent(world, eid, Attackable)) removeComponent(world, eid, Attackable)
        const interaction = world.interactionByEid.get(eid)
        pushGameLog(world, {
            type: 'combat',
            message: `${interaction?.label ?? 'A foe'} falls.`,
            eid,
        })
    }
}

function handleIdle(world: GameWorld, eid: number): void {
    if (hasComponent(world, eid, Velocity)) {
        Velocity.x[eid] = 0
        Velocity.z[eid] = 0
    }
}

function handleWander(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    profile: BehaviourProfile,
    chunks: ChunkManager,
    blockers: DynamicBlocker[],
): void {
    if (hasComponent(world, eid, MoveAlongPath)) return
    if (Behaviour.nextRepathAt[eid] > 0) return

    const start = {
        x: Math.floor(Position.x[eid]),
        y: Math.floor(Position.y[eid]),
        z: Math.floor(Position.z[eid]),
    }
    const goal = chooseWanderGoal(eid, blackboard.home, profile.wanderRadius)
    const path = findPath(chunks, start, goal, {
        maxNodes: 2048,
        maxStepUp: 1,
        maxDrop: 2,
        surfaceSearchRange: 8,
        isBlocked: (x, y, z) => isDynamicallyBlocked(blockers, eid, x, y, z),
    })

    if (path && path.length > 1) {
        world.pathByEid.set(eid, {
            points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
            index: 0,
            speed: WANDER_SPEED,
        })
        blackboard.pathGoal = { ...goal }
        addComponent(world, eid, MoveAlongPath)
        Behaviour.nextRepathAt[eid] = profile.repathCooldown
    } else {
        Behaviour.nextRepathAt[eid] = profile.repathCooldown * 0.5
    }
}

function handleChase(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    profile: BehaviourProfile,
    chunks: ChunkManager,
    snapshot: BehaviourSnapshot,
): void {
    if (snapshot.targetEid === null) return

    const target = snapshot.targetEid
    faceTowards(eid, Position.x[target], Position.z[target])

    const pathGoal = blackboard.pathGoal
    const targetMoved = pathGoal
        ? Math.hypot(Position.x[target] - pathGoal.x, Position.z[target] - pathGoal.z)
        : Infinity

    const needsRepath = !hasComponent(world, eid, MoveAlongPath) || targetMoved > TARGET_MOVE_REPATH
    if (!needsRepath) return
    if (Behaviour.nextRepathAt[eid] > 0) return

    const start = {
        x: Math.floor(Position.x[eid]),
        y: Math.floor(Position.y[eid]),
        z: Math.floor(Position.z[eid]),
    }
    const goal = {
        x: Math.floor(Position.x[target]),
        y: Math.floor(Position.y[target]),
        z: Math.floor(Position.z[target]),
    }
    const path = findPath(chunks, start, goal, {
        maxNodes: 1024,
        maxStepUp: 1,
        maxDrop: 2,
        surfaceSearchRange: 6,
    })

    if (path && path.length > 1) {
        world.pathByEid.set(eid, {
            points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
            index: 0,
            speed: CHASE_SPEED,
        })
        blackboard.pathGoal = { x: Position.x[target], y: Position.y[target], z: Position.z[target] }
        if (!hasComponent(world, eid, MoveAlongPath)) addComponent(world, eid, MoveAlongPath)
    }
    Behaviour.nextRepathAt[eid] = profile.repathCooldown
}

function handleAttack(world: GameWorld, eid: number, profile: BehaviourProfile, snapshot: BehaviourSnapshot): void {
    if (snapshot.targetEid === null) return
    faceTowards(eid, Position.x[snapshot.targetEid], Position.z[snapshot.targetEid])
    if (Behaviour.nextThinkAt[eid] > 0) return

    const result = applyDamagePacket(world, {
        source: eid,
        target: snapshot.targetEid,
        amount: profile.attackDamage,
        type: 'physical',
        targetPolicy: 'enemy',
    })
    Behaviour.nextThinkAt[eid] = profile.attackCooldown

    if (!result.applied) return
    if (result.killed) {
        pushGameLog(world, {
            type: 'combat',
            message: `${result.targetLabel} is killed by a hostile.`,
            eid: snapshot.targetEid,
        })
    } else {
        pushGameLog(world, {
            type: 'combat',
            message: `${result.targetLabel} takes ${profile.attackDamage} damage.`,
            eid: snapshot.targetEid,
        })
    }
}

function handleReturnHome(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    chunks: ChunkManager,
): void {
    if (hasComponent(world, eid, MoveAlongPath)) return
    if (Behaviour.nextRepathAt[eid] > 0) return

    const start = {
        x: Math.floor(Position.x[eid]),
        y: Math.floor(Position.y[eid]),
        z: Math.floor(Position.z[eid]),
    }
    const home = {
        x: Math.floor(blackboard.home.x),
        y: Math.floor(blackboard.home.y),
        z: Math.floor(blackboard.home.z),
    }
    const path = findPath(chunks, start, home, {
        maxNodes: 2048,
        maxStepUp: 1,
        maxDrop: 2,
        surfaceSearchRange: 8,
    })
    if (path && path.length > 1) {
        world.pathByEid.set(eid, {
            points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
            index: 0,
            speed: RETURN_SPEED,
        })
        blackboard.pathGoal = { ...home }
        addComponent(world, eid, MoveAlongPath)
    }
    Behaviour.nextRepathAt[eid] = 0.6
}

function clearPath(world: GameWorld, eid: number): void {
    if (hasComponent(world, eid, MoveAlongPath)) removeComponent(world, eid, MoveAlongPath)
    world.pathByEid.delete(eid)
    const blackboard = world.behaviourByEid.get(eid)
    if (blackboard) blackboard.pathGoal = null
    if (hasComponent(world, eid, Velocity)) {
        Velocity.x[eid] = 0
        Velocity.z[eid] = 0
    }
}

function faceTowards(eid: number, x: number, z: number): void {
    const dx = x - Position.x[eid]
    const dz = z - Position.z[eid]
    if (Math.abs(dx) + Math.abs(dz) < 1e-3) return
    Rotation.y[eid] = Math.atan2(dx, dz)
}

interface DynamicBlocker {
    eid: number
    x: number
    y: number
    z: number
    radius: number
}

function collectDynamicBlockers(world: GameWorld): DynamicBlocker[] {
    const eids = query(world, [Position, BoxCollider])
    const blockers: DynamicBlocker[] = []
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        if (
            !hasComponent(world, eid, PlayerControlled) &&
            !hasComponent(world, eid, Wanderer) &&
            !hasComponent(world, eid, Interactable) &&
            !hasComponent(world, eid, Sleeping)
        ) continue
        blockers.push({
            eid,
            x: Position.x[eid],
            y: Position.y[eid],
            z: Position.z[eid],
            radius: Math.max(BoxCollider.x[eid], BoxCollider.z[eid]),
        })
    }
    return blockers
}

function isDynamicallyBlocked(
    blockers: DynamicBlocker[],
    self: number,
    x: number,
    y: number,
    z: number,
): boolean {
    const cx = x + 0.5
    const cz = z + 0.5
    for (const blocker of blockers) {
        if (blocker.eid === self) continue
        if (Math.abs(blocker.y - y) > 1.2) continue
        const clearance = blocker.radius + 0.24
        const dx = blocker.x - cx
        const dz = blocker.z - cz
        if (dx * dx + dz * dz < clearance * clearance) return true
    }
    return false
}

function chooseWanderGoal(
    eid: number,
    home: { x: number; y: number; z: number },
    wanderRadius: number,
): { x: number; y: number; z: number } {
    const radius = Math.max(1, Math.floor(wanderRadius))
    const seed = nextSeed(eid)
    const dx = (seed % (radius * 2 + 1)) - radius
    const dz = (Math.floor(seed / 17) % (radius * 2 + 1)) - radius
    return {
        x: Math.floor(home.x + dx),
        y: Math.floor(home.y),
        z: Math.floor(home.z + dz),
    }
}

function nextSeed(eid: number): number {
    const n = Math.imul((performance.now() | 0) ^ (eid * 1103515245), 1664525) + 1013904223
    return Math.abs(n | 0)
}

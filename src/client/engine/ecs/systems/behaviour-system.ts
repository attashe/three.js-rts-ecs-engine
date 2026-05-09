import { Vector3 } from 'three'
import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { findPath, type PathOptions } from '../../voxel/voxel-path'
import {
    Attackable,
    Behaviour,
    BoxCollider,
    Health,
    Interactable,
    MoveAlongPath,
    MovementState,
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
    setBehaviourTarget,
    setBehaviourState,
    type ActorBlackboard,
    type BehaviourProfile,
    type BehaviourSnapshot,
} from '../behaviour'
import { applyDamagePacket } from '../damage'
import { MovementStateId } from '../movement-state'
import type { System } from './system'
import { FixedOrder } from './orders'
import { DEFAULT_PHYSICS_GRAVITY } from './physics-system'
import { pushGameLog, type GameWorld } from '../world'
import { spawnArrowProjectile } from '../../../game/moving-objects'

const WANDER_SPEED = 2.2
const TRAVEL_SPEED = 2.45
const CHASE_SPEED = 2.9
const FLEE_SPEED = 3.35
const RETURN_SPEED = 2.6
const TARGET_MOVE_REPATH = 1.5
const SLOT_MOVE_REPATH = 0.65
const ARROW_MUZZLE_HEIGHT = 1.08
const ARROW_MUZZLE_FORWARD = 0.55
const ARROW_TARGET_LEAD = 0.65
const MIN_ARROW_TRAVEL_TIME = 0.16
const MAX_ARROW_TRAVEL_TIME = 1.1
const MIN_ARROW_VERTICAL_SPEED = -2
const MAX_ARROW_VERTICAL_SPEED = 14

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
    if (blackboard.threatTime > 0) {
        blackboard.threatTime = Math.max(0, blackboard.threatTime - dt)
        if (blackboard.threatTime === 0) blackboard.threatEid = null
    }

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
        case BehaviourStateId.TravelToActivity: handleTravelToActivity(world, eid, blackboard, profile, chunks, blockers); break
        case BehaviourStateId.Chase: handleChase(world, eid, blackboard, profile, chunks, blockers, snapshot); break
        case BehaviourStateId.Reposition: handleReposition(world, eid, blackboard, profile, chunks, blockers, snapshot); break
        case BehaviourStateId.Attack: handleAttack(world, eid, profile, snapshot); break
        case BehaviourStateId.Recover: handleRecover(world, eid, snapshot); break
        case BehaviourStateId.Flee: handleFlee(world, eid, blackboard, profile, chunks, blockers, snapshot); break
        case BehaviourStateId.ReturnHome: handleReturnHome(world, eid, blackboard, chunks, blockers); break
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
    const perceivedTarget = getBehaviourTarget(eid)
    const targetEid = perceivedTarget ?? blackboard.threatEid
    const visible = targetEid !== null
        && hasComponent(world, targetEid, Position)
        && (!hasComponent(world, targetEid, Health) || Health.current[targetEid] > 0)
        && (perceivedTarget !== null || blackboard.threatTime > 0)

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
    const activity = blackboard.activity
    const dToActivity = activity
        ? Math.hypot(activity.x - px, activity.y - py, activity.z - pz)
        : 0

    const health = hasComponent(world, eid, Health) ? Health.current[eid] : 1

    return {
        state: Behaviour.state[eid] as BehaviourStateId,
        health,
        targetEid: visible ? targetEid : null,
        targetVisible: visible,
        distanceToTarget: dToTarget,
        distanceToHome: dToHome,
        distanceToActivity: dToActivity,
        hasActivity: activity !== null,
        stateTime: Behaviour.stateTime[eid],
        actionReady: Behaviour.nextThinkAt[eid] <= 0,
        movementBlocked: MovementState.value[eid] === MovementStateId.Blocked ||
            MovementState.value[eid] === MovementStateId.Repathing,
        hasPath: hasComponent(world, eid, MoveAlongPath),
    }
}

function onExitState(world: GameWorld, eid: number, state: BehaviourStateId): void {
    if (
        state === BehaviourStateId.Wander ||
        state === BehaviourStateId.TravelToActivity ||
        state === BehaviourStateId.Chase ||
        state === BehaviourStateId.Reposition ||
        state === BehaviourStateId.Flee ||
        state === BehaviourStateId.ReturnHome
    ) {
        clearPath(world, eid)
    }
}

function onEnterState(world: GameWorld, eid: number, state: BehaviourStateId, blackboard: ActorBlackboard): void {
    if (state === BehaviourStateId.Attack || state === BehaviourStateId.Recover || state === BehaviourStateId.Idle) {
        clearPath(world, eid)
    }
    if (
        state === BehaviourStateId.Chase ||
        state === BehaviourStateId.Reposition ||
        state === BehaviourStateId.Flee ||
        state === BehaviourStateId.Wander ||
        state === BehaviourStateId.TravelToActivity ||
        state === BehaviourStateId.ReturnHome
    ) {
        blackboard.pathGoal = null
    }
    if (state === BehaviourStateId.Dead) {
        clearPath(world, eid)
        if (hasComponent(world, eid, Velocity)) {
            Velocity.x[eid] = 0
            Velocity.y[eid] = 0
            Velocity.z[eid] = 0
        }
        if (hasComponent(world, eid, Attackable)) removeComponent(world, eid, Attackable)
        if (hasComponent(world, eid, Wanderer)) removeComponent(world, eid, Wanderer)
        if (hasComponent(world, eid, Interactable)) removeComponent(world, eid, Interactable)
        Rotation.x[eid] = Math.PI * 0.5
        Rotation.z[eid] = ((eid % 5) - 2) * 0.08
        const obj = world.object3DByEid.get(eid)
        if (obj) obj.name = `${obj.name || 'Actor'}Corpse`
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
    const center = blackboard.activity && Behaviour.state[eid] !== BehaviourStateId.ReturnHome
        ? blackboard.activity
        : blackboard.home
    const goal = chooseWanderGoal(eid, center, profile.wanderRadius)
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

function handleTravelToActivity(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    profile: BehaviourProfile,
    chunks: ChunkManager,
    blockers: DynamicBlocker[],
): void {
    if (!blackboard.activity) return
    const goal = voxelGoal(blackboard.activity)
    requestPathTo(
        world,
        eid,
        blackboard,
        chunks,
        blackboard.activity,
        TRAVEL_SPEED,
        profile.repathCooldown,
        {
            maxNodes: 2048,
            maxStepUp: 1,
            maxDrop: 2,
            surfaceSearchRange: 8,
            isBlocked: (x, y, z) => isDynamicallyBlocked(blockers, eid, x, y, z, goal),
        },
    )
}

function handleChase(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    profile: BehaviourProfile,
    chunks: ChunkManager,
    blockers: DynamicBlocker[],
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
        isBlocked: (x, y, z) => isDynamicallyBlocked(blockers, eid, x, y, z, goal, target),
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

function handleReposition(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    profile: BehaviourProfile,
    chunks: ChunkManager,
    blockers: DynamicBlocker[],
    snapshot: BehaviourSnapshot,
): void {
    if (snapshot.targetEid === null) return
    const target = snapshot.targetEid
    faceTowards(eid, Position.x[target], Position.z[target])

    const slot = chooseAttackSlot(eid, target, profile)
    const pathGoal = blackboard.pathGoal
    const slotMoved = pathGoal
        ? Math.hypot(slot.x - pathGoal.x, slot.z - pathGoal.z)
        : Infinity
    const needsRepath = !hasComponent(world, eid, MoveAlongPath) || slotMoved > SLOT_MOVE_REPATH
    if (!needsRepath) return
    if (Behaviour.nextRepathAt[eid] > 0) return

    const start = {
        x: Math.floor(Position.x[eid]),
        y: Math.floor(Position.y[eid]),
        z: Math.floor(Position.z[eid]),
    }
    const goal = voxelGoal(slot)
    const path = findPath(chunks, start, goal, {
        maxNodes: 1024,
        maxStepUp: 1,
        maxDrop: 2,
        surfaceSearchRange: 8,
        isBlocked: (x, y, z) => isDynamicallyBlocked(blockers, eid, x, y, z, goal, target),
    })

    if (path && path.length > 1) {
        world.pathByEid.set(eid, {
            points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
            index: 0,
            speed: CHASE_SPEED,
        })
        blackboard.pathGoal = { ...slot }
        addComponent(world, eid, MoveAlongPath)
    } else if (snapshot.distanceToTarget <= profile.attackRange) {
        setBehaviourState(world, eid, BehaviourStateId.Attack)
    }
    Behaviour.nextRepathAt[eid] = profile.repathCooldown
}

function handleAttack(world: GameWorld, eid: number, profile: BehaviourProfile, snapshot: BehaviourSnapshot): void {
    if (snapshot.targetEid === null) return
    const target = snapshot.targetEid
    faceTowards(eid, Position.x[target], Position.z[target])
    if (Behaviour.nextThinkAt[eid] > 0) {
        setBehaviourState(world, eid, BehaviourStateId.Recover)
        return
    }

    if (profile.attackKind === 'bow') {
        launchBowAttack(world, eid, target, profile)
        Behaviour.nextThinkAt[eid] = profile.attackCooldown
        setBehaviourState(world, eid, BehaviourStateId.Recover)
        return
    }

    const result = applyDamagePacket(world, {
        source: eid,
        target,
        amount: profile.attackDamage,
        type: 'physical',
        targetPolicy: 'enemy',
    })
    Behaviour.nextThinkAt[eid] = profile.attackCooldown

    if (!result.applied) return
    if (result.killed) {
        pushGameLog(world, {
            type: 'combat',
            message: `${result.targetLabel} is killed by ${profile.role === 'hunter' ? 'the hunter' : 'a hostile'}.`,
            eid: target,
        })
        if (profile.returnHomeAfterKill) {
            setBehaviourTarget(world, eid, null)
            setBehaviourState(world, eid, BehaviourStateId.ReturnHome)
            const blackboard = world.behaviourByEid.get(eid)
            if (blackboard) blackboard.pathGoal = null
            Behaviour.nextRepathAt[eid] = 0
        } else {
            setBehaviourState(world, eid, BehaviourStateId.Recover)
        }
    } else {
        pushGameLog(world, {
            type: 'combat',
            message: `${result.targetLabel} takes ${profile.attackDamage} damage.`,
            eid: target,
        })
        setBehaviourState(world, eid, BehaviourStateId.Recover)
    }
}

function launchBowAttack(world: GameWorld, eid: number, target: number, profile: BehaviourProfile): void {
    const speed = profile.projectileSpeed || 10
    const directDx = Position.x[target] - Position.x[eid]
    const directDz = Position.z[target] - Position.z[eid]
    const directDist = Math.hypot(directDx, directDz)
    if (directDist < 0.001) return

    const firstTravelTime = clamp(
        Math.max(0, directDist - ARROW_MUZZLE_FORWARD) / speed,
        MIN_ARROW_TRAVEL_TIME,
        MAX_ARROW_TRAVEL_TIME,
    )
    const leadTime = hasComponent(world, target, Velocity) ? firstTravelTime * ARROW_TARGET_LEAD : 0
    let aimX = Position.x[target] + (leadTime > 0 ? Velocity.x[target] * leadTime : 0)
    let aimZ = Position.z[target] + (leadTime > 0 ? Velocity.z[target] * leadTime : 0)
    let dx = aimX - Position.x[eid]
    let dz = aimZ - Position.z[eid]
    let dist = Math.hypot(dx, dz)
    if (dist < 0.001) return

    let dirX = dx / dist
    let dirZ = dz / dist
    let spawnX = Position.x[eid] + dirX * ARROW_MUZZLE_FORWARD
    let spawnZ = Position.z[eid] + dirZ * ARROW_MUZZLE_FORWARD

    let horizontalDist = Math.hypot(aimX - spawnX, aimZ - spawnZ)
    let travelTime = clamp(horizontalDist / speed, MIN_ARROW_TRAVEL_TIME, MAX_ARROW_TRAVEL_TIME)
    if (leadTime > 0) {
        aimX = Position.x[target] + Velocity.x[target] * travelTime * ARROW_TARGET_LEAD
        aimZ = Position.z[target] + Velocity.z[target] * travelTime * ARROW_TARGET_LEAD
        dx = aimX - Position.x[eid]
        dz = aimZ - Position.z[eid]
        dist = Math.hypot(dx, dz)
        if (dist < 0.001) return
        dirX = dx / dist
        dirZ = dz / dist
        spawnX = Position.x[eid] + dirX * ARROW_MUZZLE_FORWARD
        spawnZ = Position.z[eid] + dirZ * ARROW_MUZZLE_FORWARD
        horizontalDist = Math.hypot(aimX - spawnX, aimZ - spawnZ)
        travelTime = clamp(horizontalDist / speed, MIN_ARROW_TRAVEL_TIME, MAX_ARROW_TRAVEL_TIME)
    }

    const spawnY = Position.y[eid] + ARROW_MUZZLE_HEIGHT
    const targetHalfHeight = hasComponent(world, target, BoxCollider)
        ? BoxCollider.y[target]
        : 0.85
    const aimY = Position.y[target] + targetHalfHeight * 1.15
    const verticalSpeed = clamp(
        (aimY - spawnY + 0.5 * DEFAULT_PHYSICS_GRAVITY * travelTime * travelTime) / travelTime,
        Math.max(MIN_ARROW_VERTICAL_SPEED, profile.projectileLift),
        MAX_ARROW_VERTICAL_SPEED,
    )

    spawnArrowProjectile(
        world,
        {
            x: spawnX,
            y: spawnY,
            z: spawnZ,
        },
        {
            x: dirX * speed,
            y: verticalSpeed,
            z: dirZ * speed,
        },
        eid,
    )
    pushGameLog(world, {
        type: 'combat',
        message: 'An archer looses an arrow.',
        eid,
    })
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function handleRecover(world: GameWorld, eid: number, snapshot: BehaviourSnapshot): void {
    if (snapshot.targetEid !== null) faceTowards(eid, Position.x[snapshot.targetEid], Position.z[snapshot.targetEid])
    if (hasComponent(world, eid, Velocity)) {
        Velocity.x[eid] = 0
        Velocity.z[eid] = 0
    }
}

function handleFlee(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    profile: BehaviourProfile,
    chunks: ChunkManager,
    blockers: DynamicBlocker[],
    snapshot: BehaviourSnapshot,
): void {
    if (snapshot.targetEid === null) return
    if (hasComponent(world, eid, MoveAlongPath)) return
    if (Behaviour.nextRepathAt[eid] > 0) return

    const threat = snapshot.targetEid
    const dx = Position.x[eid] - Position.x[threat]
    const dz = Position.z[eid] - Position.z[threat]
    const len = Math.hypot(dx, dz)
    const awayX = len > 0.001 ? dx / len : 1
    const awayZ = len > 0.001 ? dz / len : 0
    const seed = nextSeed(eid)
    const lateral = ((seed % 1000) / 1000 - 0.5) * 1.6
    const goal = {
        x: Math.floor(Position.x[eid] + awayX * profile.fleeDistance - awayZ * lateral),
        y: Math.floor(Position.y[eid]),
        z: Math.floor(Position.z[eid] + awayZ * profile.fleeDistance + awayX * lateral),
    }

    const start = {
        x: Math.floor(Position.x[eid]),
        y: Math.floor(Position.y[eid]),
        z: Math.floor(Position.z[eid]),
    }
    const path = findPath(chunks, start, goal, {
        maxNodes: 1024,
        maxStepUp: 1,
        maxDrop: 2,
        surfaceSearchRange: 8,
        isBlocked: (x, y, z) => isDynamicallyBlocked(blockers, eid, x, y, z),
    })

    if (path && path.length > 1) {
        world.pathByEid.set(eid, {
            points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
            index: 0,
            speed: FLEE_SPEED,
        })
        blackboard.pathGoal = { ...goal }
        addComponent(world, eid, MoveAlongPath)
    } else if (hasComponent(world, eid, Velocity)) {
        Velocity.x[eid] = awayX * FLEE_SPEED
        Velocity.z[eid] = awayZ * FLEE_SPEED
    }
    Behaviour.nextRepathAt[eid] = profile.repathCooldown
}

function handleReturnHome(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
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
        isBlocked: (x, y, z) => isDynamicallyBlocked(blockers, eid, x, y, z, home),
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

function requestPathTo(
    world: GameWorld,
    eid: number,
    blackboard: ActorBlackboard,
    chunks: ChunkManager,
    target: { x: number; y: number; z: number },
    speed: number,
    repathCooldown: number,
    options: PathOptions,
): void {
    if (hasComponent(world, eid, MoveAlongPath)) return
    if (Behaviour.nextRepathAt[eid] > 0) return

    const start = {
        x: Math.floor(Position.x[eid]),
        y: Math.floor(Position.y[eid]),
        z: Math.floor(Position.z[eid]),
    }
    const goal = {
        x: Math.floor(target.x),
        y: Math.floor(target.y),
        z: Math.floor(target.z),
    }
    const path = findPath(chunks, start, goal, options)
    if (path && path.length > 1) {
        world.pathByEid.set(eid, {
            points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
            index: 0,
            speed,
        })
        blackboard.pathGoal = { ...goal }
        addComponent(world, eid, MoveAlongPath)
    }
    Behaviour.nextRepathAt[eid] = repathCooldown
}

function voxelGoal(target: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return {
        x: Math.floor(target.x),
        y: Math.floor(target.y),
        z: Math.floor(target.z),
    }
}

function chooseAttackSlot(
    eid: number,
    target: number,
    profile: BehaviourProfile,
): { x: number; y: number; z: number } {
    const radius = Math.max(0.75, profile.preferredRange || profile.attackRange * 0.9)
    const angle = attackSlotAngle(eid, target)
    return {
        x: Position.x[target] + Math.sin(angle) * radius,
        y: Position.y[target],
        z: Position.z[target] + Math.cos(angle) * radius,
    }
}

function attackSlotAngle(eid: number, target: number): number {
    const slots = 8
    const slot = Math.abs(Math.imul(eid + 1, 1103515245) ^ Math.imul(target + 7, 2654435761)) % slots
    return slot * Math.PI * 2 / slots
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
    allowedGoal?: { x: number; y: number; z: number },
    ignoredEid?: number,
): boolean {
    if (allowedGoal && x === allowedGoal.x && y === allowedGoal.y && z === allowedGoal.z) return false
    const cx = x + 0.5
    const cz = z + 0.5
    for (const blocker of blockers) {
        if (blocker.eid === self) continue
        if (blocker.eid === ignoredEid) continue
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

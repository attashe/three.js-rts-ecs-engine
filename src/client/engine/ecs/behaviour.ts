import { hasComponent, query } from 'bitecs'
import { Behaviour, Faction, Health, Position } from './components'
import { areEntitiesEnemies, FactionId } from './factions'
import type { GameWorld } from './world'

export const enum BehaviourStateId {
    Idle = 0,
    Wander = 1,
    Chase = 2,
    Attack = 3,
    ReturnHome = 4,
    Dead = 5,
    TravelToActivity = 6,
    Flee = 7,
    Reposition = 8,
    Recover = 9,
    Patrol = 10,
}

export const enum BehaviourProfileId {
    None = 0,
    NeutralMerchant = 1,
    NeutralWanderer = 2,
    HostileMeleeGrunt = 3,
    Hunter = 4,
    Rabbit = 5,
    Villager = 6,
    Guard = 7,
    HostileArcher = 8,
}

export type BehaviourRole = 'civilian' | 'merchant' | 'melee' | 'ranged' | 'hunter' | 'prey' | 'guard'
export type BehaviourAttackKind = 'none' | 'melee' | 'bow'

export interface BehaviourProfile {
    readonly id: BehaviourProfileId
    readonly key: string
    readonly role: BehaviourRole
    readonly faction: FactionId
    readonly initialState: BehaviourStateId
    /** Radius (m) inside which an enemy is considered visible. 0 = never sees. */
    readonly sightRadius: number
    /** Distance (m) the actor will keep its target before disengaging. */
    readonly leashRadius: number
    /** Wander destination radius around `home`. 0 = stays put. */
    readonly wanderRadius: number
    /** Desired distance from target for combat positioning. 0 = ignore. */
    readonly preferredRange: number
    /** Distance (m) from an assigned activity point considered "arrived". */
    readonly activityRadius: number
    /** Distance (m) at which the actor switches Chase → Attack. 0 = non-combatant. */
    readonly attackRange: number
    /** Seconds between consecutive attack action triggers. */
    readonly attackCooldown: number
    /** Damage applied per attack swing. */
    readonly attackDamage: number
    /** Attack executor used by BehaviourSystem. */
    readonly attackKind: BehaviourAttackKind
    /** Projectile launch speed for ranged profiles. */
    readonly projectileSpeed: number
    /** Upward launch velocity for arcing projectiles. */
    readonly projectileLift: number
    /** Flee goal distance from visible enemies. 0 = does not flee. */
    readonly fleeDistance: number
    /** Event-driven escape hatch for one-shot hunting behaviours. */
    readonly returnHomeAfterKill: boolean
    /** Seconds between path requests in Chase / Wander. */
    readonly repathCooldown: number
    /** Personal/social threat handling. Keeps faction matrix broad and lets
     *  profiles opt into local reactions such as guards defending villagers. */
    readonly social: BehaviourSocialProfile
}

export interface BehaviourSocialProfile {
    /** Damaged actors remember their attacker as a personal enemy/threat. */
    readonly hostileWhenDamaged: boolean
    /** Factions this actor will defend when one of their members is damaged. */
    readonly protectsFactions: readonly FactionId[]
    /** Radius around the damaged actor where this profile will respond. */
    readonly alertRadius: number
    /** Seconds a propagated threat remains visible through blackboard memory. */
    readonly threatMemorySeconds: number
}

export interface ActorBlackboard {
    state: BehaviourStateId
    previousState: BehaviourStateId
    targetEid: number | null
    targetLastSeenPosition: { x: number; y: number; z: number } | null
    threatEid: number | null
    threatTime: number
    pathGoal: { x: number; y: number; z: number } | null
    activity: { x: number; y: number; z: number } | null
    home: { x: number; y: number; z: number }
    stateTime: number
}

export const BEHAVIOUR_PROFILES: ReadonlyMap<BehaviourProfileId, BehaviourProfile> = new Map([
    [BehaviourProfileId.NeutralMerchant, {
        id: BehaviourProfileId.NeutralMerchant,
        key: 'neutral_merchant',
        role: 'merchant',
        faction: FactionId.Neutral,
        initialState: BehaviourStateId.Idle,
        sightRadius: 0,
        leashRadius: 0,
        wanderRadius: 0,
        preferredRange: 0,
        activityRadius: 0,
        attackRange: 0,
        attackCooldown: 0,
        attackDamage: 0,
        attackKind: 'none',
        projectileSpeed: 0,
        projectileLift: 0,
        fleeDistance: 0,
        returnHomeAfterKill: false,
        repathCooldown: 0,
        social: noSocial(),
    }],
    [BehaviourProfileId.NeutralWanderer, {
        id: BehaviourProfileId.NeutralWanderer,
        key: 'neutral_wanderer',
        role: 'civilian',
        faction: FactionId.Neutral,
        initialState: BehaviourStateId.Wander,
        sightRadius: 0,
        leashRadius: 0,
        wanderRadius: 7,
        preferredRange: 0,
        activityRadius: 0,
        attackRange: 0,
        attackCooldown: 0,
        attackDamage: 0,
        attackKind: 'none',
        projectileSpeed: 0,
        projectileLift: 0,
        fleeDistance: 0,
        returnHomeAfterKill: false,
        repathCooldown: 1.25,
        social: noSocial(),
    }],
    [BehaviourProfileId.HostileMeleeGrunt, {
        id: BehaviourProfileId.HostileMeleeGrunt,
        key: 'hostile_melee_grunt',
        role: 'melee',
        faction: FactionId.Hostile,
        initialState: BehaviourStateId.Idle,
        sightRadius: 8,
        leashRadius: 12,
        wanderRadius: 0,
        preferredRange: 1.15,
        activityRadius: 0,
        attackRange: 1.45,
        attackCooldown: 1.05,
        attackDamage: 8,
        attackKind: 'melee',
        projectileSpeed: 0,
        projectileLift: 0,
        fleeDistance: 0,
        returnHomeAfterKill: false,
        repathCooldown: 0.6,
        social: {
            hostileWhenDamaged: true,
            protectsFactions: [],
            alertRadius: 0,
            threatMemorySeconds: 6,
        },
    }],
    [BehaviourProfileId.Hunter, {
        id: BehaviourProfileId.Hunter,
        key: 'hunter',
        role: 'hunter',
        faction: FactionId.Hunter,
        initialState: BehaviourStateId.TravelToActivity,
        sightRadius: 9,
        leashRadius: 18,
        wanderRadius: 4,
        preferredRange: 1.05,
        activityRadius: 1.1,
        attackRange: 1.15,
        attackCooldown: 0.85,
        attackDamage: 12,
        attackKind: 'melee',
        projectileSpeed: 0,
        projectileLift: 0,
        fleeDistance: 0,
        returnHomeAfterKill: true,
        repathCooldown: 0.45,
        social: {
            hostileWhenDamaged: true,
            protectsFactions: [FactionId.Neutral],
            alertRadius: 18,
            threatMemorySeconds: 8,
        },
    }],
    [BehaviourProfileId.Villager, {
        id: BehaviourProfileId.Villager,
        key: 'villager',
        role: 'civilian',
        faction: FactionId.Neutral,
        initialState: BehaviourStateId.Wander,
        sightRadius: 6,
        leashRadius: 0,
        wanderRadius: 5,
        preferredRange: 0,
        activityRadius: 0,
        attackRange: 0,
        attackCooldown: 0,
        attackDamage: 0,
        attackKind: 'none',
        projectileSpeed: 0,
        projectileLift: 0,
        fleeDistance: 6,
        returnHomeAfterKill: false,
        repathCooldown: 0.75,
        social: {
            hostileWhenDamaged: true,
            protectsFactions: [],
            alertRadius: 0,
            threatMemorySeconds: 4,
        },
    }],
    [BehaviourProfileId.Guard, {
        id: BehaviourProfileId.Guard,
        key: 'village_guard',
        role: 'guard',
        faction: FactionId.Neutral,
        initialState: BehaviourStateId.Wander,
        sightRadius: 10,
        leashRadius: 14,
        wanderRadius: 4,
        preferredRange: 1.15,
        activityRadius: 0,
        attackRange: 1.35,
        attackCooldown: 0.95,
        attackDamage: 9,
        attackKind: 'melee',
        projectileSpeed: 0,
        projectileLift: 0,
        fleeDistance: 0,
        returnHomeAfterKill: false,
        repathCooldown: 0.55,
        social: {
            hostileWhenDamaged: true,
            protectsFactions: [FactionId.Neutral, FactionId.Hunter],
            alertRadius: 18,
            threatMemorySeconds: 8,
        },
    }],
    [BehaviourProfileId.Rabbit, {
        id: BehaviourProfileId.Rabbit,
        key: 'rabbit',
        role: 'prey',
        faction: FactionId.Wildlife,
        initialState: BehaviourStateId.Wander,
        sightRadius: 7,
        leashRadius: 0,
        wanderRadius: 4,
        preferredRange: 0,
        activityRadius: 0,
        attackRange: 0,
        attackCooldown: 0,
        attackDamage: 0,
        attackKind: 'none',
        projectileSpeed: 0,
        projectileLift: 0,
        fleeDistance: 5,
        returnHomeAfterKill: false,
        repathCooldown: 0.5,
        social: {
            hostileWhenDamaged: true,
            protectsFactions: [],
            alertRadius: 0,
            threatMemorySeconds: 4,
        },
    }],
    [BehaviourProfileId.HostileArcher, {
        id: BehaviourProfileId.HostileArcher,
        key: 'hostile_archer',
        role: 'ranged',
        faction: FactionId.Hostile,
        initialState: BehaviourStateId.Idle,
        sightRadius: 12,
        leashRadius: 16,
        wanderRadius: 0,
        preferredRange: 6,
        activityRadius: 0,
        attackRange: 8,
        attackCooldown: 1.45,
        attackDamage: 14,
        attackKind: 'bow',
        projectileSpeed: 11,
        projectileLift: 2.8,
        fleeDistance: 0,
        returnHomeAfterKill: false,
        repathCooldown: 0.7,
        social: {
            hostileWhenDamaged: true,
            protectsFactions: [],
            alertRadius: 0,
            threatMemorySeconds: 6,
        },
    }],
])

function noSocial(): BehaviourSocialProfile {
    return {
        hostileWhenDamaged: false,
        protectsFactions: [],
        alertRadius: 0,
        threatMemorySeconds: 0,
    }
}

export function behaviourStateName(state: number): string {
    switch (state) {
        case BehaviourStateId.Idle: return 'idle'
        case BehaviourStateId.Wander: return 'wander'
        case BehaviourStateId.Chase: return 'chase'
        case BehaviourStateId.Attack: return 'attack'
        case BehaviourStateId.ReturnHome: return 'return'
        case BehaviourStateId.Dead: return 'dead'
        case BehaviourStateId.TravelToActivity: return 'travel'
        case BehaviourStateId.Flee: return 'flee'
    case BehaviourStateId.Reposition: return 'reposition'
    case BehaviourStateId.Recover: return 'recover'
    case BehaviourStateId.Patrol: return 'patrol'
    default: return 'unknown'
    }
}

export interface AssignBehaviourOptions {
    activity?: { x: number; y: number; z: number } | null
}

export function getBehaviourProfile(id: number): BehaviourProfile | null {
    return BEHAVIOUR_PROFILES.get(id as BehaviourProfileId) ?? null
}

export function assignBehaviourProfile(
    world: GameWorld,
    eid: number,
    profileId: BehaviourProfileId,
    home: { x: number; y: number; z: number },
    opts: AssignBehaviourOptions = {},
): ActorBlackboard {
    const profile = BEHAVIOUR_PROFILES.get(profileId)
    if (!profile) throw new Error(`Unknown behaviour profile id: ${profileId}`)

    Behaviour.profileId[eid] = profile.id
    Behaviour.state[eid] = profile.initialState
    Behaviour.previousState[eid] = profile.initialState
    Behaviour.target[eid] = 0
    Behaviour.stateTime[eid] = 0
    Behaviour.nextThinkAt[eid] = 0
    Behaviour.nextRepathAt[eid] = 0
    Behaviour.blockedTime[eid] = 0

    const blackboard: ActorBlackboard = {
        state: profile.initialState,
        previousState: profile.initialState,
        targetEid: null,
        targetLastSeenPosition: null,
        threatEid: null,
        threatTime: 0,
        pathGoal: null,
        activity: opts.activity ? { ...opts.activity } : null,
        home: { ...home },
        stateTime: 0,
    }
    world.behaviourByEid.set(eid, blackboard)
    return blackboard
}

export function setBehaviourState(world: GameWorld, eid: number, state: BehaviourStateId): void {
    const previous = Behaviour.state[eid] as BehaviourStateId
    Behaviour.previousState[eid] = previous
    Behaviour.state[eid] = state
    Behaviour.stateTime[eid] = 0
    const blackboard = world.behaviourByEid.get(eid)
    if (blackboard) {
        blackboard.previousState = previous
        blackboard.state = state
        blackboard.stateTime = 0
    }
}

// Target id is stored as `eid + 1`; 0 is the "no target" sentinel. eid 0 is a
// real bitecs entity so we can't use it as a marker directly.
export function setBehaviourTarget(world: GameWorld, eid: number, target: number | null): void {
    Behaviour.target[eid] = target === null ? 0 : target + 1
    const blackboard = world.behaviourByEid.get(eid)
    if (blackboard) blackboard.targetEid = target
}

export function getBehaviourTarget(eid: number): number | null {
    const v = Behaviour.target[eid]
    return v === 0 ? null : v - 1
}

/**
 * Snapshot read by `decideTransition`. All distances are world-units, all
 * positions are foot-anchored, no ECS access — this is what makes the resolver
 * a pure function.
 */
export interface BehaviourSnapshot {
    state: BehaviourStateId
    health: number
    targetEid: number | null
    targetVisible: boolean
    distanceToTarget: number
    distanceToHome: number
    distanceToActivity: number
    hasActivity: boolean
    stateTime: number
    actionReady: boolean
    movementBlocked: boolean
    hasPath: boolean
}

/**
 * Pure transition resolver. Returns the *next* state, or `null` if the actor
 * should stay where it is. Priorities mirror §"Transition Priority" of the
 * design doc, trimmed to the states we actually implement.
 *
 *   1. Death: health ≤ 0 → Dead.
 *   2. Prey sees enemy → Flee.
 *   3. Recover waits until action cooldown clears.
 *   4. Visible enemy + inside leash + in attack range → Attack.
 *   5. Blocked combatant with target → Reposition.
 *   6. Visible enemy + inside leash → Chase.
 *   7. Visible enemy outside leash → ReturnHome.
 *   8. Combatant in combat states with no target → ReturnHome.
 *   9. TravelToActivity reaches activity → Wander or Idle.
 *   10. ReturnHome reached home → Wander or Idle (per profile).
 *   11. Idle non-combatant with wanderRadius → Wander.
 */
export function decideTransition(
    profile: BehaviourProfile,
    snapshot: BehaviourSnapshot,
): BehaviourStateId | null {
    if (snapshot.state === BehaviourStateId.Dead) return null
    if (snapshot.health <= 0) return BehaviourStateId.Dead

    const isCombatant = profile.attackRange > 0
    const hasVisibleTarget = snapshot.targetVisible && snapshot.targetEid !== null

    if (snapshot.state === BehaviourStateId.ReturnHome) {
        if (snapshot.distanceToHome < 0.6) {
            if (snapshot.hasActivity) return BehaviourStateId.Idle
            return profile.wanderRadius > 0 ? BehaviourStateId.Wander : BehaviourStateId.Idle
        }
        return null
    }

    if (snapshot.state === BehaviourStateId.Recover) {
        if (!hasVisibleTarget) return isCombatant ? BehaviourStateId.ReturnHome : null
        if (!snapshot.actionReady) return null
        if (snapshot.distanceToHome > profile.leashRadius) return BehaviourStateId.ReturnHome
        return snapshot.distanceToTarget <= profile.attackRange
            ? BehaviourStateId.Attack
            : BehaviourStateId.Chase
    }

    if (profile.fleeDistance > 0) {
        if (hasVisibleTarget) return BehaviourStateId.Flee
        if (snapshot.state === BehaviourStateId.Flee) {
            return profile.wanderRadius > 0 ? BehaviourStateId.Wander : BehaviourStateId.Idle
        }
    }

    if (isCombatant && hasVisibleTarget) {
        if (snapshot.distanceToHome > profile.leashRadius) {
            return BehaviourStateId.ReturnHome
        }
        if (snapshot.distanceToTarget <= profile.attackRange) {
            return BehaviourStateId.Attack
        }
        if (
            snapshot.movementBlocked &&
            (snapshot.state === BehaviourStateId.Chase || snapshot.state === BehaviourStateId.Reposition)
        ) {
            return BehaviourStateId.Reposition
        }
        return BehaviourStateId.Chase
    }

    if (
        isCombatant &&
        (
            snapshot.state === BehaviourStateId.Chase ||
            snapshot.state === BehaviourStateId.Attack ||
            snapshot.state === BehaviourStateId.Reposition
        )
    ) {
        return BehaviourStateId.ReturnHome
    }

    if (
        snapshot.state === BehaviourStateId.TravelToActivity &&
        (!snapshot.hasActivity || snapshot.distanceToActivity <= profile.activityRadius)
    ) {
        return profile.wanderRadius > 0 ? BehaviourStateId.Wander : BehaviourStateId.Idle
    }

    if (
        profile.wanderRadius > 0 &&
        snapshot.state === BehaviourStateId.Idle &&
        !snapshot.hasActivity
    ) {
        return BehaviourStateId.Wander
    }

    return null
}

/**
 * Linear search for the closest *visible* enemy within `sightRadius`. Lives in
 * this module so unit tests can exercise it without spinning up the renderer.
 * Visibility is purely radius-based for now — line of sight against voxels is
 * a later upgrade per §"Perception Model".
 */
export function findNearestEnemy(
    world: GameWorld,
    self: number,
    sightRadius: number,
    candidates: Iterable<number> = query(world, [Position, Faction, Health]),
): number | null {
    if (sightRadius <= 0) return null
    if (!hasComponent(world, self, Faction)) return null

    const sx = Position.x[self]
    const sy = Position.y[self]
    const sz = Position.z[self]
    const sightSq = sightRadius * sightRadius

    let bestEid = -1
    let bestDistSq = Infinity
    for (const eid of candidates) {
        if (eid === self) continue
        if (Health.current[eid] <= 0) continue
        if (!areEntitiesEnemies(world, self, eid)) continue

        const dx = Position.x[eid] - sx
        const dy = Position.y[eid] - sy
        const dz = Position.z[eid] - sz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > sightSq || d2 >= bestDistSq) continue

        bestEid = eid
        bestDistSq = d2
    }
    return bestEid >= 0 ? bestEid : null
}

import { hasComponent, query } from 'bitecs'
import { Behaviour, Faction, Health, Position } from './components'
import { areEnemies, FactionId } from './factions'
import type { GameWorld } from './world'

// Minimal first-pass state set. The doc lists more (Patrol, Alert, Investigate,
// Reposition, Recover, Flee, Talk, Stunned, Dormant) — they will land when a
// concrete demo needs them. Adding states later just means a new enum slot and
// a new branch in the resolver; nothing here pre-allocates space for them.
export const enum BehaviourStateId {
    Idle = 0,
    Wander = 1,
    Chase = 2,
    Attack = 3,
    ReturnHome = 4,
    Dead = 5,
}

export const enum BehaviourProfileId {
    None = 0,
    NeutralMerchant = 1,
    NeutralWanderer = 2,
    HostileMeleeGrunt = 3,
}

export type BehaviourRole = 'civilian' | 'merchant' | 'melee'

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
    /** Distance (m) at which the actor switches Chase → Attack. 0 = non-combatant. */
    readonly attackRange: number
    /** Seconds between consecutive attack action triggers. */
    readonly attackCooldown: number
    /** Damage applied per attack swing. */
    readonly attackDamage: number
    /** Seconds between path requests in Chase / Wander. */
    readonly repathCooldown: number
}

export interface ActorBlackboard {
    state: BehaviourStateId
    previousState: BehaviourStateId
    targetEid: number | null
    targetLastSeenPosition: { x: number; y: number; z: number } | null
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
        attackRange: 0,
        attackCooldown: 0,
        attackDamage: 0,
        repathCooldown: 0,
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
        attackRange: 0,
        attackCooldown: 0,
        attackDamage: 0,
        repathCooldown: 1.25,
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
        attackRange: 1.45,
        attackCooldown: 1.05,
        attackDamage: 8,
        repathCooldown: 0.6,
    }],
])

export function behaviourStateName(state: number): string {
    switch (state) {
        case BehaviourStateId.Idle: return 'idle'
        case BehaviourStateId.Wander: return 'wander'
        case BehaviourStateId.Chase: return 'chase'
        case BehaviourStateId.Attack: return 'attack'
        case BehaviourStateId.ReturnHome: return 'return'
        case BehaviourStateId.Dead: return 'dead'
        default: return 'unknown'
    }
}

export function getBehaviourProfile(id: number): BehaviourProfile | null {
    return BEHAVIOUR_PROFILES.get(id as BehaviourProfileId) ?? null
}

export function assignBehaviourProfile(
    world: GameWorld,
    eid: number,
    profileId: BehaviourProfileId,
    home: { x: number; y: number; z: number },
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
}

/**
 * Pure transition resolver. Returns the *next* state, or `null` if the actor
 * should stay where it is. Priorities mirror §"Transition Priority" of the
 * design doc, trimmed to the states we actually implement.
 *
 *   1. Death: health ≤ 0 → Dead.
 *   2. Visible enemy + inside leash + in attack range → Attack.
 *   3. Visible enemy + inside leash → Chase.
 *   4. Visible enemy outside leash → ReturnHome.
 *   5. Combatant in Chase/Attack with no target → ReturnHome.
 *   6. ReturnHome reached home → Wander or Idle (per profile).
 *   7. Idle non-combatant with wanderRadius → Wander.
 */
export function decideTransition(
    profile: BehaviourProfile,
    snapshot: BehaviourSnapshot,
): BehaviourStateId | null {
    if (snapshot.state === BehaviourStateId.Dead) return null
    if (snapshot.health <= 0) return BehaviourStateId.Dead

    const isCombatant = profile.attackRange > 0
    const hasVisibleTarget = snapshot.targetVisible && snapshot.targetEid !== null

    if (isCombatant && hasVisibleTarget) {
        if (snapshot.distanceToHome > profile.leashRadius) {
            return BehaviourStateId.ReturnHome
        }
        return snapshot.distanceToTarget <= profile.attackRange
            ? BehaviourStateId.Attack
            : BehaviourStateId.Chase
    }

    if (isCombatant && (snapshot.state === BehaviourStateId.Chase || snapshot.state === BehaviourStateId.Attack)) {
        return BehaviourStateId.ReturnHome
    }

    if (snapshot.state === BehaviourStateId.ReturnHome && snapshot.distanceToHome < 0.6) {
        return profile.wanderRadius > 0 ? BehaviourStateId.Wander : BehaviourStateId.Idle
    }

    if (profile.wanderRadius > 0 && snapshot.state === BehaviourStateId.Idle) {
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
export function findNearestEnemy(world: GameWorld, self: number, sightRadius: number): number | null {
    if (sightRadius <= 0) return null
    if (!hasComponent(world, self, Faction)) return null

    const myFaction = Faction.id[self]
    const sx = Position.x[self]
    const sy = Position.y[self]
    const sz = Position.z[self]
    const sightSq = sightRadius * sightRadius

    const candidates = query(world, [Position, Faction, Health])
    let bestEid = -1
    let bestDistSq = Infinity
    for (let i = 0; i < candidates.length; i++) {
        const eid = candidates[i]
        if (eid === self) continue
        if (Health.current[eid] <= 0) continue
        if (!areEnemies(myFaction, Faction.id[eid])) continue

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

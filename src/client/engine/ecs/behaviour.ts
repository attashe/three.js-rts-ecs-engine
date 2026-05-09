import { Behaviour } from './components'
import { FactionId } from './factions'
import type { GameWorld } from './world'

export const enum BehaviourStateId {
    Dormant = 0,
    Idle = 1,
    Wander = 2,
    Patrol = 3,
    Alert = 4,
    Investigate = 5,
    Chase = 6,
    Reposition = 7,
    Attack = 8,
    Recover = 9,
    Flee = 10,
    ReturnHome = 11,
    Talk = 12,
    Stunned = 13,
    Dead = 14,
}

export const enum BehaviourProfileId {
    None = 0,
    NeutralMerchant = 1,
    NeutralWanderer = 2,
    HostileMeleeGrunt = 3,
}

export type BehaviourRole =
    'civilian' |
    'merchant' |
    'guard' |
    'melee' |
    'ranged' |
    'caster' |
    'blocker' |
    'skirmisher'

export interface BehaviourProfile {
    readonly id: BehaviourProfileId
    readonly key: string
    readonly role: BehaviourRole
    readonly faction: FactionId
    readonly initialState: BehaviourStateId
    readonly sightRadius: number
    readonly hearingRadius: number
    readonly leashRadius: number
    readonly wanderRadius: number
    readonly preferredRange: number
    readonly attackRange: number
    readonly repathCooldown: number
    readonly stuckTimeout: number
    readonly actions: readonly string[]
}

export interface ActorBlackboard {
    state: BehaviourStateId
    previousState: BehaviourStateId
    targetEid?: number
    targetLastSeenAt?: number
    targetLastSeenPosition?: { x: number; y: number; z: number }
    home: { x: number; y: number; z: number }
    patrolIndex: number
    stateTime: number
    nextThinkAt: number
    nextRepathAt: number
    blockedTime: number
    alert: number
}

export const BEHAVIOUR_PROFILES: ReadonlyMap<BehaviourProfileId, BehaviourProfile> = new Map([
    [BehaviourProfileId.NeutralMerchant, {
        id: BehaviourProfileId.NeutralMerchant,
        key: 'neutral_merchant',
        role: 'merchant',
        faction: FactionId.Neutral,
        initialState: BehaviourStateId.Idle,
        sightRadius: 6,
        hearingRadius: 5,
        leashRadius: 4,
        wanderRadius: 0,
        preferredRange: 1.6,
        attackRange: 0,
        repathCooldown: 1.2,
        stuckTimeout: 0.8,
        actions: ['world.interact'],
    }],
    [BehaviourProfileId.NeutralWanderer, {
        id: BehaviourProfileId.NeutralWanderer,
        key: 'neutral_wanderer',
        role: 'civilian',
        faction: FactionId.Neutral,
        initialState: BehaviourStateId.Wander,
        sightRadius: 7,
        hearingRadius: 5,
        leashRadius: 10,
        wanderRadius: 7,
        preferredRange: 1.6,
        attackRange: 0,
        repathCooldown: 1.25,
        stuckTimeout: 0.8,
        actions: ['world.interact'],
    }],
    [BehaviourProfileId.HostileMeleeGrunt, {
        id: BehaviourProfileId.HostileMeleeGrunt,
        key: 'hostile_melee_grunt',
        role: 'melee',
        faction: FactionId.Hostile,
        initialState: BehaviourStateId.Idle,
        sightRadius: 8,
        hearingRadius: 5,
        leashRadius: 12,
        wanderRadius: 0,
        preferredRange: 1.15,
        attackRange: 1.35,
        repathCooldown: 0.8,
        stuckTimeout: 0.55,
        actions: ['move', 'attack.primary'],
    }],
])

export function behaviourStateName(state: number): string {
    switch (state) {
        case BehaviourStateId.Dormant: return 'dormant'
        case BehaviourStateId.Idle: return 'idle'
        case BehaviourStateId.Wander: return 'wander'
        case BehaviourStateId.Patrol: return 'patrol'
        case BehaviourStateId.Alert: return 'alert'
        case BehaviourStateId.Investigate: return 'investigate'
        case BehaviourStateId.Chase: return 'chase'
        case BehaviourStateId.Reposition: return 'reposition'
        case BehaviourStateId.Attack: return 'attack'
        case BehaviourStateId.Recover: return 'recover'
        case BehaviourStateId.Flee: return 'flee'
        case BehaviourStateId.ReturnHome: return 'return'
        case BehaviourStateId.Talk: return 'talk'
        case BehaviourStateId.Stunned: return 'stunned'
        case BehaviourStateId.Dead: return 'dead'
        default: return 'unknown'
    }
}

export function getBehaviourProfile(id: number): BehaviourProfile {
    const profile = BEHAVIOUR_PROFILES.get(id as BehaviourProfileId)
    if (!profile) throw new Error(`Unknown behaviour profile id: ${id}`)
    return profile
}

export function assignBehaviourProfile(
    world: GameWorld,
    eid: number,
    profileId: BehaviourProfileId,
    home: { x: number; y: number; z: number },
): ActorBlackboard {
    const profile = getBehaviourProfile(profileId)
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
        home: { ...home },
        patrolIndex: 0,
        stateTime: 0,
        nextThinkAt: 0,
        nextRepathAt: 0,
        blockedTime: 0,
        alert: 0,
    }
    world.behaviourByEid.set(eid, blackboard)
    return blackboard
}

export function setBehaviourState(world: GameWorld, eid: number, state: BehaviourStateId): void {
    const blackboard = world.behaviourByEid.get(eid)
    const previous = Behaviour.state[eid] as BehaviourStateId
    Behaviour.previousState[eid] = previous
    Behaviour.state[eid] = state
    Behaviour.stateTime[eid] = 0
    if (blackboard) {
        blackboard.previousState = previous
        blackboard.state = state
        blackboard.stateTime = 0
    }
}


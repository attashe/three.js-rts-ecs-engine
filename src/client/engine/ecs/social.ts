import { hasComponent, query, removeComponent } from 'bitecs'
import { Behaviour, Faction, Health, MoveAlongPath, Position } from './components'
import {
    BehaviourStateId,
    getBehaviourProfile,
    setBehaviourState,
    setBehaviourTarget,
    type BehaviourProfile,
} from './behaviour'
import { markEntityHostile, relationBetween, Relation } from './factions'
import type { GameWorld } from './world'

export interface DamageSocialEvent {
    source: number
    target: number
}

export function applyDamageSocialResponse(world: GameWorld, event: DamageSocialEvent): void {
    if (!hasComponent(world, event.source, Faction) || !hasComponent(world, event.target, Faction)) return
    if (!hasComponent(world, event.source, Position) || !hasComponent(world, event.target, Position)) return

    const targetProfile = hasComponent(world, event.target, Behaviour)
        ? getBehaviourProfile(Behaviour.profileId[event.target])
        : null
    if (targetProfile?.social.hostileWhenDamaged) {
        rememberPersonalThreat(world, event.target, event.source, targetProfile.social.threatMemorySeconds)
    }

    propagateProtectionAlert(world, event)
}

function propagateProtectionAlert(world: GameWorld, event: DamageSocialEvent): void {
    const targetFaction = Faction.id[event.target]
    const sourceFaction = Faction.id[event.source]
    const tx = Position.x[event.target]
    const ty = Position.y[event.target]
    const tz = Position.z[event.target]

    const responders = query(world, [Behaviour, Position, Faction, Health])
    for (let i = 0; i < responders.length; i++) {
        const responder = responders[i]
        if (responder === event.target || responder === event.source) continue
        if (Health.current[responder] <= 0) continue

        const profile = getBehaviourProfile(Behaviour.profileId[responder])
        if (!profile || !shouldProtect(profile, targetFaction, sourceFaction)) continue

        const dx = Position.x[responder] - tx
        const dy = Position.y[responder] - ty
        const dz = Position.z[responder] - tz
        const radius = profile.social.alertRadius
        if (radius <= 0 || dx * dx + dy * dy + dz * dz > radius * radius) continue

        rememberPersonalThreat(world, responder, event.source, profile.social.threatMemorySeconds)
        if (profile.attackRange > 0) forceCombatResponse(world, responder, event.source)
    }
}

function shouldProtect(profile: BehaviourProfile, targetFaction: number, sourceFaction: number): boolean {
    if (!profile.social.protectsFactions.includes(targetFaction)) return false
    return relationBetween(profile.faction, sourceFaction) !== Relation.Friend
}

function rememberPersonalThreat(world: GameWorld, subject: number, threat: number, seconds: number): void {
    markEntityHostile(world, subject, threat)
    const blackboard = world.behaviourByEid.get(subject)
    if (!blackboard) return

    blackboard.threatEid = threat
    blackboard.threatTime = Math.max(blackboard.threatTime, seconds)
    blackboard.targetLastSeenPosition = {
        x: Position.x[threat],
        y: Position.y[threat],
        z: Position.z[threat],
    }
    blackboard.pathGoal = null
}

function forceCombatResponse(world: GameWorld, responder: number, threat: number): void {
    setBehaviourTarget(world, responder, threat)
    world.pathByEid.delete(responder)
    if (hasComponent(world, responder, MoveAlongPath)) removeComponent(world, responder, MoveAlongPath)
    Behaviour.nextRepathAt[responder] = 0
    Behaviour.nextThinkAt[responder] = Math.min(Behaviour.nextThinkAt[responder], 0.2)
    setBehaviourState(world, responder, BehaviourStateId.Chase)
}

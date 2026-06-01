import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import { applyDamage } from '../combat'
import { PlayerControlled, Position, Rotation, Shield, Stunned, Velocity } from '../components'
import { pushDebugHitbox } from '../debug-hitboxes'
import { isActiveMeleeAttackLocked } from '../melee-combat'
import {
    meleeActorKey,
    meleeAttackActiveEndSeconds,
    meleeAttackLockSeconds,
    meleeAttackTotalSeconds,
    type ActiveMeleeAttack,
    type MeleeActorRef,
    type MeleeShape,
    type MeleeVec3,
} from '../melee-types'
import type { GameWorld } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'
import { damageNpc, type NpcRuntimeState } from '../../../game/npcs/npc-types'
import { NPC_TARGET_PLAYER } from '../../../game/npcs/npc-ai'

const COMMITTED_MOVEMENT_DAMPING = 32
const MIN_DEBUG_TTL = 0.06

interface ActorPose extends MeleeVec3 {
    yaw: number
}

interface MeleeTarget {
    key: string
    kind: 'player' | 'npc'
    eid?: number
    npc?: NpcRuntimeState
    x: number
    y: number
    z: number
}

interface ShapeHit {
    target: MeleeTarget
    distance: number
}

/** Where a combat cue happened, plus enough context for the caller to
 *  pick the right sound (light vs heavy by `attackId`) and position it. */
export interface MeleeAudioEvent {
    x: number
    y: number
    z: number
    /** Attack def id, e.g. `player-swing`, `hammer-slam`, `npc-slash`. */
    attackId: string
    attacker: 'player' | 'npc'
}

export interface MeleeHitAudioEvent extends MeleeAudioEvent {
    target: 'player' | 'npc'
}

export interface MeleeCombatSystemOptions {
    /** An attack entered its active window (the weapon is now swinging). */
    onSwing?: (event: MeleeAudioEvent) => void
    /** A hit landed and dealt damage. */
    onHit?: (event: MeleeHitAudioEvent) => void
    /** A raised shield caught a hit (no damage dealt). */
    onBlock?: (event: MeleeAudioEvent) => void
}

export function createMeleeCombatSystem(opts: MeleeCombatSystemOptions = {}): System {
    const obstacleBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const obstacleHalf = { x: 0, y: 0, z: 0 }

    return {
        fixed: true,
        order: FixedOrder.meleeCombat,
        update(world, dt) {
            const gw = world as GameWorld
            updatePlayerStunRuntime(gw, dt)
            for (const npc of gw.npcRuntimeById.values()) updateNpcImpactRuntime(gw, npc, dt)

            for (const [key, attack] of Array.from(gw.meleeAttacks.entries())) {
                const pose = currentActorPose(gw, attack.attacker)
                if (!pose) {
                    gw.meleeAttacks.delete(key)
                    continue
                }

                const previousElapsed = attack.elapsedSeconds
                attack.elapsedSeconds += dt
                maybeLockAttack(attack, pose)
                if (isActiveMeleeAttackLocked(attack)) applyAttackCommitment(gw, attack, dt)

                const activeStart = attack.def.startupSeconds
                const activeEnd = meleeAttackActiveEndSeconds(attack.def)
                // Whoosh exactly once, the tick the swing crosses into its
                // active window — not every active tick.
                if (opts.onSwing && previousElapsed < activeStart && attack.elapsedSeconds >= activeStart) {
                    opts.onSwing({
                        x: pose.x,
                        y: pose.y,
                        z: pose.z,
                        attackId: attack.def.id,
                        attacker: attack.attacker.kind,
                    })
                }
                if (attack.elapsedSeconds >= activeStart && previousElapsed < activeEnd) {
                    pushActiveDebugHitbox(gw, attack)
                    resolveActiveHits(gw, attack, opts)
                }

                if (attack.elapsedSeconds >= meleeAttackTotalSeconds(attack.def)) {
                    gw.meleeAttacks.delete(key)
                }
            }

            function updateNpcImpactRuntime(gw: GameWorld, npc: NpcRuntimeState, dt: number): void {
                if (npc.stunSeconds !== undefined) {
                    npc.stunSeconds = Math.max(0, npc.stunSeconds - dt)
                    if (npc.stunSeconds <= 0) npc.stunSeconds = undefined
                }
                const push = npc.push
                if (!push) return
                const step = Math.min(dt, push.seconds)
                if (step > 0) {
                    npc.position.x += push.vx * step
                    npc.position.z += push.vz * step
                    updateNpcObstacle(gw, npc)
                }
                push.seconds -= dt
                if (push.seconds <= 0) npc.push = undefined
            }

            function updateNpcObstacle(gw: GameWorld, npc: NpcRuntimeState): void {
                if (npc.obstacleId === null) return
                obstacleHalf.x = npc.colliderRadius
                obstacleHalf.y = npc.colliderHeight / 2
                obstacleHalf.z = npc.colliderRadius
                aabbFromFoot(npc.position, obstacleHalf, obstacleBox)
                gw.obstacles.add(npc.obstacleId, obstacleBox)
            }
        },
    }
}

function maybeLockAttack(attack: ActiveMeleeAttack, pose: ActorPose): void {
    if (attack.lockedYaw !== null) return
    if (attack.elapsedSeconds < meleeAttackLockSeconds(attack.def)) return
    attack.lockedYaw = pose.yaw
    attack.lockedOrigin = { x: pose.x, y: pose.y, z: pose.z }
}

function applyAttackCommitment(gw: GameWorld, attack: ActiveMeleeAttack, dt: number): void {
    if (attack.lockedYaw === null) return
    if (attack.attacker.kind === 'player') {
        const eid = attack.attacker.eid
        if (hasComponent(gw, eid, Rotation)) Rotation.y[eid] = attack.lockedYaw
        if (hasComponent(gw, eid, Velocity)) {
            const damp = Math.exp(-COMMITTED_MOVEMENT_DAMPING * dt)
            Velocity.x[eid] *= damp
            Velocity.z[eid] *= damp
        }
        return
    }
    const npc = gw.npcRuntimeById.get(attack.attacker.id)
    if (npc) npc.yaw = attack.lockedYaw
}

function resolveActiveHits(gw: GameWorld, attack: ActiveMeleeAttack, opts: MeleeCombatSystemOptions): void {
    if (attack.lockedYaw === null || !attack.lockedOrigin) return
    const hits = candidatesForAttack(gw, attack)
        .map((target): ShapeHit | null => {
            const distance = distanceInsideShape(attack, target)
            return distance === null ? null : { target, distance }
        })
        .filter((hit): hit is ShapeHit => hit !== null && !attack.hitTargets.has(hit.target.key))

    if (hits.length === 0) return
    if (attack.def.targetMode === 'nearest') {
        if (attack.hitTargets.size > 0) return
        let nearest = hits[0]!
        for (let i = 1; i < hits.length; i++) {
            if (hits[i]!.distance < nearest.distance) nearest = hits[i]!
        }
        applyMeleeHit(gw, attack, nearest.target, opts)
        return
    }

    if (attack.def.targetMode === 'target') {
        applyMeleeHit(gw, attack, hits[0]!.target, opts)
        return
    }

    for (const hit of hits) applyMeleeHit(gw, attack, hit.target, opts)
}

function applyMeleeHit(gw: GameWorld, attack: ActiveMeleeAttack, target: MeleeTarget, opts: MeleeCombatSystemOptions): void {
    attack.hitTargets.add(target.key)
    if (target.kind === 'player') {
        const eid = target.eid!
        if (blockedByShield(gw, eid, attack)) {
            opts.onBlock?.({
                x: target.x,
                y: target.y,
                z: target.z,
                attackId: attack.def.id,
                attacker: attack.attacker.kind,
            })
            return
        }
        applyDamage(gw, eid, attack.def.damage)
        applyTargetPush(gw, { kind: 'player', eid }, attack, target)
        applyTargetStun(gw, { kind: 'player', eid }, attack)
    } else {
        const npc = target.npc!
        damageNpc(npc, attack.def.damage)
        applyTargetPush(gw, { kind: 'npc', id: npc.id }, attack, target)
        applyTargetStun(gw, { kind: 'npc', id: npc.id }, attack)
    }
    opts.onHit?.({
        x: target.x,
        y: target.y,
        z: target.z,
        attackId: attack.def.id,
        attacker: attack.attacker.kind,
        target: target.kind,
    })
    applyRecoil(gw, attack)
}

function applyTargetPush(gw: GameWorld, actor: MeleeActorRef, attack: ActiveMeleeAttack, target: MeleeTarget): void {
    const speed = attack.def.targetPushSpeed
    const seconds = attack.def.targetPushSeconds
    if (!(speed > 0) || !(seconds > 0)) return
    const dir = directionFromHitSource(attack, target)
    applyActorPush(gw, actor, dir.x, dir.z, speed, seconds)
}

function applyTargetStun(gw: GameWorld, actor: MeleeActorRef, attack: ActiveMeleeAttack): void {
    const seconds = attack.def.stunSeconds
    if (!(seconds > 0)) return
    if (actor.kind === 'player') {
        addComponent(gw, actor.eid, Stunned)
        Stunned.seconds[actor.eid] = Math.max(Stunned.seconds[actor.eid] ?? 0, seconds)
        return
    }
    const npc = gw.npcRuntimeById.get(actor.id)
    if (npc && !npc.dying) npc.stunSeconds = Math.max(npc.stunSeconds ?? 0, seconds)
}

function updatePlayerStunRuntime(gw: GameWorld, dt: number): void {
    for (const eid of query(gw, [Stunned])) {
        Stunned.seconds[eid] = Math.max(0, Stunned.seconds[eid]! - dt)
        if (Stunned.seconds[eid]! <= 0) removeComponent(gw, eid, Stunned)
    }
}

function applyRecoil(gw: GameWorld, attack: ActiveMeleeAttack): void {
    if (attack.recoilApplied) return
    const speed = attack.def.recoilSpeed
    const seconds = attack.def.recoilSeconds
    if (!(speed > 0) || !(seconds > 0) || attack.lockedYaw === null) return
    attack.recoilApplied = true
    applyActorPush(gw, attack.attacker, -Math.sin(attack.lockedYaw), -Math.cos(attack.lockedYaw), speed, seconds)
}

function applyActorPush(
    gw: GameWorld,
    actor: MeleeActorRef,
    dirX: number,
    dirZ: number,
    speed: number,
    seconds: number,
): void {
    if (actor.kind === 'player') {
        const eid = actor.eid
        if (!hasComponent(gw, eid, Velocity)) return
        Velocity.x[eid] += dirX * speed
        Velocity.z[eid] += dirZ * speed
        return
    }
    const npc = gw.npcRuntimeById.get(actor.id)
    if (!npc || npc.dying) return
    npc.push = {
        vx: dirX * speed,
        vz: dirZ * speed,
        seconds,
    }
}

function candidatesForAttack(gw: GameWorld, attack: ActiveMeleeAttack): MeleeTarget[] {
    if (attack.attacker.kind === 'player') {
        const out: MeleeTarget[] = []
        for (const npc of gw.npcRuntimeById.values()) {
            if (npc.dying) continue
            out.push({
                key: `npc:${npc.id}`,
                kind: 'npc',
                npc,
                x: npc.position.x,
                y: npc.position.y,
                z: npc.position.z,
            })
        }
        return out
    }

    if (attack.def.targetMode === 'target') return targetCandidate(gw, attack.targetId)

    const out: MeleeTarget[] = []
    out.push(...playerTargets(gw))
    for (const npc of gw.npcRuntimeById.values()) {
        if (npc.id === attack.attacker.id || npc.dying) continue
        out.push({
            key: `npc:${npc.id}`,
            kind: 'npc',
            npc,
            x: npc.position.x,
            y: npc.position.y,
            z: npc.position.z,
        })
    }
    return out
}

function targetCandidate(gw: GameWorld, targetId: string | undefined): MeleeTarget[] {
    if (!targetId) return []
    if (targetId === NPC_TARGET_PLAYER) return playerTargets(gw)
    const npc = gw.npcRuntimeById.get(targetId)
    if (!npc || npc.dying) return []
    return [{
        key: `npc:${npc.id}`,
        kind: 'npc',
        npc,
        x: npc.position.x,
        y: npc.position.y,
        z: npc.position.z,
    }]
}

function playerTargets(gw: GameWorld): MeleeTarget[] {
    const out: MeleeTarget[] = []
    for (const eid of query(gw, [PlayerControlled, Position])) {
        out.push({
            key: `player:${eid}`,
            kind: 'player',
            eid,
            x: Position.x[eid]!,
            y: Position.y[eid]!,
            z: Position.z[eid]!,
        })
    }
    return out
}

function distanceInsideShape(attack: ActiveMeleeAttack, target: MeleeTarget): number | null {
    const origin = attack.lockedOrigin
    const yaw = attack.lockedYaw
    if (!origin || yaw === null) return null
    const shape = attack.def.shape
    if (shape.kind === 'circle') return distanceInsideCircle(origin, yaw, shape, target)
    return distanceInsideWedge(origin, yaw, shape, target)
}

function distanceInsideWedge(origin: MeleeVec3, yaw: number, shape: Extract<MeleeShape, { kind: 'wedge' }>, target: MeleeTarget): number | null {
    const dy = target.y - origin.y
    if (dy < shape.minY || dy > shape.maxY) return null
    const dx = target.x - origin.x
    const dz = target.z - origin.z
    const dist = Math.hypot(dx, dz)
    if (dist > shape.range || dist < 1e-3) return null
    const dot = (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / dist
    if (dot < Math.cos(shape.arcRadians * 0.5)) return null
    return dist
}

function distanceInsideCircle(origin: MeleeVec3, yaw: number, shape: Extract<MeleeShape, { kind: 'circle' }>, target: MeleeTarget): number | null {
    const center = circleCenter(origin, yaw, shape)
    const dy = target.y - center.y
    if (dy < shape.minY || dy > shape.maxY) return null
    const dx = target.x - center.x
    const dz = target.z - center.z
    const d2 = dx * dx + dz * dz
    return d2 <= shape.radius * shape.radius ? Math.sqrt(d2) : null
}

function blockedByShield(gw: GameWorld, playerEid: number, attack: ActiveMeleeAttack): boolean {
    if (!hasComponent(gw, playerEid, Shield) || Shield.raised[playerEid] !== 1) return false
    const source = hitSourcePoint(attack)
    if (!source) return false
    const blockYaw = Rotation.y[playerEid]! + Shield.blockYawOffset[playerEid]!
    const fx = Math.sin(blockYaw)
    const fz = Math.cos(blockYaw)
    const ax = source.x - Position.x[playerEid]!
    const az = source.z - Position.z[playerEid]!
    const ad = Math.hypot(ax, az)
    if (ad < 1e-3) return false
    if ((fx * ax + fz * az) / ad < Shield.blockArcCos[playerEid]!) return false
    const dy = source.y - Position.y[playerEid]!
    return dy >= Shield.minY[playerEid]! && dy <= Shield.maxY[playerEid]!
}

function directionFromHitSource(attack: ActiveMeleeAttack, target: MeleeTarget): { x: number; z: number } {
    const source = hitSourcePoint(attack)
    const yaw = attack.lockedYaw ?? 0
    if (!source) return { x: Math.sin(yaw), z: Math.cos(yaw) }
    const dx = target.x - source.x
    const dz = target.z - source.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-3) return { x: Math.sin(yaw), z: Math.cos(yaw) }
    return { x: dx / dist, z: dz / dist }
}

function hitSourcePoint(attack: ActiveMeleeAttack): MeleeVec3 | null {
    const origin = attack.lockedOrigin
    const yaw = attack.lockedYaw
    if (!origin || yaw === null) return null
    const shape = attack.def.shape
    if (shape.kind === 'circle') return circleCenter(origin, yaw, shape)
    return origin
}

function circleCenter(origin: MeleeVec3, yaw: number, shape: Extract<MeleeShape, { kind: 'circle' }>): MeleeVec3 {
    return {
        x: origin.x + Math.sin(yaw) * shape.centerForwardOffset,
        y: origin.y,
        z: origin.z + Math.cos(yaw) * shape.centerForwardOffset,
    }
}

function pushActiveDebugHitbox(gw: GameWorld, attack: ActiveMeleeAttack): void {
    const origin = attack.lockedOrigin
    const yaw = attack.lockedYaw
    if (!origin || yaw === null) return
    const ttl = Math.max(MIN_DEBUG_TTL, meleeAttackActiveEndSeconds(attack.def) - attack.elapsedSeconds)
    const id = `${meleeActorKey(attack.attacker)}:attack`
    const shape = attack.def.shape
    if (shape.kind === 'circle') {
        pushDebugHitbox(gw, {
            id,
            kind: 'circle',
            ttl,
            color: attack.def.debugColor,
            center: circleCenter(origin, yaw, shape),
            radius: shape.radius,
        })
        return
    }
    pushDebugHitbox(gw, {
        id,
        kind: 'wedge',
        ttl,
        color: attack.def.debugColor,
        origin,
        yaw,
        range: shape.range,
        arcRadians: shape.arcRadians,
        minY: shape.minY,
        maxY: shape.maxY,
    })
}

function currentActorPose(gw: GameWorld, actor: MeleeActorRef): ActorPose | null {
    if (actor.kind === 'player') {
        const eid = actor.eid
        if (!hasComponent(gw, eid, Position) || !hasComponent(gw, eid, Rotation)) return null
        return {
            x: Position.x[eid]!,
            y: Position.y[eid]!,
            z: Position.z[eid]!,
            yaw: Rotation.y[eid]!,
        }
    }
    const npc = gw.npcRuntimeById.get(actor.id)
    if (!npc || npc.dying) return null
    return {
        x: npc.position.x,
        y: npc.position.y,
        z: npc.position.z,
        yaw: npc.yaw,
    }
}

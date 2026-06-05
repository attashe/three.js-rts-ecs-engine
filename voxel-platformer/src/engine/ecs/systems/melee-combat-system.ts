import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { BLOCK } from '../../voxel/palette'
import { applyDamage } from '../combat'
import { BoxCollider, PlayerControlled, Position, Rotation, Shield, Stunned, Velocity } from '../components'
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
import { metalHelmetBlocksIncomingAttack } from '../../../game/equipment-effects'
import { setTemporaryVoxel } from '../../../game/temporary-voxel-edits'

const COMMITTED_MOVEMENT_DAMPING = 32
const MIN_DEBUG_TTL = 0.06
const NPC_SHIELD_DEBUG_TTL = 0.09
const NPC_SHIELD_DEBUG_RANGE_EXTRA = 1.2
const NPC_SHIELD_PERFECT_BLOCK_COOLDOWN_SECONDS = 1.1
const ORDINARY_BLOCK_DEFENDER_PUSH_SPEED = 1.4
const ORDINARY_BLOCK_DEFENDER_PUSH_SECONDS = 0.10
const ORDINARY_BLOCK_STUN_SECONDS = 0.18
const ORDINARY_HAMMER_BLOCK_STUN_SECONDS = 1.1
const PERFECT_BLOCK_DEFENDER_PUSH_SPEED = 0.5
const PERFECT_BLOCK_DEFENDER_PUSH_SECONDS = 0.06
const PERFECT_BLOCK_ATTACKER_PUSH_SPEED = 2.2
const PERFECT_BLOCK_ATTACKER_PUSH_SECONDS = 0.12
const PERFECT_BLOCK_ATTACKER_STUN_SECONDS = 0.45
const ORDINARY_BLOCK_RELOAD_SECONDS = 0.55

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
    radius: number
    minY: number
    maxY: number
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

export type MeleeBlockKind = 'ordinary' | 'perfect'
export type MeleeStunReason = 'attack' | 'ordinary-block' | 'perfect-block'

export interface MeleeBlockAudioEvent extends MeleeAudioEvent {
    blockKind: MeleeBlockKind
}

export interface MeleeStunAudioEvent extends MeleeAudioEvent {
    target: 'player' | 'npc'
    reason: MeleeStunReason
}

export interface MeleeCombatSystemOptions {
    /** An attack entered its active window (the weapon is now swinging). */
    onSwing?: (event: MeleeAudioEvent) => void
    /** A hit landed and dealt damage. */
    onHit?: (event: MeleeHitAudioEvent) => void
    /** A raised shield caught a hit (no damage dealt). */
    onBlock?: (event: MeleeBlockAudioEvent) => void
    /** A hit/block response applied stun or stagger. */
    onStun?: (event: MeleeStunAudioEvent) => void
    /** Test hook for chance-based equipment effects. Defaults to Math.random. */
    helmetBlockRoll?: () => number
    /** Optional voxel world for attack-reactive destructible clutter. */
    chunks?: ChunkManager
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
            for (const npc of gw.npcRuntimeById.values()) {
                updateNpcImpactRuntime(gw, npc, dt)
                pushNpcShieldGuardDebugHitbox(gw, npc)
            }

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
                    destroySpiderWebsInAttack(gw, attack, opts.chunks)
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

function destroySpiderWebsInAttack(gw: GameWorld, attack: ActiveMeleeAttack, chunks: ChunkManager | undefined): void {
    if (!chunks || attack.attacker.kind !== 'player') return
    const origin = attack.lockedOrigin
    const yaw = attack.lockedYaw
    if (!origin || yaw === null) return
    const shape = attack.def.shape
    const reach = shape.kind === 'circle'
        ? shape.radius + Math.abs(shape.centerForwardOffset) + 1
        : shape.range + 1
    const minX = Math.floor(origin.x - reach)
    const maxX = Math.ceil(origin.x + reach)
    const minZ = Math.floor(origin.z - reach)
    const maxZ = Math.ceil(origin.z + reach)
    const minY = Math.floor(origin.y + shape.minY)
    const maxY = Math.ceil(origin.y + shape.maxY)
    for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
            for (let x = minX; x <= maxX; x += 1) {
                if (chunks.getVoxel(x, y, z) !== BLOCK.spiderWeb) continue
                if (!webCellInsideShape(origin, yaw, shape, x, y, z)) continue
                setTemporaryVoxel(gw, chunks, x, y, z, BLOCK.air)
            }
        }
    }
}

function webCellInsideShape(origin: MeleeVec3, yaw: number, shape: MeleeShape, x: number, y: number, z: number): boolean {
    const target: MeleeTarget = {
        key: 'web',
        kind: 'npc',
        x: x + 0.5,
        y: y + 0.5,
        z: z + 0.5,
        radius: 0.65,
        minY: y,
        maxY: y + 1,
    }
    return shape.kind === 'circle'
        ? distanceInsideCircle(origin, yaw, shape, target) !== null
        : distanceInsideWedge(origin, yaw, shape, target) !== null
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
        const block = shieldBlockResult(gw, eid, attack)
        if (block) {
            applyShieldBlockResponse(gw, attack, target, block.kind, opts)
            opts.onBlock?.({
                x: target.x,
                y: target.y,
                z: target.z,
                attackId: attack.def.id,
                attacker: attack.attacker.kind,
                blockKind: block.kind,
            })
            return
        }
        const helmetBlocked = metalHelmetBlocksIncomingAttack(gw.playerSettings, opts.helmetBlockRoll)
        if (!helmetBlocked) applyDamage(gw, eid, attack.def.damage)
        applyTargetPush(gw, { kind: 'player', eid }, attack, target)
        applyTargetStun(gw, { kind: 'player', eid }, attack, target, opts, 'attack')
        if (helmetBlocked) return
    } else {
        const npc = target.npc!
        const block = npcShieldGuardBlockResult(npc, attack)
        if (block) {
            opts.onBlock?.({
                x: target.x,
                y: target.y,
                z: target.z,
                attackId: attack.def.id,
                attacker: attack.attacker.kind,
                blockKind: block.kind,
            })
            return
        }
        damageNpc(npc, attack.def.damage, { byPlayer: attack.attacker.kind === 'player' })
        applyTargetPush(gw, { kind: 'npc', id: npc.id }, attack, target)
        applyTargetStun(gw, { kind: 'npc', id: npc.id }, attack, target, opts, 'attack')
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

function applyTargetStun(
    gw: GameWorld,
    actor: MeleeActorRef,
    attack: ActiveMeleeAttack,
    target: MeleeTarget,
    opts: MeleeCombatSystemOptions,
    reason: MeleeStunReason,
): void {
    const seconds = attack.def.stunSeconds
    if (!(seconds > 0)) return
    if (!applyActorStun(gw, actor, seconds)) return
    opts.onStun?.({
        x: target.x,
        y: target.y,
        z: target.z,
        attackId: attack.def.id,
        attacker: attack.attacker.kind,
        target: target.kind,
        reason,
    })
}

function applyShieldBlockResponse(
    gw: GameWorld,
    attack: ActiveMeleeAttack,
    target: MeleeTarget,
    blockKind: MeleeBlockKind,
    opts: MeleeCombatSystemOptions,
): void {
    const eid = target.eid!
    const defender: MeleeActorRef = { kind: 'player', eid }
    const defenderDir = directionFromHitSource(attack, target)
    if (blockKind === 'perfect') {
        applyActorPush(
            gw,
            defender,
            defenderDir.x,
            defenderDir.z,
            PERFECT_BLOCK_DEFENDER_PUSH_SPEED,
            PERFECT_BLOCK_DEFENDER_PUSH_SECONDS,
        )
        const attackerDir = directionAwayFromPoint(gw, attack.attacker, target)
        applyActorPush(
            gw,
            attack.attacker,
            attackerDir.x,
            attackerDir.z,
            PERFECT_BLOCK_ATTACKER_PUSH_SPEED,
            PERFECT_BLOCK_ATTACKER_PUSH_SECONDS,
        )
        if (applyActorStun(gw, attack.attacker, PERFECT_BLOCK_ATTACKER_STUN_SECONDS)) {
            opts.onStun?.({
                x: target.x,
                y: target.y,
                z: target.z,
                attackId: attack.def.id,
                attacker: attack.attacker.kind,
                target: attack.attacker.kind,
                reason: 'perfect-block',
            })
        }
        triggerNpcShieldCooldown(gw, attack.attacker)
        Shield.perfect[eid] = 0
        return
    }
    applyActorPush(
        gw,
        defender,
        defenderDir.x,
        defenderDir.z,
        ORDINARY_BLOCK_DEFENDER_PUSH_SPEED,
        ORDINARY_BLOCK_DEFENDER_PUSH_SECONDS,
    )
    const defenderStunSeconds = attack.def.id === 'hammer-slam'
        ? ORDINARY_HAMMER_BLOCK_STUN_SECONDS
        : ORDINARY_BLOCK_STUN_SECONDS
    if (applyActorStun(gw, defender, defenderStunSeconds)) {
        opts.onStun?.({
            x: target.x,
            y: target.y,
            z: target.z,
            attackId: attack.def.id,
            attacker: attack.attacker.kind,
            target: target.kind,
            reason: 'ordinary-block',
        })
    }
    Shield.reloadSeconds[eid] = ORDINARY_BLOCK_RELOAD_SECONDS
    Shield.raised[eid] = 0
    Shield.perfect[eid] = 0
}

function applyActorStun(gw: GameWorld, actor: MeleeActorRef, seconds: number): boolean {
    if (!(seconds > 0)) return false
    if (actor.kind === 'player') {
        addComponent(gw, actor.eid, Stunned)
        Stunned.seconds[actor.eid] = Math.max(Stunned.seconds[actor.eid] ?? 0, seconds)
        return true
    }
    const npc = gw.npcRuntimeById.get(actor.id)
    if (!npc || npc.dying) return false
    npc.stunSeconds = Math.max(npc.stunSeconds ?? 0, seconds)
    return true
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

function directionAwayFromPoint(gw: GameWorld, actor: MeleeActorRef, point: MeleeVec3): { x: number; z: number } {
    const pose = currentActorPose(gw, actor)
    if (!pose) return { x: 0, z: 1 }
    const dx = pose.x - point.x
    const dz = pose.z - point.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-3) return { x: Math.sin(pose.yaw), z: Math.cos(pose.yaw) }
    return { x: dx / dist, z: dz / dist }
}

function candidatesForAttack(gw: GameWorld, attack: ActiveMeleeAttack): MeleeTarget[] {
    if (attack.attacker.kind === 'player') {
        const out: MeleeTarget[] = []
        for (const npc of gw.npcRuntimeById.values()) {
            if (npc.dying) continue
            out.push(npcTarget(npc))
        }
        return out
    }

    if (attack.def.targetMode === 'target') return targetCandidate(gw, attack.targetId)

    const out: MeleeTarget[] = []
    out.push(...playerTargets(gw))
    for (const npc of gw.npcRuntimeById.values()) {
        if (npc.id === attack.attacker.id || npc.dying) continue
        out.push(npcTarget(npc))
    }
    return out
}

function targetCandidate(gw: GameWorld, targetId: string | undefined): MeleeTarget[] {
    if (!targetId) return []
    if (targetId === NPC_TARGET_PLAYER) return playerTargets(gw)
    const npc = gw.npcRuntimeById.get(targetId)
    if (!npc || npc.dying) return []
    return [npcTarget(npc)]
}

function playerTargets(gw: GameWorld): MeleeTarget[] {
    const out: MeleeTarget[] = []
    for (const eid of query(gw, [PlayerControlled, Position])) {
        const hasBox = hasComponent(gw, eid, BoxCollider)
        const radius = hasBox ? Math.max(BoxCollider.x[eid]!, BoxCollider.z[eid]!) : 0
        const minY = Position.y[eid]!
        const maxY = hasBox ? Position.y[eid]! + BoxCollider.y[eid]! * 2 : Position.y[eid]!
        out.push({
            key: `player:${eid}`,
            kind: 'player',
            eid,
            x: Position.x[eid]!,
            y: Position.y[eid]!,
            z: Position.z[eid]!,
            radius,
            minY,
            maxY,
        })
    }
    return out
}

function npcTarget(npc: NpcRuntimeState): MeleeTarget {
    return {
        key: `npc:${npc.id}`,
        kind: 'npc',
        npc,
        x: npc.position.x,
        y: npc.position.y,
        z: npc.position.z,
        radius: npc.colliderRadius,
        minY: npc.position.y,
        maxY: npc.position.y + npc.colliderHeight,
    }
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
    if (!verticalBandsOverlap(target, origin.y + shape.minY, origin.y + shape.maxY)) return null
    const dx = target.x - origin.x
    const dz = target.z - origin.z
    const dist = Math.hypot(dx, dz)
    if (dist > shape.range + target.radius) return null
    if (dist < 1e-4) return 0
    const forwardProjection = Math.sin(yaw) * dx + Math.cos(yaw) * dz
    if (forwardProjection < -target.radius) return null
    const angle = Math.atan2(dx, dz)
    const angleDelta = Math.abs(shortestAngleDelta(angle, yaw))
    const angularSlack = Math.asin(Math.min(1, target.radius / Math.max(dist, target.radius, 1e-4)))
    if (angleDelta > shape.arcRadians * 0.5 + angularSlack) return null
    return Math.max(0, dist - target.radius)
}

function distanceInsideCircle(origin: MeleeVec3, yaw: number, shape: Extract<MeleeShape, { kind: 'circle' }>, target: MeleeTarget): number | null {
    const center = circleCenter(origin, yaw, shape)
    if (!verticalBandsOverlap(target, center.y + shape.minY, center.y + shape.maxY)) return null
    const dx = target.x - center.x
    const dz = target.z - center.z
    const dist = Math.hypot(dx, dz)
    return dist <= shape.radius + target.radius ? Math.max(0, dist - target.radius) : null
}

function verticalBandsOverlap(target: MeleeTarget, minY: number, maxY: number): boolean {
    return target.maxY >= minY && target.minY <= maxY
}

function shortestAngleDelta(a: number, b: number): number {
    let delta = a - b
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    return delta
}

interface ShieldBlockResult {
    kind: MeleeBlockKind
}

function shieldBlockResult(gw: GameWorld, playerEid: number, attack: ActiveMeleeAttack): ShieldBlockResult | null {
    if (!hasComponent(gw, playerEid, Shield) || Shield.raised[playerEid] !== 1) return null
    const source = hitSourcePoint(attack)
    if (!source) return null
    const blockYaw = Rotation.y[playerEid]! + Shield.blockYawOffset[playerEid]!
    const fx = Math.sin(blockYaw)
    const fz = Math.cos(blockYaw)
    const ax = source.x - Position.x[playerEid]!
    const az = source.z - Position.z[playerEid]!
    const ad = Math.hypot(ax, az)
    if (ad < 1e-3) return null
    if ((fx * ax + fz * az) / ad < Shield.blockArcCos[playerEid]!) return null
    const dy = source.y - Position.y[playerEid]!
    if (dy < Shield.minY[playerEid]! || dy > Shield.maxY[playerEid]!) return null
    const kind = Shield.perfect[playerEid] === 1 && Math.abs(Shield.blockYawOffset[playerEid]!) < 1e-4
        ? 'perfect'
        : 'ordinary'
    return { kind }
}

function npcShieldGuardBlockResult(npc: NpcRuntimeState, attack: ActiveMeleeAttack): ShieldBlockResult | null {
    const guard = npc.shieldGuard
    if (!guard?.raised || (guard.cooldownSeconds ?? 0) > 0) return null
    const source = hitSourcePoint(attack)
    if (!source) return null
    const ax = source.x - npc.position.x
    const az = source.z - npc.position.z
    const ad = Math.hypot(ax, az)
    if (ad < 1e-3) return null
    const fx = Math.sin(npc.yaw)
    const fz = Math.cos(npc.yaw)
    if ((fx * ax + fz * az) / ad < guard.arcCos) return null
    const dy = source.y - npc.position.y
    if (dy < guard.minY || dy > guard.maxY) return null
    return { kind: 'ordinary' }
}

function triggerNpcShieldCooldown(gw: GameWorld, actor: MeleeActorRef): void {
    if (actor.kind !== 'npc') return
    const guard = gw.npcRuntimeById.get(actor.id)?.shieldGuard
    if (!guard) return
    guard.raised = false
    guard.cooldownSeconds = Math.max(guard.cooldownSeconds ?? 0, NPC_SHIELD_PERFECT_BLOCK_COOLDOWN_SECONDS)
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

function pushNpcShieldGuardDebugHitbox(gw: GameWorld, npc: NpcRuntimeState): void {
    const guard = npc.shieldGuard
    if (!guard || npc.dying) return
    const coolingDown = (guard.cooldownSeconds ?? 0) > 0
    if (!guard.raised && !coolingDown) return
    pushDebugHitbox(gw, {
        id: `npc:${npc.id}:shield`,
        kind: 'wedge',
        ttl: NPC_SHIELD_DEBUG_TTL,
        color: coolingDown ? [0.6, 0.62, 0.68] : [0.25, 0.95, 0.9],
        origin: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
        yaw: npc.yaw,
        range: npc.colliderRadius + NPC_SHIELD_DEBUG_RANGE_EXTRA,
        arcRadians: Math.acos(guard.arcCos) * 2,
        minY: guard.minY,
        maxY: guard.maxY,
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

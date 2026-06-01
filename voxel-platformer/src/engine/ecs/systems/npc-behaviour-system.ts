import { hasComponent, query } from 'bitecs'
import { PlayerControlled, Position, Rotation, Shield } from '../components'
import { applyDamage, HALF_HEART } from '../combat'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushScriptTriggerEvent, type GameWorld } from '../world'
import { pushDebugHitbox } from '../debug-hitboxes'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { findPath } from '../../voxel/voxel-path'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import { damageNpc, type NpcAiState, type NpcPendingHammerHit, type NpcRuntimeState, type Vec3Like } from '../../../game/npcs/npc-types'
import { NPC_TARGET_PLAYER } from '../../../game/npcs/npc-ai'
import { HUMANOID_ANIM_TIMINGS } from '../../../game/anim/clip-timings'

// Tuning — deliberately gentle so NPCs read as "simple guards", not RPG combat AI.
const MOVE_SPEED = 2.6
const ATTACK_RANGE = 1.7
const ATTACK_COOLDOWN = 0.9
const HAMMER_ATTACK_RANGE = 2.45
const HAMMER_ATTACK_COOLDOWN = 1.25
const HAMMER_IMPACT_DELAY = HUMANOID_ANIM_TIMINGS.hammerImpact
const HAMMER_IMPACT_RADIUS = 1.15
const HAMMER_IMPACT_VERTICAL = 1.8
// Default enemy hit = half a heart against the player's heart pool.
const ATTACK_DAMAGE = HALF_HEART
const THINK_INTERVAL = 0.25
const REPATH_INTERVAL = 0.5
const ARRIVE_EPS = 0.2
const PERCEPTION_VERTICAL = 3

interface PlayerSnapshot {
    eid: number
    x: number
    y: number
    z: number
}

/**
 * Simple NPC brain. An NPC with a script-assigned `ai` either patrols its
 * waypoints (one point = a guard standing post) or, when an enemy enters its
 * perception radius, paths to and attacks the nearest one — then returns to its
 * post. Hostility is entirely script-defined (see npc-ai). NPCs are runtime
 * side-table objects, not ECS entities, so this moves their `position`
 * kinematically along voxel-surface paths.
 */
export function createNpcBehaviourSystem(chunks: ChunkManager): System {
    const blockerBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const obstacleBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const obstacleHalf = { x: 0, y: 0, z: 0 }

    return {
        fixed: true,
        order: FixedOrder.npcBehaviour,
        update(world, dt) {
            const gw = world as GameWorld
            const players = query(world, [PlayerControlled, Position])
            const player: PlayerSnapshot | null = players.length
                ? { eid: players[0]!, x: Position.x[players[0]!]!, y: Position.y[players[0]!]!, z: Position.z[players[0]!]! }
                : null

            for (const rt of gw.npcRuntimeById.values()) {
                if (rt.dying) {
                    rt.pendingHammerHit = undefined
                    continue
                }
                updatePendingHammerHit(gw, rt, player, dt)
                if (!rt.ai) continue
                updateNpc(gw, rt, rt.ai, player, dt)
            }
        },
    }

    function updateNpc(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, player: PlayerSnapshot | null, dt: number): void {
        ai.thinkCooldown -= dt
        ai.repathCooldown -= dt
        ai.attackCooldown -= dt

        if (ai.thinkCooldown <= 0) {
            ai.thinkCooldown = THINK_INTERVAL
            const enemyId = nearestEnemy(gw, rt, ai, player)
            if (enemyId) {
                if (ai.targetId !== enemyId) {
                    ai.targetId = enemyId
                    ai.announcedTarget = false
                    ai.path = null
                    ai.repathCooldown = 0
                }
                if (!ai.announcedTarget) {
                    ai.announcedTarget = true
                    pushScriptTriggerEvent(gw, { kind: 'npc-spotted-enemy', npcId: rt.id, targetId: enemyId })
                }
            } else if (ai.targetId !== null) {
                ai.targetId = null
                ai.announcedTarget = false
                ai.path = null
            }
        }

        // Engaging iff we hold a target — `mode` is derivable, not stored.
        if (ai.targetId !== null) {
            const target = enemyPosition(gw, ai.targetId, player)
            if (!target) {
                ai.targetId = null
                ai.path = null
                return
            }
            const dx = target.x - rt.position.x
            const dz = target.z - rt.position.z
            const dist = Math.hypot(dx, dz)
            face(rt, dx, dz)
            if (dist <= attackRange(rt)) {
                ai.path = null
                tryAttack(gw, rt, ai, ai.targetId, player)
            } else {
                ensurePath(gw, rt, ai, target)
                moveAlongPath(gw, rt, ai, dt)
            }
            return
        }

        patrol(gw, rt, ai, dt)
    }

    function patrol(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, dt: number): void {
        const goal = ai.waypoints.length > 0 ? ai.waypoints[ai.waypointIndex]! : ai.home
        // The walker settles on the goal cell's *centre* (floor + 0.5), so test
        // arrival against that — comparing to the raw (often integer) waypoint
        // would never get within ARRIVE_EPS and the patrol would never advance.
        const dx = (Math.floor(goal.x) + 0.5) - rt.position.x
        const dz = (Math.floor(goal.z) + 0.5) - rt.position.z
        if (Math.hypot(dx, dz) <= ARRIVE_EPS) {
            ai.path = null
            if (ai.waypoints.length > 1) {
                pushScriptTriggerEvent(gw, { kind: 'npc-reached', npcId: rt.id, waypointIndex: ai.waypointIndex })
                ai.waypointIndex = (ai.waypointIndex + 1) % ai.waypoints.length
            }
            return // guard/idle once at post
        }
        ensurePath(gw, rt, ai, goal)
        moveAlongPath(gw, rt, ai, dt)
    }

    function ensurePath(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, goal: Vec3Like): void {
        const haveValid = ai.path && ai.pathIndex < ai.path.length
        if (haveValid && ai.repathCooldown > 0) return
        ai.repathCooldown = REPATH_INTERVAL
        const start = { x: Math.floor(rt.position.x), y: Math.floor(rt.position.y), z: Math.floor(rt.position.z) }
        const end = { x: Math.floor(goal.x), y: Math.floor(goal.y), z: Math.floor(goal.z) }
        const path = findPath(chunks, start, end, { isBlocked: (x, y, z) => cellBlocked(gw, rt, x, y, z) })
        ai.path = path
        ai.pathIndex = path && path.length > 1 ? 1 : 0
    }

    function moveAlongPath(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, dt: number): void {
        if (!ai.path || ai.pathIndex >= ai.path.length) return
        const cell = ai.path[ai.pathIndex]!
        const tx = cell.x + 0.5
        const tz = cell.z + 0.5
        const dx = tx - rt.position.x
        const dz = tz - rt.position.z
        const dist = Math.hypot(dx, dz)
        const step = MOVE_SPEED * dt
        if (dist <= step || dist < 1e-4) {
            rt.position.x = tx
            rt.position.z = tz
            rt.position.y = cell.y
            ai.pathIndex++
        } else {
            rt.position.x += (dx / dist) * step
            rt.position.z += (dz / dist) * step
            rt.position.y = cell.y
            face(rt, dx, dz)
        }
        updateObstacle(gw, rt)
    }

    function cellBlocked(gw: GameWorld, rt: NpcRuntimeState, x: number, y: number, z: number): boolean {
        blockerBox.minX = x + 0.1
        blockerBox.minY = y
        blockerBox.minZ = z + 0.1
        blockerBox.maxX = x + 0.9
        blockerBox.maxY = y + Math.max(0.5, rt.colliderHeight)
        blockerBox.maxZ = z + 0.9
        return gw.obstacles.intersects(blockerBox, rt.obstacleId ?? undefined)
    }

    function updateObstacle(gw: GameWorld, rt: NpcRuntimeState): void {
        if (rt.obstacleId === null) return
        // Foot-anchored box matching the registration in npc-types. The registry
        // copies the AABB on add(), so the scratch box is safe to reuse.
        obstacleHalf.x = rt.colliderRadius
        obstacleHalf.y = rt.colliderHeight / 2
        obstacleHalf.z = rt.colliderRadius
        aabbFromFoot(rt.position, obstacleHalf, obstacleBox)
        gw.obstacles.add(rt.obstacleId, obstacleBox)
    }

    function tryAttack(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, targetId: string, player: PlayerSnapshot | null): void {
        if (ai.attackCooldown > 0) return
        const clip = rt.attackClip ?? 'attack'
        ai.attackCooldown = clip === 'hammerAttack' ? HAMMER_ATTACK_COOLDOWN : ATTACK_COOLDOWN
        rt.requestAttack = true // npc-render plays the swing
        rt.requestAttackClip = clip
        if (clip === 'hammerAttack') {
            const target = enemyPosition(gw, targetId, player)
            scheduleHammerHit(gw, rt, targetId, target)
            return
        }
        pushNpcAttackDebug(gw, rt)
        if (targetId === NPC_TARGET_PLAYER) {
            if (player && !blockedByShield(gw, player.eid, rt)) {
                applyDamage(gw, player.eid, ATTACK_DAMAGE)
            }
            return
        }
        const target = gw.npcRuntimeById.get(targetId)
        if (target) damageNpc(target, ATTACK_DAMAGE)
    }

    function updatePendingHammerHit(gw: GameWorld, rt: NpcRuntimeState, player: PlayerSnapshot | null, dt: number): void {
        const hit = rt.pendingHammerHit
        if (!hit) return
        hit.seconds -= dt
        pushHammerDebug(gw, rt, hit, hit.seconds > 0 ? 0.08 : 0.22)
        if (hit.seconds > 0) return
        rt.pendingHammerHit = undefined
        if (player && pointInsideHammerHit(hit, player.x, player.y, player.z) && !blockedByShield(gw, player.eid, rt)) {
            applyDamage(gw, player.eid, hit.damage)
        }
        for (const npc of gw.npcRuntimeById.values()) {
            if (npc.id === rt.id || npc.dying) continue
            if (pointInsideHammerHit(hit, npc.position.x, npc.position.y, npc.position.z)) damageNpc(npc, hit.damage)
        }
    }

    function scheduleHammerHit(gw: GameWorld, rt: NpcRuntimeState, targetId: string, target: Vec3Like | null): void {
        const center = hammerImpactCenter(rt, target)
        rt.pendingHammerHit = {
            seconds: HAMMER_IMPACT_DELAY,
            x: center.x,
            y: center.y,
            z: center.z,
            radius: HAMMER_IMPACT_RADIUS,
            damage: ATTACK_DAMAGE,
            targetId,
        }
        pushHammerDebug(gw, rt, rt.pendingHammerHit, HAMMER_IMPACT_DELAY)
    }
}

function attackRange(rt: NpcRuntimeState): number {
    return (rt.attackClip ?? 'attack') === 'hammerAttack' ? HAMMER_ATTACK_RANGE : ATTACK_RANGE
}

function hammerImpactCenter(rt: NpcRuntimeState, target: Vec3Like | null): Vec3Like {
    const fx = Math.sin(rt.yaw)
    const fz = Math.cos(rt.yaw)
    if (!target) {
        return {
            x: rt.position.x + fx * 1.35,
            y: rt.position.y,
            z: rt.position.z + fz * 1.35,
        }
    }
    const dx = target.x - rt.position.x
    const dz = target.z - rt.position.z
    const dist = Math.hypot(dx, dz)
    if (dist <= HAMMER_ATTACK_RANGE && dist > 1e-3) {
        return { x: target.x, y: target.y, z: target.z }
    }
    return {
        x: rt.position.x + fx * Math.min(HAMMER_ATTACK_RANGE, Math.max(1.35, dist)),
        y: target.y,
        z: rt.position.z + fz * Math.min(HAMMER_ATTACK_RANGE, Math.max(1.35, dist)),
    }
}

function pointInsideHammerHit(hit: NpcPendingHammerHit, x: number, y: number, z: number): boolean {
    if (Math.abs(y - hit.y) > HAMMER_IMPACT_VERTICAL) return false
    const dx = x - hit.x
    const dz = z - hit.z
    return dx * dx + dz * dz <= hit.radius * hit.radius
}

function pushHammerDebug(gw: GameWorld, rt: NpcRuntimeState, hit: NpcPendingHammerHit, ttl: number): void {
    pushDebugHitbox(gw, {
        id: `npc:${rt.id}:hammer`,
        kind: 'circle',
        ttl,
        color: hit.seconds > 0 ? [1.0, 0.78, 0.18] : [1.0, 0.22, 0.1],
        center: { x: hit.x, y: hit.y + 0.04, z: hit.z },
        radius: hit.radius,
    })
}

function pushNpcAttackDebug(gw: GameWorld, rt: NpcRuntimeState): void {
    pushDebugHitbox(gw, {
        id: `npc:${rt.id}:attack`,
        kind: 'circle',
        ttl: 0.24,
        color: [1.0, 0.32, 0.16],
        center: { x: rt.position.x, y: rt.position.y + 0.04, z: rt.position.z },
        radius: attackRange(rt),
    })
}

function nearestEnemy(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, player: PlayerSnapshot | null): string | null {
    const r2 = ai.perceptionRadius * ai.perceptionRadius
    let bestId: string | null = null
    let bestDist = r2
    const consider = (id: string, x: number, y: number, z: number) => {
        if (Math.abs(y - rt.position.y) > PERCEPTION_VERTICAL) return
        const dx = x - rt.position.x
        const dz = z - rt.position.z
        const d2 = dx * dx + dz * dz
        if (d2 <= bestDist) {
            bestDist = d2
            bestId = id
        }
    }
    if (ai.hostileToPlayer && player) consider(NPC_TARGET_PLAYER, player.x, player.y, player.z)
    if (ai.hostileIds.size > 0) {
        for (const id of ai.hostileIds) {
            if (id === rt.id) continue // never target self (script typo guard)
            const other = gw.npcRuntimeById.get(id)
            if (other && !other.dying) consider(id, other.position.x, other.position.y, other.position.z)
        }
    }
    return bestId
}

function enemyPosition(gw: GameWorld, targetId: string, player: PlayerSnapshot | null): Vec3Like | null {
    if (targetId === NPC_TARGET_PLAYER) return player ? { x: player.x, y: player.y, z: player.z } : null
    const other = gw.npcRuntimeById.get(targetId)
    return other && !other.dying ? other.position : null
}

function blockedByShield(gw: GameWorld, playerEid: number, rt: NpcRuntimeState): boolean {
    if (!hasComponent(gw, playerEid, Shield) || Shield.raised[playerEid] !== 1) return false
    // Block arc is centred on the facing yaw rotated by the shield's offset
    // (0 = front guard, -π/2 = passive left-flank guard).
    const blockYaw = Rotation.y[playerEid]! + Shield.blockYawOffset[playerEid]!
    const fx = Math.sin(blockYaw)
    const fz = Math.cos(blockYaw)
    const ax = rt.position.x - Position.x[playerEid]!
    const az = rt.position.z - Position.z[playerEid]!
    const ad = Math.hypot(ax, az)
    if (ad < 1e-3) return false
    if ((fx * ax + fz * az) / ad < Shield.blockArcCos[playerEid]!) return false
    const dy = rt.position.y - Position.y[playerEid]!
    return dy >= Shield.minY[playerEid]! && dy <= Shield.maxY[playerEid]!
}

function face(rt: NpcRuntimeState, dx: number, dz: number): void {
    if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) rt.yaw = Math.atan2(dx, dz)
}

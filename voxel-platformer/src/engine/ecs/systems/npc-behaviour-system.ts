import { query } from 'bitecs'
import { PlayerControlled, Position } from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushScriptTriggerEvent, type GameWorld } from '../world'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { findPath } from '../../voxel/voxel-path'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import { type NpcAiState, type NpcRuntimeState, type Vec3Like } from '../../../game/npcs/npc-types'
import { NPC_TARGET_PLAYER, provokeFromPlayerAttack, rememberThreatPos } from '../../../game/npcs/npc-ai'
import { hasActiveMeleeAttack, isMeleeActorLocked, startMeleeAttack } from '../melee-combat'
import { MELEE_ATTACK_DEFS } from '../melee-types'
import { spawnArrowProjectile } from '../../../game/moving-objects'
import { DEFAULT_PHYSICS_GRAVITY } from './physics-system'

// Tuning — deliberately gentle so NPCs read as "simple guards", not RPG combat AI.
const MOVE_SPEED = 2.6
const ATTACK_RANGE = 1.7
const ATTACK_COOLDOWN = 0.9
const SPEAR_ATTACK_RANGE = 2.5
const HAMMER_ATTACK_RANGE = 2.45
const HAMMER_ATTACK_COOLDOWN = 1.25
// Ranged (bow) tuning — archers hold distance and arc arrows at the target.
const SHOOT_RANGE = 10
const SHOOT_COOLDOWN = 1.5
const SHOOT_SPEED = 16
const ARROW_MUZZLE_FORWARD = 0.5
const ARROW_MUZZLE_HEIGHT = 1.0
const TARGET_TORSO_HEIGHT = 1.0
// Prey (flee) tuning — rabbits sprint away and re-plan their escape often.
const FLEE_SPEED = 3.7
const FLEE_DISTANCE = 5
const FLEE_REPATH = 0.4
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
                updateShieldGuardCooldown(rt, dt)
                if (rt.dying) {
                    gw.meleeAttacks.delete(`npc:${rt.id}`)
                    continue
                }
                // Retaliation: a player hit this frame turns the NPC hostile.
                // Done here (not in `damageNpc`) so the data helper stays free of
                // AI concerns and a brain-less NPC can still be provoked.
                if (rt.provoked) {
                    rt.provoked = false
                    // Pass the player's position so a hunter (threatMemorySeconds
                    // > 0) charges the shot's origin even when sniped from range.
                    provokeFromPlayerAttack(rt, player ?? undefined)
                }
                if (!rt.ai) continue
                updateNpc(gw, rt, rt.ai, player, dt)
            }
        },
    }

    function updateNpc(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, player: PlayerSnapshot | null, dt: number): void {
        ai.thinkCooldown -= dt
        ai.repathCooldown -= dt
        ai.attackCooldown -= dt
        if (ai.threatSeconds > 0) ai.threatSeconds = Math.max(0, ai.threatSeconds - dt)

        const actor = { kind: 'npc' as const, id: rt.id }
        const attacking = hasActiveMeleeAttack(gw, actor)
        setShieldGuardRaised(rt, false)
        if ((rt.stunSeconds ?? 0) > 0 || isMeleeActorLocked(gw, actor)) {
            ai.path = null
            return
        }

        // Prey: flee the player on sight, otherwise wander the post. Never fight.
        if (ai.flee) {
            fleeUpdate(gw, rt, ai, player, dt)
            return
        }

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
                ai.targetPerceived = true
                // Refresh pursuit memory from this live sighting.
                if ((rt.threatMemorySeconds ?? 0) > 0) {
                    const seen = enemyPosition(gw, enemyId, player)
                    if (seen) {
                        rememberThreatPos(ai, seen)
                        ai.threatSeconds = rt.threatMemorySeconds!
                    }
                }
            } else {
                ai.targetPerceived = false
                // Lost sight: a hunter keeps the target and chases its last-known
                // spot until memory runs out; everyone else gives up at once.
                if (ai.targetId !== null && ai.threatSeconds <= 0) {
                    ai.targetId = null
                    ai.announcedTarget = false
                    ai.path = null
                }
            }
        }

        // Engaging iff we hold a target — `mode` is derivable, not stored.
        if (ai.targetId !== null) {
            // Perceived → track the live target and attack; remembered (lost) →
            // walk to its last-known position without swinging at empty air.
            const target = ai.targetPerceived ? enemyPosition(gw, ai.targetId, player) : ai.threatPos
            if (!target) {
                ai.targetId = null
                ai.path = null
                return
            }
            if (!attacking) setShieldGuardRaised(rt, true)
            const dx = target.x - rt.position.x
            const dz = target.z - rt.position.z
            const dist = Math.hypot(dx, dz)
            face(rt, dx, dz)
            if (ai.targetPerceived && dist <= attackRange(rt)) {
                ai.path = null
                tryAttack(gw, rt, ai, ai.targetId, target)
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

    function moveAlongPath(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, dt: number, speed = MOVE_SPEED): void {
        if (!ai.path || ai.pathIndex >= ai.path.length) return
        const cell = ai.path[ai.pathIndex]!
        const tx = cell.x + 0.5
        const tz = cell.z + 0.5
        const dx = tx - rt.position.x
        const dz = tz - rt.position.z
        const dist = Math.hypot(dx, dz)
        const step = speed * dt
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

    function tryAttack(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, targetId: string, target: Vec3Like): void {
        if (ai.attackCooldown > 0) return
        const clip = rt.attackClip ?? 'attack'
        if (clip === 'shoot') {
            fireArrow(gw, rt, target)
            ai.attackCooldown = SHOOT_COOLDOWN
            rt.requestAttack = true // npc-render plays the draw/release
            rt.requestAttackClip = 'shoot'
            return
        }
        const def = clip === 'hammerAttack'
            ? MELEE_ATTACK_DEFS['hammer-slam']
            : clip === 'spearAttack'
                ? MELEE_ATTACK_DEFS['npc-spear-thrust']
                : MELEE_ATTACK_DEFS['npc-slash']
        if (!startMeleeAttack(gw, { kind: 'npc', id: rt.id }, def, { targetId })) return
        setShieldGuardRaised(rt, false)
        ai.attackCooldown = clip === 'hammerAttack' ? HAMMER_ATTACK_COOLDOWN : ATTACK_COOLDOWN
        rt.requestAttack = true // npc-render plays the swing
        rt.requestAttackClip = clip
    }

    /** Prey behaviour: sprint directly away from the player when seen, else
     *  wander the post. Re-plans the escape route often so corners don't trap. */
    function fleeUpdate(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, player: PlayerSnapshot | null, dt: number): void {
        const threat = nearestThreatPos(gw, rt, ai, player)
        if (!threat) {
            patrol(gw, rt, ai, dt)
            return
        }
        ai.targetId = null
        let awayX = rt.position.x - threat.x
        let awayZ = rt.position.z - threat.z
        const len = Math.hypot(awayX, awayZ)
        if (len < 1e-3) { awayX = 1; awayZ = 0 } else { awayX /= len; awayZ /= len }
        // A little lateral wobble (deterministic from position) so the flee line
        // isn't a dead-straight retreat.
        const lateral = Math.sin(rt.position.x * 1.7 + rt.position.z * 2.3) * 1.4
        const goal: Vec3Like = {
            x: Math.floor(rt.position.x + awayX * FLEE_DISTANCE - awayZ * lateral),
            y: Math.floor(rt.position.y),
            z: Math.floor(rt.position.z + awayZ * FLEE_DISTANCE + awayX * lateral),
        }
        face(rt, awayX, awayZ)
        if (ai.repathCooldown <= 0 || !ai.path || ai.pathIndex >= ai.path.length) {
            ai.repathCooldown = FLEE_REPATH
            const start = { x: Math.floor(rt.position.x), y: Math.floor(rt.position.y), z: Math.floor(rt.position.z) }
            const end = { x: goal.x, y: goal.y, z: goal.z }
            const path = findPath(chunks, start, end, { isBlocked: (x, y, z) => cellBlocked(gw, rt, x, y, z) })
            ai.path = path
            ai.pathIndex = path && path.length > 1 ? 1 : 0
        }
        moveAlongPath(gw, rt, ai, dt, FLEE_SPEED)
    }

    /** Spawn a hostile arrow arced from the archer's muzzle at the target. */
    function fireArrow(gw: GameWorld, rt: NpcRuntimeState, target: Vec3Like): void {
        const fx = Math.sin(rt.yaw)
        const fz = Math.cos(rt.yaw)
        const mx = rt.position.x + fx * ARROW_MUZZLE_FORWARD
        const my = rt.position.y + ARROW_MUZZLE_HEIGHT
        const mz = rt.position.z + fz * ARROW_MUZZLE_FORWARD
        const dx = target.x - mx
        const dz = target.z - mz
        const dist = Math.max(0.001, Math.hypot(dx, dz))
        const flight = dist / SHOOT_SPEED
        const dyTo = (target.y + TARGET_TORSO_HEIGHT) - my
        spawnArrowProjectile(
            gw,
            { x: mx, y: my, z: mz },
            {
                x: (dx / dist) * SHOOT_SPEED,
                // Ballistic arc: reach the target's torso under the world gravity.
                y: dyTo / flight + 0.5 * DEFAULT_PHYSICS_GRAVITY * flight,
                z: (dz / dist) * SHOOT_SPEED,
            },
            { hostile: true },
        )
    }
}

/** The closest threat to flee from — the player (when within perception) or any
 *  script-set hostile NPC. Prey treat the player as a threat even though they
 *  never set `hostileToPlayer` (that flag drives *attacking*, not fleeing). */
function nearestThreatPos(gw: GameWorld, rt: NpcRuntimeState, ai: NpcAiState, player: PlayerSnapshot | null): Vec3Like | null {
    const r2 = ai.perceptionRadius * ai.perceptionRadius
    let best: Vec3Like | null = null
    let bestDist = r2
    const consider = (x: number, y: number, z: number) => {
        if (Math.abs(y - rt.position.y) > PERCEPTION_VERTICAL) return
        const dx = x - rt.position.x
        const dz = z - rt.position.z
        const d2 = dx * dx + dz * dz
        if (d2 <= bestDist) { bestDist = d2; best = { x, y, z } }
    }
    if (player) consider(player.x, player.y, player.z)
    for (const id of ai.hostileIds) {
        const other = gw.npcRuntimeById.get(id)
        if (other && !other.dying) consider(other.position.x, other.position.y, other.position.z)
    }
    return best
}

function attackRange(rt: NpcRuntimeState): number {
    switch (rt.attackClip ?? 'attack') {
        case 'shoot': return SHOOT_RANGE
        case 'spearAttack': return SPEAR_ATTACK_RANGE
        case 'hammerAttack': return HAMMER_ATTACK_RANGE
        default: return ATTACK_RANGE
    }
}

function setShieldGuardRaised(rt: NpcRuntimeState, raised: boolean): void {
    if (!rt.shieldGuard) return
    rt.shieldGuard.raised = raised && !npcShieldGuardCoolingDown(rt)
}

function updateShieldGuardCooldown(rt: NpcRuntimeState, dt: number): void {
    const guard = rt.shieldGuard
    if (!guard?.cooldownSeconds) return
    guard.cooldownSeconds = Math.max(0, guard.cooldownSeconds - dt)
    if (guard.cooldownSeconds <= 0) guard.cooldownSeconds = undefined
    else guard.raised = false
}

function npcShieldGuardCoolingDown(rt: NpcRuntimeState): boolean {
    return (rt.shieldGuard?.cooldownSeconds ?? 0) > 0
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

function face(rt: NpcRuntimeState, dx: number, dz: number): void {
    if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) rt.yaw = Math.atan2(dx, dz)
}

import type { GameWorld } from '../../engine/ecs/world'
import type { NpcAiState, NpcRuntimeState, Vec3Like } from './npc-types'

/** Sentinel target id meaning "the player entity". */
export const NPC_TARGET_PLAYER = 'player'

const DEFAULT_PERCEPTION_RADIUS = 8

/** Lazily create a default brain anchored at the NPC's current post. */
function ensureAi(runtime: NpcRuntimeState): NpcAiState {
    if (runtime.ai) return runtime.ai
    const ai: NpcAiState = {
        waypoints: [],
        waypointIndex: 0,
        home: { ...runtime.position },
        perceptionRadius: DEFAULT_PERCEPTION_RADIUS,
        hostileToPlayer: false,
        hostileIds: new Set(),
        path: null,
        pathIndex: 0,
        targetId: null,
        announcedTarget: false,
        repathCooldown: 0,
        attackCooldown: 0,
        thinkCooldown: 0,
        flee: false,
        targetPerceived: false,
        threatSeconds: 0,
        threatPos: null,
    }
    runtime.ai = ai
    return ai
}

function npc(world: GameWorld, id: string): NpcRuntimeState | null {
    const rt = world.npcRuntimeById.get(id)
    return rt && !rt.dying ? rt : null
}

/**
 * Set the NPC's patrol route. An empty list clears the route (the NPC holds its
 * current post); a single point makes it a guard that stands there; multiple
 * points are walked in a loop. Resets any in-progress path.
 */
export function setNpcWaypoints(world: GameWorld, id: string, points: readonly Vec3Like[]): boolean {
    const rt = npc(world, id)
    if (!rt) return false
    const ai = ensureAi(rt)
    ai.waypoints = points.map((p) => ({ x: p.x, y: p.y, z: p.z }))
    ai.waypointIndex = 0
    ai.path = null
    return true
}

/** Convenience: walk to a single point and hold there (one-point patrol). */
export function npcGoTo(world: GameWorld, id: string, point: Vec3Like): boolean {
    return setNpcWaypoints(world, id, [point])
}

/** Clear the route so the NPC stands at its current spot (which becomes home). */
export function stopNpc(world: GameWorld, id: string): boolean {
    const rt = npc(world, id)
    if (!rt) return false
    const ai = ensureAi(rt)
    ai.waypoints = []
    ai.path = null
    ai.home = { ...rt.position }
    return true
}

export function setNpcPerceptionRadius(world: GameWorld, id: string, radius: number): boolean {
    const rt = npc(world, id)
    if (!rt) return false
    ensureAi(rt).perceptionRadius = Math.max(0, radius)
    return true
}

/**
 * Set how long (seconds) the NPC keeps pursuing a target it has lost sight of,
 * charging its last-known position before giving up. `0` (default) disables
 * pursuit memory: the NPC only engages what is currently within perception.
 * Raise it for a hunter that chases down a hit-and-run / sniping player.
 */
export function setNpcThreatMemory(world: GameWorld, id: string, seconds: number): boolean {
    const rt = npc(world, id)
    if (!rt) return false
    rt.threatMemorySeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
    return true
}

/**
 * Make an NPC prey: while `on`, it never attacks and instead flees any
 * perceived threat (the player or hostile NPC ids) within its perception
 * radius, wandering its post otherwise.
 */
export function setNpcFlee(world: GameWorld, id: string, on: boolean): boolean {
    const rt = npc(world, id)
    if (!rt) return false
    ensureAi(rt).flee = on
    return true
}

/**
 * Define who an NPC treats as an enemy. `target` is the player sentinel
 * (`NPC_TARGET_PLAYER`) or another NPC id. There is no faction matrix — scripts
 * own hostility entirely.
 */
export function setNpcHostile(world: GameWorld, id: string, target: string, hostile: boolean): boolean {
    const rt = npc(world, id)
    if (!rt) return false
    const ai = ensureAi(rt)
    if (target === NPC_TARGET_PLAYER) {
        ai.hostileToPlayer = hostile
    } else if (hostile) {
        ai.hostileIds.add(target)
    } else {
        ai.hostileIds.delete(target)
    }
    return true
}

/**
 * Retaliation: `damageNpc` flagged this NPC as hit by the player (`rt.provoked`).
 * Turn it hostile to the player so it fights back — giving it a brain on the
 * spot if it had none — unless it is `unprovokable` (essential characters) or
 * prey (which keeps fleeing). The single home of the "what does a player hit
 * do" policy; the behaviour system owns *when* it runs and clears the flag.
 *
 * `attackerPos` (the player's position at the hit) seeds threat memory so an
 * NPC with `threatMemorySeconds > 0` charges the shot's origin even when the
 * shooter is beyond its perception radius — the answer to hit-and-run sniping.
 * A no-op for NPCs without pursuit memory.
 */
export function provokeFromPlayerAttack(rt: NpcRuntimeState, attackerPos?: Vec3Like): void {
    if (rt.unprovokable) return
    const ai = ensureAi(rt)
    if (ai.flee) return
    ai.hostileToPlayer = true
    if ((rt.threatMemorySeconds ?? 0) > 0 && attackerPos) {
        ai.targetId = NPC_TARGET_PLAYER
        ai.targetPerceived = false
        ai.threatSeconds = rt.threatMemorySeconds!
        rememberThreatPos(ai, attackerPos)
    }
}

/** Copy a sighting into the reused `threatPos` slot (no per-call allocation). */
export function rememberThreatPos(ai: NpcAiState, pos: Vec3Like): void {
    if (ai.threatPos) {
        ai.threatPos.x = pos.x
        ai.threatPos.y = pos.y
        ai.threatPos.z = pos.z
    } else {
        ai.threatPos = { x: pos.x, y: pos.y, z: pos.z }
    }
}

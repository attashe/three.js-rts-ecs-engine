import type { GameWorld } from '../../engine/ecs/world'
import { defineZone, removeZone } from '../../engine/ecs/zones'
import type { ScriptEntry } from '../../engine/script/types'
import type { NpcConfig } from './npc-types'
import {
    npcDefaultHp,
    npcAttackClip,
    npcCollisionAabb,
    npcInteractionZone,
    npcObstacleId,
    npcShieldGuardState,
    npcScriptEntries,
} from './npc-types'

export interface RegisteredNpcRuntime {
    scripts: ScriptEntry[]
    dispose(): void
}

export function registerRuntimeNpcs(world: GameWorld, npcs: readonly NpcConfig[]): RegisteredNpcRuntime {
    const registeredIds: string[] = []

    npcs.forEach((npc, index) => {
        let zoneId: string | null = null
        const zone = npcInteractionZone(npc)
        if (zone) {
            defineZone(world, zone)
            zoneId = zone.id
        }
        let obstacleId: number | null = null
        const aabb = npcCollisionAabb(npc)
        if (aabb) {
            obstacleId = npcObstacleId(npc, index)
            world.obstacles.add(obstacleId, aabb)
        }

        // Combat/animation runtime. NPCs aren't ECS entities, so this side-table
        // is their gameplay state: melee + scripts write the request flags, the
        // npc-render system reads them to drive animation and despawn on death.
        const maxHp = npcDefaultHp(npc)
        world.npcRuntimeById.set(npc.id, {
            id: npc.id,
            position: { ...npc.position },
            yaw: npc.yaw,
            colliderRadius: npc.colliderRadius,
            colliderHeight: npc.colliderHeight,
            hp: maxHp,
            maxHp,
            invulnerable: npc.invulnerable,
            unprovokable: npc.unprovokable,
            requestAttack: false,
            attackClip: npcAttackClip(npc),
            requestDie: false,
            dying: false,
            shieldGuard: npcShieldGuardState(npc),
            ai: null,
            zoneId,
            obstacleId,
        })
        registeredIds.push(npc.id)
    })

    return {
        scripts: npcScriptEntries(npcs),
        dispose() {
            for (const id of registeredIds) disposeNpc(world, id)
        },
    }
}

/**
 * Free an NPC's zone + collision obstacle and drop its runtime state. The single
 * owner of that teardown, called both on level dispose (every NPC) and on death
 * despawn (one NPC). Idempotent — a missing id is a no-op.
 */
export function disposeNpc(world: GameWorld, id: string): void {
    const runtime = world.npcRuntimeById.get(id)
    if (!runtime) return
    if (runtime.zoneId) removeZone(world, runtime.zoneId)
    if (runtime.obstacleId !== null) world.obstacles.remove(runtime.obstacleId)
    world.meleeAttacks.delete(`npc:${id}`)
    world.npcRuntimeById.delete(id)
}

import type { GameWorld } from '../../engine/ecs/world'
import { defineZone, removeZone } from '../../engine/ecs/zones'
import type { ScriptEntry } from '../../engine/script/types'
import type { NpcConfig } from './npc-types'
import {
    npcCollisionAabb,
    npcInteractionZone,
    npcObstacleId,
    npcScriptEntries,
} from './npc-types'

export interface RegisteredNpcRuntime {
    scripts: ScriptEntry[]
    dispose(): void
}

export function registerRuntimeNpcs(world: GameWorld, npcs: readonly NpcConfig[]): RegisteredNpcRuntime {
    const zoneIds: string[] = []
    const obstacleIds: number[] = []

    npcs.forEach((npc, index) => {
        const zone = npcInteractionZone(npc)
        if (zone) {
            defineZone(world, zone)
            zoneIds.push(zone.id)
        }
        const aabb = npcCollisionAabb(npc)
        if (aabb) {
            const id = npcObstacleId(npc, index)
            world.obstacles.add(id, aabb)
            obstacleIds.push(id)
        }
    })

    return {
        scripts: npcScriptEntries(npcs),
        dispose() {
            for (const id of zoneIds) removeZone(world, id)
            for (const id of obstacleIds) world.obstacles.remove(id)
        },
    }
}

import type { ChunkManager } from '../../voxel/chunk-manager'
import { movementEnvironmentForAABB } from '../../voxel/movement-effects'
import type { AABB } from '../../voxel/voxel-collide'
import type { System } from './system'
import { FixedOrder } from './orders'
import type { GameWorld } from '../world'
import { killNpc } from '../../../game/npcs/npc-types'

/**
 * Applies lethal block contact hazards (lava) to NPCs, mirroring the player's
 * `player-death-system` lava check. NPCs aren't ECS entities, so they don't
 * flow through that query — they live in `world.npcRuntimeById`. A hazard kills
 * the NPC outright (1–3 HP combat model): we flag `requestDie`/`dying` so
 * npc-render plays the death animation and despawns the body.
 *
 * Runs after NPC movement (npc-behaviour) has settled positions for the tick.
 */
export function createNpcHazardSystem(chunks: ChunkManager): System {
    const box: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world) {
            const gw = world as GameWorld
            for (const npc of gw.npcRuntimeById.values()) {
                if (npc.dying) continue
                const r = npc.colliderRadius
                box.minX = npc.position.x - r
                box.minY = npc.position.y
                box.minZ = npc.position.z - r
                box.maxX = npc.position.x + r
                box.maxY = npc.position.y + npc.colliderHeight
                box.maxZ = npc.position.z + r
                if (movementEnvironmentForAABB(chunks, box).contactHazard === 'lava') {
                    killNpc(npc)
                }
            }
        },
    }
}

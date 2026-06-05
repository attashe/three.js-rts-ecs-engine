import { FixedOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import { FOOD_MEAT_ITEM_ID, consumableItemOptions } from './consumables'
import { spawnScriptPickup } from './pickups'

export function createNpcLootSystem(): System {
    const dropped = new Set<string>()
    return {
        name: 'npcLoot',
        fixed: true,
        order: FixedOrder.postPhysics + 20,
        update(world) {
            for (const npc of world.npcRuntimeById.values()) {
                if (!npc.dying || npc.model !== 'rabbit' || dropped.has(npc.id)) continue
                dropped.add(npc.id)
                spawnScriptPickup(world, {
                    kind: FOOD_MEAT_ITEM_ID,
                    id: `loot:${npc.id}:rabbit-meat`,
                    position: { x: npc.position.x, y: npc.position.y + 0.05, z: npc.position.z },
                    label: 'Rabbit Meat',
                    inventoryItem: {
                        id: FOOD_MEAT_ITEM_ID,
                        ...consumableItemOptions(FOOD_MEAT_ITEM_ID),
                    },
                })
            }
        },
    }
}

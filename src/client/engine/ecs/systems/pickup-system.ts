import { hasComponent, query } from 'bitecs'
import { Pickup, PickupValue, PlayerControlled, Position } from '../components'
import { despawnEntity } from '../entity'
import type { System } from './system'
import { FixedOrder } from './orders'
import { addItemToBackpack, pushGameLog } from '../world'
import { createInventoryItem, recomputePlayerStats } from '../../../game/items'

export interface PickupSystemOptions {
    radius?: number
    notify?: (message: string) => void
}

export function createPickupSystem(opts: PickupSystemOptions = {}): System {
    const radius = opts.radius ?? 0.75
    const radiusSq = radius * radius

    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world) {
            const players = query(world, [PlayerControlled, Position])
            if (players.length === 0) return
            const player = players[0]
            const px = Position.x[player]
            const py = Position.y[player]
            const pz = Position.z[player]

            const pickups = query(world, [Pickup, Position])
            for (let i = 0; i < pickups.length; i++) {
                const eid = pickups[i]
                const dx = Position.x[eid] - px
                const dy = Position.y[eid] - py
                const dz = Position.z[eid] - pz
                if (dx * dx + dy * dy + dz * dz > radiusSq) continue

                const accepted = addToInventory(world, eid)
                if (!accepted) {
                    const fullMessage = 'Backpack is full.'
                    pushGameLog(world, { type: 'pickup', message: fullMessage, eid })
                    opts.notify?.(fullMessage)
                    continue  // leave the pickup in the world for later
                }

                const state = world.pickupByEid.get(eid)
                const message = state?.message ?? 'Picked up an item.'
                pushGameLog(world, { type: 'pickup', message, eid })
                opts.notify?.(message)
                despawnEntity(world, eid)
            }
        },
    }
}

/**
 * Try to deposit the pickup into the player's backpack. Returns true when
 * accepted (and the caller should despawn the world entity). Returns false
 * when the backpack is full, so the pickup stays in the world for a retry
 * once the player has freed a slot.
 */
function addToInventory(world: Parameters<System['update']>[0], eid: number): boolean {
    const state = world.pickupByEid.get(eid)
    if (state?.item) {
        const picked = addItemToBackpack(world, state.item)
        if (!picked) return false
        if (state.item.equipSlot || state.item.loadoutKind) {
            recomputePlayerStats(world)
        }
        return true
    }
    if (!hasComponent(world, eid, PickupValue)) return false

    const kind = PickupValue.kind[eid]
    const amount = PickupValue.amount[eid]
    if (kind === 1) return addItemToBackpack(world, createInventoryItem('gold', amount))
    if (kind === 2) return addItemToBackpack(world, createInventoryItem('health-potion', 1))
    if (kind === 3) return addItemToBackpack(world, createInventoryItem('arrows', Math.max(1, amount)))
    return false
}

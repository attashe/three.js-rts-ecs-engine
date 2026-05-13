import { hasComponent, query } from 'bitecs'
import { Pickup, PickupValue, PlayerControlled, Position } from '../components'
import { despawnEntity } from '../entity'
import { pushLog } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

/** Numeric kind codes stored in PickupValue.kind. Keep these stable —
 *  pickup-system + asset spawners + consumers all reference the same ids. */
export const PickupKind = {
    Gold: 1,
    Arrow: 2,
} as const

export interface PickupSystemOptions {
    /** Collection radius in world units. Default 0.9. */
    radius?: number
    /** Optional callback fired once per collected pickup, after the inventory
     *  mutation. Receives the numeric kind and stack amount. */
    onCollected?: (kind: number, amount: number) => void
}

/**
 * Proximity-based pickup collector. Every fixed step we walk the player's
 * AABB centre against every entity with `Pickup + Position` and, if within
 * `radius`, debit the entity into `world.inventory` and despawn it.
 *
 * Kind dispatch is intentionally small: gold + arrows only, no item registry.
 * Bring back the registry when the project grows an inventory UI.
 */
export function createPickupSystem(opts: PickupSystemOptions = {}): System {
    const radius = opts.radius ?? 0.9
    const radiusSq = radius * radius

    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world) {
            const players = query(world, [PlayerControlled, Position])
            if (players.length === 0) return
            const player = players[0]!
            const px = Position.x[player]
            const py = Position.y[player]
            const pz = Position.z[player]

            const pickups = query(world, [Pickup, Position])
            for (let i = 0; i < pickups.length; i++) {
                const eid = pickups[i]!
                const dx = Position.x[eid] - px
                const dy = Position.y[eid] - py
                const dz = Position.z[eid] - pz
                if (dx * dx + dy * dy + dz * dz > radiusSq) continue

                const kind = hasComponent(world, eid, PickupValue) ? PickupValue.kind[eid] : 0
                const amount = hasComponent(world, eid, PickupValue) ? PickupValue.amount[eid] : 0
                applyPickup(world, kind, amount)
                pushLog(world, formatPickupLog(kind, Math.max(1, amount)))
                opts.onCollected?.(kind, amount)
                despawnEntity(world, eid)
            }
        },
    }
}

function applyPickup(world: Parameters<System['update']>[0], kind: number, amount: number): void {
    const safeAmount = Math.max(1, amount)
    if (kind === PickupKind.Gold) world.inventory.gold += safeAmount
    else if (kind === PickupKind.Arrow) world.inventory.arrows += safeAmount
}

function formatPickupLog(kind: number, amount: number): string {
    if (kind === PickupKind.Gold) return `Picked up ${amount} gold.`
    if (kind === PickupKind.Arrow) return `Picked up ${amount === 1 ? 'an arrow' : `${amount} arrows`}.`
    return `Picked up something.`
}

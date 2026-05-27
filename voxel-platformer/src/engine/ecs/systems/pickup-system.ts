import { hasComponent, query } from 'bitecs'
import { Pickup, PickupValue, PlayerControlled, Position } from '../components'
import { despawnEntity } from '../entity'
import { pushLog, pushScriptTriggerEvent } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

/** Numeric kind codes stored in PickupValue.kind. Keep these stable —
 *  pickup-system + asset spawners + consumers all reference the same ids. */
export const PickupKind = {
    Gold: 1,
    Arrow: 2,
    ScriptItem: 3,
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
 * Kind dispatch is intentionally small: gold and arrows mutate inventory;
 * script-owned quest items emit `pickup-taken` metadata without entering a
 * general inventory registry.
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
                const safeAmount = Math.max(1, amount)
                const meta = world.pickupMetaByEid.get(eid)
                const scriptKind = meta?.kind ?? scriptPickupKind(kind)
                applyPickup(world, kind, amount)
                pushLog(world, formatPickupLog(kind, safeAmount, meta?.label))
                opts.onCollected?.(kind, amount)
                // Snapshot the pickup's position before despawn — the
                // entity is about to disappear and any subscriber
                // reading `event.position` would otherwise get
                // freed-slot garbage.
                if (scriptKind !== null) {
                    pushScriptTriggerEvent(world, {
                        kind: 'pickup-taken',
                        pickupKind: scriptKind,
                        pickupId: meta?.pickupId,
                        amount: safeAmount,
                        position: {
                            x: Position.x[eid] ?? 0,
                            y: Position.y[eid] ?? 0,
                            z: Position.z[eid] ?? 0,
                        },
                        entityId: eid,
                    })
                }
                world.pickupMetaByEid.delete(eid)
                if (meta?.pickupId && world.pickupEntityByScriptId.get(meta.pickupId) === eid) {
                    world.pickupEntityByScriptId.delete(meta.pickupId)
                }
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

/** Translate the numeric `PickupKind` code into the string form
 *  scripts use in `on('pickup-taken', { kind: 'coin' }, ...)`.
 *  Returns null for kinds the script layer doesn't yet expose so we
 *  don't spam the queue with `{ pickupKind: undefined }`. */
function scriptPickupKind(kind: number): string | null {
    if (kind === PickupKind.Gold) return 'coin'
    if (kind === PickupKind.Arrow) return 'arrow'
    return null
}

function formatPickupLog(kind: number, amount: number, label?: string): string {
    if (label) return `Picked up ${label}.`
    if (kind === PickupKind.Gold) return `Picked up ${amount} gold.`
    if (kind === PickupKind.Arrow) return `Picked up ${amount === 1 ? 'an arrow' : `${amount} arrows`}.`
    return `Picked up something.`
}

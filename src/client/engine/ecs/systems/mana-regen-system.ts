import { query } from 'bitecs'
import { PlayerControlled, PlayerResources } from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'

export interface ManaRegenOptions {
    /** Mana points regenerated per second. Default 4 — at maxMana 60 with
     *  Air Push (20) / High Jump (12), this puts spells on a 3–5 second
     *  rotation rather than letting them spam. */
    rate?: number
}

/**
 * Regenerates the player's mana over time, capped at PlayerResources.maxMana.
 * Independent of spell casting — runs every fixed step regardless of input.
 */
export function createManaRegenSystem(opts: ManaRegenOptions = {}): System {
    const rate = opts.rate ?? 4

    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world, dt) {
            const players = query(world, [PlayerControlled, PlayerResources])
            for (let i = 0; i < players.length; i++) {
                const eid = players[i]
                const cap = PlayerResources.maxMana[eid]
                if (cap <= 0) continue
                const next = PlayerResources.mana[eid] + rate * dt
                PlayerResources.mana[eid] = next > cap ? cap : next
            }
        },
    }
}

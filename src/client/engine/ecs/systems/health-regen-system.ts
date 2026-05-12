import { query } from 'bitecs'
import { Health, PlayerControlled } from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'

export interface HealthRegenOptions {
    /** Health points regenerated per second. Default 1 — slow enough that
     *  potions / heal-spell are still meaningful in combat, but fast enough
     *  to be noticeable between fights. */
    rate?: number
    /** If true, regen is paused for actors with current health == 0. Default
     *  true — corpses don't heal back to life. */
    skipDead?: boolean
}

/**
 * Passive health regeneration for the player. Independent of any active
 * heal spell. Capped at PlayerResources.maxHealth via `Health.max`.
 */
export function createHealthRegenSystem(opts: HealthRegenOptions = {}): System {
    const rate = opts.rate ?? 1
    const skipDead = opts.skipDead ?? true

    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world, dt) {
            const players = query(world, [PlayerControlled, Health])
            for (let i = 0; i < players.length; i++) {
                const eid = players[i]
                const cap = Health.max[eid]
                if (cap <= 0) continue
                const current = Health.current[eid]
                if (skipDead && current <= 0) continue
                const next = current + rate * dt
                Health.current[eid] = next > cap ? cap : next
            }
        },
    }
}

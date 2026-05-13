import type { System } from './system'
import { FixedOrder } from './orders'

/**
 * Reserved hook for FX/damage on hard impacts. The parent engine consumed
 * physics-system's `world.impactEvents` queue here and applied damage to
 * Health-bearing targets — the platformer foundation has neither queue nor
 * Health, so this is a no-op placeholder.
 *
 * To bring impact behaviour back:
 *   1. Re-add `impactEvents: ImpactEvent[]` to GameContext.
 *   2. Restore the publication branch in physics-system (search the file for
 *      "Hard-impact hook").
 *   3. Replace this body with the consumer logic.
 */
export function createImpactSystem(): System {
    return {
        fixed: true,
        order: FixedOrder.impacts,
        update() {
            // Intentionally empty.
        },
    }
}

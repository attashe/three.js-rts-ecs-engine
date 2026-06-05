import { hasComponent } from 'bitecs'
import { Health } from './components'
import type { GameWorld } from './world'

/**
 * Minimal combat helpers for the platformer's lean HP model.
 *
 * Deliberately no armor, resistances, or friendly-fire logic — who may hit whom
 * is decided by the caller (melee reach checks, script-set hostility). Most
 * characters carry 1–3 HP, so a hit or two is lethal.
 */

/** Subtract `amount` from an entity's Health, clamped at 0. Returns true if the
 *  hit dropped it to 0 (lethal). Entities without a Health component are
 *  unaffected and return false. */
export function applyDamage(world: GameWorld, eid: number, amount: number): boolean {
    if (!(amount > 0)) return false
    if (!hasComponent(world, eid, Health)) return false
    const next = Math.max(0, Health.current[eid]! - amount)
    Health.current[eid] = next
    return next <= 0
}

/** True once an entity with Health has been drained to 0. */
export function isDead(world: GameWorld, eid: number): boolean {
    return hasComponent(world, eid, Health) && Health.current[eid]! <= 0
}

/**
 * Heart granularity for the player health display. The numeric model stays in
 * integer HP — the heart HUD just renders `HP_PER_HEART` HP as one full heart,
 * so a `HALF_HEART` (1 HP) hit reads as half a heart. Damage values are tuned
 * in these units: the default attack deals `HALF_HEART`.
 */
export const HP_PER_HEART = 2
export const HALF_HEART = HP_PER_HEART / 2

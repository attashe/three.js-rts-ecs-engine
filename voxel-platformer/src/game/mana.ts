import { Mana } from '../engine/ecs/components'

export const MANA_PER_ORB = 2
export const PLAYER_DEFAULT_MAX_MANA = 4 * MANA_PER_ORB
export const MANA_POTION_ITEM_ID = 'mana-potion'
export const MANA_POTION_RESTORE = 2 * MANA_PER_ORB
export const HIGH_JUMP_MANA_COST = 1
export const AIR_PUSH_MANA_COST = 2

export interface ManaSnapshot {
    current: number
    max: number
}

export function initMana(eid: number, max = PLAYER_DEFAULT_MAX_MANA, current = max): void {
    const safeMax = normalizeManaAmount(max)
    Mana.max[eid] = safeMax
    Mana.current[eid] = clampManaAmount(current, safeMax)
}

export function readMana(eid: number): ManaSnapshot {
    const max = normalizeManaAmount(Mana.max[eid]!)
    return {
        current: clampManaAmount(Mana.current[eid]!, max),
        max,
    }
}

export function canSpendMana(eid: number, cost: number): boolean {
    const safeCost = normalizeManaAmount(cost)
    if (safeCost <= 0) return true
    const max = normalizeManaAmount(Mana.max[eid]!)
    return max > 0 && clampManaAmount(Mana.current[eid]!, max) >= safeCost
}

export function spendMana(eid: number, cost: number): boolean {
    const safeCost = normalizeManaAmount(cost)
    if (safeCost <= 0) return true
    if (!canSpendMana(eid, safeCost)) return false
    const max = normalizeManaAmount(Mana.max[eid]!)
    Mana.current[eid] = clampManaAmount(Mana.current[eid]! - safeCost, max)
    return true
}

export function restoreMana(eid: number, amount = Infinity): boolean {
    const max = normalizeManaAmount(Mana.max[eid]!)
    if (max <= 0) return false
    const current = clampManaAmount(Mana.current[eid]!, max)
    if (current >= max) return false
    const restored = Number.isFinite(amount)
        ? current + normalizeManaAmount(amount)
        : max
    const next = clampManaAmount(restored, max)
    if (next <= current) return false
    Mana.current[eid] = next
    return true
}

function normalizeManaAmount(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function clampManaAmount(value: number, max: number): number {
    if (!Number.isFinite(value)) return max
    return Math.max(0, Math.min(max, Math.floor(value)))
}

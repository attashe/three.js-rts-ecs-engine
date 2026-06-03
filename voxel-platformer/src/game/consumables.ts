import { query } from 'bitecs'
import { Health, Mana, PlayerControlled } from '../engine/ecs/components'
import { HP_PER_HEART } from '../engine/ecs/combat'
import { pushLog, type GameWorld } from '../engine/ecs/world'
import {
    copyInventoryItems,
    inventoryItemCount,
    removeInventoryItem,
    type InventoryIconId,
    type InventoryItemOptions,
    type InventorySnapshotItem,
} from './inventory'
import { MANA_POTION_ITEM_ID, MANA_POTION_RESTORE, restoreMana } from './mana'

export const HEAL_POTION_ITEM_ID = 'heal-potion'
export const FOOD_APPLE_ITEM_ID = 'food-apple'
export const FOOD_FISH_ITEM_ID = 'food-fish'
export const FOOD_MEAT_ITEM_ID = 'food-meat'
export const FOOD_PIE_ITEM_ID = 'food-pie'
export const DYNAMITE_ITEM_ID = 'dynamite'

export const FOOD_DELAY_SECONDS = 10
export const FOOD_RESTORE_HP = 1
export const PIE_RESTORE_MANA = 1

export type ConsumableUseKind = 'instant' | 'delayed' | 'throwable'

export interface ConsumableDefinition {
    id: string
    name: string
    description: string
    icon: InventoryIconId
    useKind: ConsumableUseKind
    restoreHp?: number
    restoreMana?: number
    delaySeconds?: number
}

const CONSUMABLE_DEF_DATA = {
    [HEAL_POTION_ITEM_ID]: {
        id: HEAL_POTION_ITEM_ID,
        name: 'Healing Potion',
        description: 'Restores one heart immediately.',
        icon: 'heal-potion',
        useKind: 'instant',
        restoreHp: HP_PER_HEART,
    },
    [MANA_POTION_ITEM_ID]: {
        id: MANA_POTION_ITEM_ID,
        name: 'Mana Potion',
        description: 'Restores two mana orbs immediately.',
        icon: 'mana-potion',
        useKind: 'instant',
        restoreMana: MANA_POTION_RESTORE,
    },
    [FOOD_APPLE_ITEM_ID]: {
        id: FOOD_APPLE_ITEM_ID,
        name: 'Apple',
        description: 'Restores a small amount of health after digestion.',
        icon: 'food-apple',
        useKind: 'delayed',
        restoreHp: FOOD_RESTORE_HP,
        delaySeconds: FOOD_DELAY_SECONDS,
    },
    [FOOD_FISH_ITEM_ID]: {
        id: FOOD_FISH_ITEM_ID,
        name: 'Cooked Fish',
        description: 'Restores a small amount of health after digestion.',
        icon: 'food-fish',
        useKind: 'delayed',
        restoreHp: FOOD_RESTORE_HP,
        delaySeconds: FOOD_DELAY_SECONDS,
    },
    [FOOD_MEAT_ITEM_ID]: {
        id: FOOD_MEAT_ITEM_ID,
        name: 'Rabbit Meat',
        description: 'Restores a small amount of health after digestion.',
        icon: 'food-meat',
        useKind: 'delayed',
        restoreHp: FOOD_RESTORE_HP,
        delaySeconds: FOOD_DELAY_SECONDS,
    },
    [FOOD_PIE_ITEM_ID]: {
        id: FOOD_PIE_ITEM_ID,
        name: 'Meat Pie',
        description: 'Restores a little health and mana after digestion.',
        icon: 'food-pie',
        useKind: 'delayed',
        restoreHp: FOOD_RESTORE_HP,
        restoreMana: PIE_RESTORE_MANA,
        delaySeconds: FOOD_DELAY_SECONDS,
    },
    [DYNAMITE_ITEM_ID]: {
        id: DYNAMITE_ITEM_ID,
        name: 'Dynamite',
        description: 'Select it, then press Z to throw a short-fuse explosive.',
        icon: 'dynamite',
        useKind: 'throwable',
    },
} as const satisfies Record<string, ConsumableDefinition>

export type ConsumableItemId = keyof typeof CONSUMABLE_DEF_DATA

export const CONSUMABLE_DEFS: Record<ConsumableItemId, ConsumableDefinition> = CONSUMABLE_DEF_DATA

export const CONSUMABLE_ITEM_IDS = Object.keys(CONSUMABLE_DEFS) as ConsumableItemId[]

export function isConsumableItemId(itemId: string): itemId is ConsumableItemId {
    return itemId in CONSUMABLE_DEFS
}

export function isDirectConsumableItemId(itemId: string): itemId is ConsumableItemId {
    return isConsumableItemId(itemId) && CONSUMABLE_DEFS[itemId].useKind !== 'throwable'
}

export function isThrowableConsumableItemId(itemId: string): itemId is ConsumableItemId {
    return isConsumableItemId(itemId) && CONSUMABLE_DEFS[itemId].useKind === 'throwable'
}

export function consumableItemOptions(itemId: ConsumableItemId): InventoryItemOptions {
    const def = CONSUMABLE_DEFS[itemId]
    return {
        name: def.name,
        description: def.description,
        category: 'consumables',
        icon: def.icon,
    }
}

export function consumableSnapshotItem(world: GameWorld, itemId: ConsumableItemId): InventorySnapshotItem {
    const def = CONSUMABLE_DEFS[itemId]
    return {
        id: itemId,
        quantity: inventoryItemCount(world.inventory.items, itemId),
        name: def.name,
        description: def.description,
        category: 'consumables',
        icon: def.icon,
    }
}

export function selectConsumable(world: GameWorld, itemId: string | null): boolean {
    if (itemId !== null && !isConsumableItemId(itemId)) return false
    if (world.selectedConsumable === itemId) return false
    world.selectedConsumable = itemId
    return true
}

export function ensureSelectedConsumable(world: GameWorld): ConsumableItemId | null {
    const selected = world.selectedConsumable
    if (selected && isConsumableItemId(selected) && inventoryItemCount(world.inventory.items, selected) > 0) {
        return selected
    }
    for (const itemId of CONSUMABLE_ITEM_IDS) {
        if (inventoryItemCount(world.inventory.items, itemId) > 0) {
            world.selectedConsumable = itemId
            return itemId
        }
    }
    world.selectedConsumable = null
    return null
}

export function consumeHealPotion(world: GameWorld): boolean {
    return consumeInstantConsumable(world, HEAL_POTION_ITEM_ID)
}

export function consumeManaPotion(world: GameWorld): boolean {
    return consumeInstantConsumable(world, MANA_POTION_ITEM_ID)
}

export function consumeDirectConsumable(world: GameWorld, itemId: string): boolean {
    if (!isDirectConsumableItemId(itemId)) return false
    const def = CONSUMABLE_DEFS[itemId]
    if (def.useKind === 'instant') return consumeInstantConsumable(world, itemId)
    return queueDelayedConsumable(world, itemId)
}

export function updateDelayedConsumables(world: GameWorld, dt: number): void {
    if (world.delayedConsumableEffects.length === 0) return
    const players = query(world, [PlayerControlled])
    if (players.length === 0) return
    const player = players[0]!
    for (let i = world.delayedConsumableEffects.length - 1; i >= 0; i--) {
        const effect = world.delayedConsumableEffects[i]!
        effect.remainingSeconds -= dt
        if (effect.remainingSeconds > 0) continue
        world.delayedConsumableEffects.splice(i, 1)
        let applied = false
        if ((effect.restoreHp ?? 0) > 0) applied = restoreHealth(player, effect.restoreHp!) || applied
        if ((effect.restoreMana ?? 0) > 0) applied = restoreMana(player, effect.restoreMana!) || applied
        pushLog(world, applied ? `${effect.name} takes effect.` : `${effect.name} fades with no effect.`)
    }
}

function consumeInstantConsumable(world: GameWorld, itemId: ConsumableItemId): boolean {
    const def = CONSUMABLE_DEFS[itemId]
    const players = query(world, [PlayerControlled])
    if (players.length === 0) return false
    const player = players[0]!
    if (inventoryItemCount(world.inventory.items, itemId) <= 0) return false
    let useful = false
    if ((def.restoreHp ?? 0) > 0 && canRestoreHealth(player)) useful = true
    if ((def.restoreMana ?? 0) > 0 && canRestoreMana(player)) useful = true
    if (!useful) return false
    if (!removeInventoryItem(world.inventory.items, itemId, 1)) return false
    if ((def.restoreHp ?? 0) > 0) restoreHealth(player, def.restoreHp!)
    if ((def.restoreMana ?? 0) > 0) restoreMana(player, def.restoreMana!)
    syncConsumableInventory(world)
    pushLog(world, `${def.name} used.`)
    ensureSelectedConsumable(world)
    return true
}

function queueDelayedConsumable(world: GameWorld, itemId: ConsumableItemId): boolean {
    const def = CONSUMABLE_DEFS[itemId]
    const players = query(world, [PlayerControlled])
    if (players.length === 0) return false
    if (inventoryItemCount(world.inventory.items, itemId) <= 0) return false
    if (!removeInventoryItem(world.inventory.items, itemId, 1)) return false
    world.delayedConsumableEffects.push({
        itemId,
        name: def.name,
        remainingSeconds: def.delaySeconds ?? FOOD_DELAY_SECONDS,
        restoreHp: def.restoreHp ?? 0,
        restoreMana: def.restoreMana ?? 0,
    })
    syncConsumableInventory(world)
    pushLog(world, `${def.name} eaten.`)
    ensureSelectedConsumable(world)
    return true
}

function restoreHealth(player: number, amount: number): boolean {
    const max = Health.max[player]!
    const current = Health.current[player]!
    if (!(max > 0) || current >= max) return false
    const next = Math.min(max, current + Math.max(0, amount))
    if (next <= current) return false
    Health.current[player] = next
    return true
}

function canRestoreHealth(player: number): boolean {
    return Health.max[player]! > 0 && Health.current[player]! < Health.max[player]!
}

function canRestoreMana(player: number): boolean {
    return Mana.max[player]! > 0 && Mana.current[player]! < Mana.max[player]!
}

export function syncConsumableInventory(world: GameWorld): void {
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)
}

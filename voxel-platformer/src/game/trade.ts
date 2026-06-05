import type {
    TradeInventorySnapshot,
    TradeItem,
    TradeMode,
    TradeRequest,
    TradeResource,
    TradeResult,
} from '../engine/script/types'
import {
    addInventoryItem,
    copyInventoryItems,
    inventoryItemCount,
    type InventoryItemMap,
    removeInventoryItem,
} from './inventory'
import { PLAYER_INVENTORY_LIMITS } from './player-settings'
import {
    BOOT_EQUIPMENT_ITEM_OPTIONS,
    HIGH_JUMP_BOOTS_ITEM_ID,
    isBootEquipmentItemId,
} from './high-jump-boots'
import {
    BUYABLE_EQUIPMENT_ITEM_OPTIONS,
    isBuyableEquipmentItemId,
} from './equipment-items'
import {
    CONSUMABLE_DEFS,
    consumableItemOptions,
    isConsumableItemId,
} from './consumables'

export interface NormalizedTradeItem {
    id: string
    name: string
    description?: string
    resource: TradeResource
    unitSize: number
    buyPrice?: number
    sellPrice?: number
    stock?: number
    disabled: boolean
}

export interface NormalizedTradeRequest {
    id?: string
    title?: string
    npc?: TradeRequest['npc']
    currency: 'gold'
    items: NormalizedTradeItem[]
}

export type TradeSelection =
    | { action: TradeMode; itemId: string; quantity: number }
    | { action: 'cancel' }

export interface TradeAvailability {
    enabled: boolean
    maxQuantity: number
    unitPrice: number | null
    reason?: string
}

export interface TradeInventoryLimits {
    gold: number
    arrows: number
    items: number
}

export const DEFAULT_TRADE_LIMITS: TradeInventoryLimits = {
    gold: PLAYER_INVENTORY_LIMITS.gold,
    arrows: PLAYER_INVENTORY_LIMITS.arrows,
    items: 999999,
}

export function normalizeTradeRequest(request: TradeRequest): NormalizedTradeRequest {
    const seen = new Set<string>()
    const items: NormalizedTradeItem[] = []
    const rawItems = Array.isArray(request.items) ? request.items : []
    for (const raw of rawItems) {
        const item = normalizeTradeItem(raw)
        if (!item || seen.has(item.id)) continue
        seen.add(item.id)
        items.push(item)
    }
    return {
        id: trimmedOrUndefined(request.id),
        title: trimmedOrUndefined(request.title),
        npc: request.npc,
        currency: 'gold',
        items,
    }
}

export function sanitizeTradeInventory(
    inventory: TradeInventorySnapshot,
    limits: TradeInventoryLimits = DEFAULT_TRADE_LIMITS,
): TradeInventorySnapshot {
    const out: TradeInventorySnapshot = {
        gold: clampInt(inventory.gold, 0, limits.gold),
        arrows: clampInt(inventory.arrows, 0, limits.arrows),
    }
    if (inventory.items !== undefined) out.items = copyInventoryItems(inventory.items)
    return out
}

export function tradeAvailability(
    item: NormalizedTradeItem,
    mode: TradeMode,
    inventory: TradeInventorySnapshot,
    limits: TradeInventoryLimits = DEFAULT_TRADE_LIMITS,
): TradeAvailability {
    const safeInventory = sanitizeTradeInventory(inventory, limits)
    if (item.disabled) return { enabled: false, maxQuantity: 0, unitPrice: null, reason: 'Item is unavailable.' }
    if (mode === 'buy') {
        if (item.buyPrice === undefined) {
            return { enabled: false, maxQuantity: 0, unitPrice: null, reason: 'This item is not for sale.' }
        }
        const byGold = item.buyPrice <= 0 ? Number.MAX_SAFE_INTEGER : Math.floor(safeInventory.gold / item.buyPrice)
        const byStock = item.stock ?? Number.MAX_SAFE_INTEGER
        const capacity = resourceCapacity(item.resource, safeInventory, limits)
        const byCapacity = Math.floor(capacity / item.unitSize)
        const maxQuantity = Math.max(0, Math.min(byGold, byStock, byCapacity))
        return {
            enabled: maxQuantity > 0,
            maxQuantity,
            unitPrice: item.buyPrice,
            reason: maxQuantity > 0 ? undefined : buyBlockReason(item, safeInventory, limits),
        }
    }

    if (item.sellPrice === undefined) {
        return { enabled: false, maxQuantity: 0, unitPrice: null, reason: 'This item cannot be sold here.' }
    }
    const owned = resourceAmount(item.resource, safeInventory)
    const byOwned = Math.floor(owned / item.unitSize)
    const goldCapacity = Math.max(0, limits.gold - safeInventory.gold)
    const byGoldCapacity = item.sellPrice <= 0 ? Number.MAX_SAFE_INTEGER : Math.floor(goldCapacity / item.sellPrice)
    const maxQuantity = Math.max(0, Math.min(byOwned, byGoldCapacity))
    return {
        enabled: maxQuantity > 0,
        maxQuantity,
        unitPrice: item.sellPrice,
        reason: maxQuantity > 0 ? undefined : sellBlockReason(item, safeInventory, limits),
    }
}

export function applyTradeSelection(
    request: NormalizedTradeRequest,
    inventory: TradeInventorySnapshot,
    selection: TradeSelection,
    limits: TradeInventoryLimits = DEFAULT_TRADE_LIMITS,
): TradeResult {
    const current = sanitizeTradeInventory(inventory, limits)
    if (selection.action === 'cancel') return { status: 'cancelled', inventory: current }

    const item = request.items.find((candidate) => candidate.id === selection.itemId)
    if (!item) return { status: 'unavailable', reason: 'Trade item was not found.', inventory: current }

    const quantity = Number.isFinite(selection.quantity) ? Math.floor(selection.quantity) : 0
    if (quantity <= 0) return { status: 'unavailable', reason: 'Trade quantity must be positive.', inventory: current }

    const availability = tradeAvailability(item, selection.action, current, limits)
    if (!availability.enabled || quantity > availability.maxQuantity || availability.unitPrice === null) {
        return {
            status: 'unavailable',
            reason: availability.reason ?? 'Trade is unavailable.',
            inventory: current,
        }
    }

    const resourceTotal = item.unitSize * quantity
    if (selection.action === 'buy') {
        const spentGold = availability.unitPrice * quantity
        const next = sanitizeTradeInventory({
            gold: current.gold - spentGold,
            arrows: item.resource === 'arrows' ? current.arrows + resourceTotal : current.arrows,
            items: tradeItemsAfterResourceChange(current, item.resource, resourceTotal),
        }, limits)
        return {
            status: 'bought',
            itemId: item.id,
            itemName: item.name,
            quantity,
            unitSize: item.unitSize,
            spent: { gold: spentGold },
            gained: { [item.resource]: resourceTotal },
            inventory: next,
        }
    }

    const gainedGold = availability.unitPrice * quantity
    const next = sanitizeTradeInventory({
        gold: current.gold + gainedGold,
        arrows: item.resource === 'arrows' ? current.arrows - resourceTotal : current.arrows,
        items: tradeItemsAfterResourceChange(current, item.resource, -resourceTotal),
    }, limits)
    return {
        status: 'sold',
        itemId: item.id,
        itemName: item.name,
        quantity,
        unitSize: item.unitSize,
        gained: { gold: gainedGold },
        removed: { [item.resource]: resourceTotal },
        inventory: next,
    }
}

export function resourceLabel(resource: TradeResource): string {
    switch (resource) {
        case 'arrows': return 'arrows'
        case HIGH_JUMP_BOOTS_ITEM_ID: return 'high jump boots'
        case 'high-speed-boots': return 'boots of high speed'
        default:
            if (isConsumableItemId(resource)) return CONSUMABLE_DEFS[resource].name.toLowerCase()
            if (isBuyableEquipmentItemId(resource)) return BUYABLE_EQUIPMENT_ITEM_OPTIONS[resource].name?.toLowerCase() ?? resource
            return resource
    }
}

function normalizeTradeItem(raw: TradeItem): NormalizedTradeItem | null {
    const id = trimmedOrUndefined(raw.id)
    const name = trimmedOrUndefined(raw.name)
    if (!id || !name) return null
    if (!isTradeResource(raw.resource)) return null
    return {
        id,
        name,
        description: trimmedOrUndefined(raw.description),
        resource: raw.resource,
        unitSize: positiveInt(raw.unitSize, 1),
        buyPrice: optionalNonNegativeInt(raw.buyPrice),
        sellPrice: optionalNonNegativeInt(raw.sellPrice),
        stock: optionalNonNegativeInt(raw.stock),
        disabled: raw.disabled === true,
    }
}

function isTradeResource(value: string): value is TradeResource {
    return value === 'arrows'
        || isConsumableItemId(value)
        || isBootEquipmentItemId(value)
        || isBuyableEquipmentItemId(value)
}

function resourceAmount(resource: TradeResource, inventory: TradeInventorySnapshot): number {
    switch (resource) {
        case 'arrows': return inventory.arrows
        case HIGH_JUMP_BOOTS_ITEM_ID: return inventoryItemCount(inventory.items, resource)
        case 'high-speed-boots': return inventoryItemCount(inventory.items, resource)
        default:
            if (isConsumableItemId(resource)) return inventoryItemCount(inventory.items, resource)
            if (isBuyableEquipmentItemId(resource)) return inventoryItemCount(inventory.items, resource)
            return 0
    }
}

function resourceCapacity(
    resource: TradeResource,
    inventory: TradeInventorySnapshot,
    limits: TradeInventoryLimits,
): number {
    switch (resource) {
        case 'arrows': return Math.max(0, limits.arrows - inventory.arrows)
        case HIGH_JUMP_BOOTS_ITEM_ID: return Math.max(0, 1 - inventoryItemCount(inventory.items, resource))
        case 'high-speed-boots': return Math.max(0, 1 - inventoryItemCount(inventory.items, resource))
        default:
            if (isConsumableItemId(resource)) return Math.max(0, limits.items - inventoryItemCount(inventory.items, resource))
            if (isBuyableEquipmentItemId(resource)) return Math.max(0, 1 - inventoryItemCount(inventory.items, resource))
            return 0
    }
}

function tradeItemsAfterResourceChange(
    inventory: TradeInventorySnapshot,
    resource: TradeResource,
    delta: number,
): InventoryItemMap | undefined {
    if (!isConsumableItemId(resource) && !isBootEquipmentItemId(resource) && !isBuyableEquipmentItemId(resource)) {
        return inventory.items === undefined ? undefined : copyInventoryItems(inventory.items)
    }
    const items = copyInventoryItems(inventory.items)
    if (delta > 0) {
        const options = isConsumableItemId(resource)
            ? consumableItemOptions(resource)
            : isBootEquipmentItemId(resource)
                ? BOOT_EQUIPMENT_ITEM_OPTIONS[resource]
                : BUYABLE_EQUIPMENT_ITEM_OPTIONS[resource]
        addInventoryItem(items, resource, delta, options)
    } else if (delta < 0) {
        removeInventoryItem(items, resource, -delta)
    }
    return items
}

function buyBlockReason(
    item: NormalizedTradeItem,
    inventory: TradeInventorySnapshot,
    limits: TradeInventoryLimits,
): string {
    if (item.stock !== undefined && item.stock <= 0) return 'Sold out.'
    if (item.buyPrice !== undefined && item.buyPrice > inventory.gold) return 'Not enough gold.'
    if (resourceCapacity(item.resource, inventory, limits) < item.unitSize) return `No room for more ${resourceLabel(item.resource)}.`
    return 'Trade is unavailable.'
}

function sellBlockReason(
    item: NormalizedTradeItem,
    inventory: TradeInventorySnapshot,
    limits: TradeInventoryLimits,
): string {
    if (resourceAmount(item.resource, inventory) < item.unitSize) return `You do not have enough ${resourceLabel(item.resource)}.`
    if (item.sellPrice !== undefined && item.sellPrice > 0 && inventory.gold >= limits.gold) return 'No room for more gold.'
    return 'Trade is unavailable.'
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
}

function positiveInt(value: number | undefined, fallback: number): number {
    if (!Number.isFinite(value)) return fallback
    return Math.max(1, Math.floor(value as number))
}

function optionalNonNegativeInt(value: number | undefined): number | undefined {
    if (!Number.isFinite(value)) return undefined
    return Math.max(0, Math.floor(value as number))
}

function clampInt(value: number, min: number, max: number): number {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : min
}

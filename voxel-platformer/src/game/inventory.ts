export const INVENTORY_CATEGORIES = [
    'resources',
    'quest',
    'consumables',
    'accessories',
    'tools',
] as const

export type InventoryCategoryId = (typeof INVENTORY_CATEGORIES)[number]

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategoryId, string> = {
    resources: 'Resources',
    quest: 'Quest Items',
    consumables: 'Consumables',
    accessories: 'Accessories',
    tools: 'Tools',
}

export type InventoryIconId =
    | 'gold'
    | 'arrows'
    | 'quest-shard'
    | 'consumable'
    | 'accessory'
    | 'tool'
    | 'item'

export interface InventoryItemRecord {
    quantity: number
    name?: string
    description?: string
    category?: InventoryCategoryId
    icon?: InventoryIconId
}

export type InventoryItemMap = Record<string, InventoryItemRecord>

export interface InventoryItemOptions {
    name?: string
    description?: string
    category?: InventoryCategoryId
    icon?: InventoryIconId
}

export interface InventorySnapshotItem {
    id: string
    quantity: number
    name: string
    description?: string
    category: InventoryCategoryId
    icon: InventoryIconId
}

export function normalizeInventoryItems(input: unknown): InventoryItemMap {
    if (!input || typeof input !== 'object') return {}
    const out: InventoryItemMap = {}
    for (const [rawId, rawValue] of Object.entries(input as Record<string, unknown>)) {
        const id = normalizeInventoryItemId(rawId)
        if (!id) continue
        const record = normalizeInventoryItemRecord(rawValue, id)
        if (record) out[id] = record
    }
    return out
}

export function copyInventoryItems(items: InventoryItemMap | undefined): InventoryItemMap {
    const normalized = normalizeInventoryItems(items)
    const out: InventoryItemMap = {}
    for (const [id, item] of Object.entries(normalized)) {
        out[id] = { ...item }
    }
    return out
}

export function addInventoryItem(
    items: InventoryItemMap,
    itemId: string,
    quantity = 1,
    opts: InventoryItemOptions = {},
): boolean {
    const id = normalizeInventoryItemId(itemId)
    const amount = normalizeQuantity(quantity)
    if (!id || amount <= 0) return false
    const current = items[id]
    const next: InventoryItemRecord = current
        ? { ...current, quantity: clampQuantity(current.quantity + amount) }
        : { quantity: amount }
    applyItemOptions(next, opts)
    if (!next.category) next.category = defaultInventoryCategory(id)
    if (!next.icon) next.icon = defaultInventoryIcon(id, next.category)
    items[id] = next
    return true
}

export function removeInventoryItem(items: InventoryItemMap, itemId: string, quantity = 1): boolean {
    const id = normalizeInventoryItemId(itemId)
    const amount = normalizeQuantity(quantity)
    if (!id || amount <= 0) return false
    const current = items[id]
    if (!current || current.quantity < amount) return false
    const remaining = current.quantity - amount
    if (remaining <= 0) {
        delete items[id]
    } else {
        items[id] = { ...current, quantity: remaining }
    }
    return true
}

export function inventoryItemCount(items: InventoryItemMap | undefined, itemId: string): number {
    const id = normalizeInventoryItemId(itemId)
    if (!id || !items) return 0
    return items[id]?.quantity ?? 0
}

export function hasInventoryItem(
    items: InventoryItemMap | undefined,
    itemId: string,
    quantity = 1,
): boolean {
    return inventoryItemCount(items, itemId) >= normalizeQuantity(quantity)
}

export function listInventoryItems(
    items: InventoryItemMap | undefined,
    category?: InventoryCategoryId,
): InventorySnapshotItem[] {
    const normalized = normalizeInventoryItems(items)
    return Object.entries(normalized)
        .map(([id, item]) => snapshotInventoryItem(id, item))
        .filter((item) => category === undefined || item.category === category)
        .sort(compareInventoryItems)
}

export function normalizeInventoryItemId(raw: string): string {
    return raw.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

export function defaultInventoryCategory(itemId: string): InventoryCategoryId {
    if (itemId === 'arrow' || itemId === 'arrows' || itemId === 'gold' || itemId === 'coin') return 'resources'
    if (itemId.includes('potion') || itemId.includes('food')) return 'consumables'
    if (itemId.includes('charm') || itemId.includes('ring') || itemId.includes('amulet')) return 'accessories'
    if (itemId.includes('key') || itemId.includes('tool')) return 'tools'
    return 'quest'
}

export function defaultInventoryIcon(itemId: string, category = defaultInventoryCategory(itemId)): InventoryIconId {
    if (itemId === 'gold' || itemId === 'coin') return 'gold'
    if (itemId === 'arrow' || itemId === 'arrows') return 'arrows'
    if (itemId.includes('shard') || category === 'quest') return 'quest-shard'
    if (category === 'consumables') return 'consumable'
    if (category === 'accessories') return 'accessory'
    if (category === 'tools') return 'tool'
    return 'item'
}

export function defaultInventoryItemName(itemId: string): string {
    return itemId
        .split(/[-_.\s]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || 'Item'
}

function normalizeInventoryItemRecord(raw: unknown, itemId: string): InventoryItemRecord | null {
    const record = typeof raw === 'number'
        ? { quantity: raw }
        : raw && typeof raw === 'object'
            ? raw as Partial<InventoryItemRecord>
            : null
    if (!record) return null
    const quantity = normalizeQuantity(record.quantity)
    if (quantity <= 0) return null
    const category = isInventoryCategory(record.category) ? record.category : defaultInventoryCategory(itemId)
    const icon = isInventoryIcon(record.icon) ? record.icon : defaultInventoryIcon(itemId, category)
    const out: InventoryItemRecord = {
        quantity,
        category,
        icon,
    }
    const name = sanitizeText(record.name)
    const description = sanitizeText(record.description)
    if (name) out.name = name
    if (description) out.description = description
    return out
}

function snapshotInventoryItem(id: string, item: InventoryItemRecord): InventorySnapshotItem {
    const category = item.category ?? defaultInventoryCategory(id)
    return {
        id,
        quantity: item.quantity,
        name: item.name ?? defaultInventoryItemName(id),
        description: item.description,
        category,
        icon: item.icon ?? defaultInventoryIcon(id, category),
    }
}

function compareInventoryItems(a: InventorySnapshotItem, b: InventorySnapshotItem): number {
    const categoryOrder = INVENTORY_CATEGORIES.indexOf(a.category) - INVENTORY_CATEGORIES.indexOf(b.category)
    if (categoryOrder !== 0) return categoryOrder
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
}

function applyItemOptions(record: InventoryItemRecord, opts: InventoryItemOptions): void {
    const name = sanitizeText(opts.name)
    const description = sanitizeText(opts.description)
    if (name) record.name = name
    if (description) record.description = description
    if (isInventoryCategory(opts.category)) record.category = opts.category
    if (isInventoryIcon(opts.icon)) record.icon = opts.icon
}

function normalizeQuantity(value: unknown): number {
    const n = Number(value)
    if (!Number.isFinite(n)) return 1
    return clampQuantity(Math.floor(n))
}

function clampQuantity(value: number): number {
    return Math.max(0, Math.min(999999, value))
}

function sanitizeText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

function isInventoryCategory(value: unknown): value is InventoryCategoryId {
    return typeof value === 'string' && (INVENTORY_CATEGORIES as readonly string[]).includes(value)
}

function isInventoryIcon(value: unknown): value is InventoryIconId {
    return typeof value === 'string' && [
        'gold',
        'arrows',
        'quest-shard',
        'consumable',
        'accessory',
        'tool',
        'item',
    ].includes(value)
}

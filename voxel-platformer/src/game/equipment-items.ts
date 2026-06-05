import type { HandEquipmentKind, HeadEquipmentKind } from './anim/equipment-types'
import { EQUIPMENT_LABELS } from './anim/equipment-types'
import type { InventoryItemOptions } from './inventory'

export const SWORD_ITEM_ID = 'sword' satisfies HandEquipmentKind
export const SPEAR_ITEM_ID = 'spear' satisfies HandEquipmentKind
export const METAL_HELMET_ITEM_ID = 'metal-helmet' satisfies HeadEquipmentKind
export const SNIPER_HAT_ITEM_ID = 'hat-sniper' satisfies HeadEquipmentKind

export const INVENTORY_HAND_EQUIPMENT_ITEM_IDS = [
    SWORD_ITEM_ID,
    SPEAR_ITEM_ID,
] as const satisfies readonly HandEquipmentKind[]

export type InventoryHandEquipmentItemId = (typeof INVENTORY_HAND_EQUIPMENT_ITEM_IDS)[number]

export const BUYABLE_HEAD_EQUIPMENT_ITEM_IDS = [
    'hat-arcane',
    'hat-ranger',
    SNIPER_HAT_ITEM_ID,
    'hat-sun',
    METAL_HELMET_ITEM_ID,
] as const satisfies readonly HeadEquipmentKind[]

export type BuyableHeadEquipmentItemId = (typeof BUYABLE_HEAD_EQUIPMENT_ITEM_IDS)[number]

export const BUYABLE_HAND_EQUIPMENT_ITEM_IDS = [
    SPEAR_ITEM_ID,
] as const satisfies readonly HandEquipmentKind[]

export type BuyableHandEquipmentItemId = (typeof BUYABLE_HAND_EQUIPMENT_ITEM_IDS)[number]
export type BuyableEquipmentItemId = BuyableHeadEquipmentItemId | BuyableHandEquipmentItemId

export const BUYABLE_EQUIPMENT_ITEM_IDS = [
    ...BUYABLE_HEAD_EQUIPMENT_ITEM_IDS,
    ...BUYABLE_HAND_EQUIPMENT_ITEM_IDS,
] as const satisfies readonly BuyableEquipmentItemId[]

export const BUYABLE_EQUIPMENT_ITEM_OPTIONS: Record<BuyableEquipmentItemId, InventoryItemOptions> = {
    'hat-arcane': {
        name: EQUIPMENT_LABELS['hat-arcane'],
        description: 'A tall spellcaster hat for the head slot.',
        category: 'accessories',
        icon: 'hat-arcane',
    },
    'hat-ranger': {
        name: EQUIPMENT_LABELS['hat-ranger'],
        description: 'A green ranger cap that helps arrows fly farther.',
        category: 'accessories',
        icon: 'hat-ranger',
    },
    [SNIPER_HAT_ITEM_ID]: {
        name: EQUIPMENT_LABELS[SNIPER_HAT_ITEM_ID],
        description: 'A sighted cap that reveals arrow trajectory and impact point.',
        category: 'accessories',
        icon: 'hat-sniper',
    },
    'hat-sun': {
        name: EQUIPMENT_LABELS['hat-sun'],
        description: 'A bright ceremonial crown for the head slot.',
        category: 'accessories',
        icon: 'hat-sun',
    },
    [METAL_HELMET_ITEM_ID]: {
        name: EQUIPMENT_LABELS[METAL_HELMET_ITEM_ID],
        description: 'A practical iron helmet with a 30% chance to block attack damage.',
        category: 'accessories',
        icon: 'metal-helmet',
    },
    [SPEAR_ITEM_ID]: {
        name: EQUIPMENT_LABELS[SPEAR_ITEM_ID],
        description: 'A long thrusting weapon. Equip it from Tools.',
        category: 'tools',
        icon: 'spear',
    },
}

export const INVENTORY_HAND_EQUIPMENT_ITEM_OPTIONS: Record<InventoryHandEquipmentItemId, InventoryItemOptions> = {
    [SWORD_ITEM_ID]: {
        name: EQUIPMENT_LABELS[SWORD_ITEM_ID],
        description: 'A reliable short sword. Equip it from Tools.',
        category: 'tools',
        icon: 'sword',
    },
    [SPEAR_ITEM_ID]: BUYABLE_EQUIPMENT_ITEM_OPTIONS[SPEAR_ITEM_ID],
}

export function isBuyableHeadEquipmentItemId(value: unknown): value is BuyableHeadEquipmentItemId {
    return (BUYABLE_HEAD_EQUIPMENT_ITEM_IDS as readonly string[]).includes(String(value))
}

export function isBuyableHandEquipmentItemId(value: unknown): value is BuyableHandEquipmentItemId {
    return (BUYABLE_HAND_EQUIPMENT_ITEM_IDS as readonly string[]).includes(String(value))
}

export function isBuyableEquipmentItemId(value: unknown): value is BuyableEquipmentItemId {
    return isBuyableHeadEquipmentItemId(value) || isBuyableHandEquipmentItemId(value)
}

export function isInventoryHandEquipmentItemId(value: unknown): value is InventoryHandEquipmentItemId {
    return (INVENTORY_HAND_EQUIPMENT_ITEM_IDS as readonly string[]).includes(String(value))
}

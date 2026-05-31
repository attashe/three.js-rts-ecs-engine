import type { EquipSlot } from '../../engine/anim'

export const EQUIPMENT_KINDS = [
    'hat',
    'hat-arcane',
    'hat-ranger',
    'hat-guard',
    'hat-sun',
    'sword',
    'shield',
    'bow',
    'arrow',
    'staff-lantern',
    'staff',
    'staff-crystal',
    'book',
] as const

export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

export const HEAD_EQUIPMENT_KINDS = [
    'hat',
    'hat-arcane',
    'hat-ranger',
    'hat-guard',
    'hat-sun',
] as const satisfies readonly EquipmentKind[]

export type HeadEquipmentKind = (typeof HEAD_EQUIPMENT_KINDS)[number]

export const HAND_EQUIPMENT_KINDS = [
    'sword',
    'shield',
    'bow',
    'arrow',
    'staff-lantern',
    'staff',
    'staff-crystal',
    'book',
] as const satisfies readonly EquipmentKind[]

export type HandEquipmentKind = (typeof HAND_EQUIPMENT_KINDS)[number]

export const STAFF_EQUIPMENT_KINDS = [
    'staff-lantern',
    'staff',
    'staff-crystal',
] as const satisfies readonly EquipmentKind[]

export type StaffEquipmentKind = (typeof STAFF_EQUIPMENT_KINDS)[number]

export const EQUIPMENT_LABELS: Record<EquipmentKind, string> = {
    hat: 'Traveler Hat',
    'hat-arcane': 'Arcane Hat',
    'hat-ranger': 'Ranger Cap',
    'hat-guard': 'Guard Helm',
    'hat-sun': 'Sun Crown',
    sword: 'Sword',
    shield: 'Shield',
    bow: 'Bow',
    arrow: 'Arrow',
    'staff-lantern': 'Staff A - Lantern',
    staff: 'Staff B - Battle',
    'staff-crystal': 'Staff C - Crystal',
    book: 'Book',
}

export type HandEquipmentSlot = Extract<EquipSlot, 'handR' | 'handL'>

export interface EquipmentHandLoadout {
    handR: HandEquipmentKind | null
    handL: HandEquipmentKind | null
}

export interface PlayerEquipmentSettings {
    head: HeadEquipmentKind | null
    melee: EquipmentHandLoadout
    ranged: EquipmentHandLoadout
    magic: EquipmentHandLoadout
}

export const EMPTY_HAND_LOADOUT: EquipmentHandLoadout = {
    handR: null,
    handL: null,
}

export const DEFAULT_PLAYER_EQUIPMENT: PlayerEquipmentSettings = {
    head: 'hat',
    melee: {
        handR: 'sword',
        handL: 'shield',
    },
    ranged: {
        handR: 'arrow',
        handL: 'bow',
    },
    magic: {
        handR: 'staff',
        handL: null,
    },
}

export function copyHandLoadout(loadout: EquipmentHandLoadout): EquipmentHandLoadout {
    return {
        handR: normalizeHandEquipmentKind(loadout.handR),
        handL: normalizeHandEquipmentKind(loadout.handL),
    }
}

export function normalizeHandLoadout(
    input: Partial<EquipmentHandLoadout> | null | undefined,
    fallback: EquipmentHandLoadout = EMPTY_HAND_LOADOUT,
): EquipmentHandLoadout {
    return {
        handR: normalizeHandEquipmentKind(input?.handR, fallback.handR),
        handL: normalizeHandEquipmentKind(input?.handL, fallback.handL),
    }
}

export function normalizePlayerEquipment(input?: {
    head?: unknown
    melee?: Partial<EquipmentHandLoadout> | null
    ranged?: Partial<EquipmentHandLoadout> | null
    magic?: Partial<EquipmentHandLoadout> | null
} | null): PlayerEquipmentSettings {
    return {
        head: normalizeHeadEquipmentKind(input?.head, DEFAULT_PLAYER_EQUIPMENT.head),
        melee: normalizeHandLoadout(input?.melee, DEFAULT_PLAYER_EQUIPMENT.melee),
        ranged: normalizeHandLoadout(input?.ranged, DEFAULT_PLAYER_EQUIPMENT.ranged),
        magic: normalizeHandLoadout(input?.magic, DEFAULT_PLAYER_EQUIPMENT.magic),
    }
}

export function copyPlayerEquipment(settings?: {
    head?: unknown
    melee?: Partial<EquipmentHandLoadout> | null
    ranged?: Partial<EquipmentHandLoadout> | null
    magic?: Partial<EquipmentHandLoadout> | null
} | null): PlayerEquipmentSettings {
    return normalizePlayerEquipment(settings)
}

export function normalizeHandEquipmentKind(
    value: unknown,
    fallback: HandEquipmentKind | null = null,
): HandEquipmentKind | null {
    if (value === undefined) return fallback
    if (value === null || value === '' || value === 'none') return null
    return (HAND_EQUIPMENT_KINDS as readonly string[]).includes(String(value))
        ? value as HandEquipmentKind
        : fallback
}

export function normalizeHeadEquipmentKind(
    value: unknown,
    fallback: HeadEquipmentKind | null = null,
): HeadEquipmentKind | null {
    if (value === undefined) return fallback
    if (value === null || value === '' || value === 'none') return null
    return (HEAD_EQUIPMENT_KINDS as readonly string[]).includes(String(value))
        ? value as HeadEquipmentKind
        : fallback
}

export function isStaffEquipmentKind(value: unknown): value is StaffEquipmentKind {
    return (STAFF_EQUIPMENT_KINDS as readonly string[]).includes(String(value))
}

export function handLoadoutKey(loadout: EquipmentHandLoadout): string {
    return `${loadout.handR ?? '-'}:${loadout.handL ?? '-'}`
}

export function playerEquipmentKey(settings: PlayerEquipmentSettings): string {
    return `${settings.head ?? '-'}|${handLoadoutKey(settings.melee)}|${handLoadoutKey(settings.ranged)}|${handLoadoutKey(settings.magic)}`
}

export function describeHandLoadout(loadout: EquipmentHandLoadout): string {
    const items: string[] = []
    if (loadout.handR) items.push(EQUIPMENT_LABELS[loadout.handR].toLowerCase())
    if (loadout.handL && loadout.handL !== loadout.handR) items.push(EQUIPMENT_LABELS[loadout.handL].toLowerCase())
    if (items.length === 0) return 'empty hands'
    return items.join(' & ')
}

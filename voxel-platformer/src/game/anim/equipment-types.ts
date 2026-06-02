import type { EquipSlot } from '../../engine/anim'
import { HIGH_JUMP_BOOTS_ITEM_ID, HIGH_SPEED_BOOTS_ITEM_ID } from '../high-jump-boots'

export const EQUIPMENT_KINDS = [
    'hat',
    'hat-arcane',
    'hat-ranger',
    'hat-guard',
    'hat-sun',
    'metal-helmet',
    'sword',
    'spear',
    'shield',
    'bow',
    'arrow',
    'staff-lantern',
    'staff',
    'staff-crystal',
    'battle-hammer',
    'book',
    HIGH_JUMP_BOOTS_ITEM_ID,
    HIGH_SPEED_BOOTS_ITEM_ID,
] as const

export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

export const HEAD_EQUIPMENT_KINDS = [
    'hat',
    'hat-arcane',
    'hat-ranger',
    'hat-guard',
    'hat-sun',
    'metal-helmet',
] as const satisfies readonly EquipmentKind[]

export type HeadEquipmentKind = (typeof HEAD_EQUIPMENT_KINDS)[number]

export const HAND_EQUIPMENT_KINDS = [
    'sword',
    'spear',
    'shield',
    'bow',
    'arrow',
    'staff-lantern',
    'staff',
    'staff-crystal',
    'battle-hammer',
    'book',
] as const satisfies readonly EquipmentKind[]

export type HandEquipmentKind = (typeof HAND_EQUIPMENT_KINDS)[number]

export const STAFF_EQUIPMENT_KINDS = [
    'staff-lantern',
    'staff',
    'staff-crystal',
] as const satisfies readonly EquipmentKind[]

export type StaffEquipmentKind = (typeof STAFF_EQUIPMENT_KINDS)[number]

export const HAMMER_EQUIPMENT_KINDS = [
    'battle-hammer',
] as const satisfies readonly EquipmentKind[]

export type HammerEquipmentKind = (typeof HAMMER_EQUIPMENT_KINDS)[number]

export const SPEAR_EQUIPMENT_KINDS = [
    'spear',
] as const satisfies readonly EquipmentKind[]

export type SpearEquipmentKind = (typeof SPEAR_EQUIPMENT_KINDS)[number]

export const BOOT_EQUIPMENT_KINDS = [
    HIGH_JUMP_BOOTS_ITEM_ID,
    HIGH_SPEED_BOOTS_ITEM_ID,
] as const satisfies readonly EquipmentKind[]

export type BootEquipmentKind = (typeof BOOT_EQUIPMENT_KINDS)[number]

export const EQUIPMENT_LABELS: Record<EquipmentKind, string> = {
    hat: 'Traveler Hat',
    'hat-arcane': 'Arcane Hat',
    'hat-ranger': 'Ranger Cap',
    'hat-guard': 'Guard Helm',
    'hat-sun': 'Sun Crown',
    'metal-helmet': 'Metal Helmet',
    sword: 'Sword',
    spear: 'Spear',
    shield: 'Shield',
    bow: 'Bow',
    arrow: 'Arrow',
    'staff-lantern': 'Staff A - Lantern',
    staff: 'Staff B - Battle',
    'staff-crystal': 'Staff C - Crystal',
    'battle-hammer': 'Battle Hammer',
    book: 'Book',
    [HIGH_JUMP_BOOTS_ITEM_ID]: 'High Jump Boots',
    [HIGH_SPEED_BOOTS_ITEM_ID]: 'Boots of High Speed',
}

export type HandEquipmentSlot = Extract<EquipSlot, 'handR' | 'handL'>

export interface EquipmentHandLoadout {
    handR: HandEquipmentKind | null
    handL: HandEquipmentKind | null
}

export interface PlayerEquipmentSettings {
    head: HeadEquipmentKind | null
    boots: BootEquipmentKind | null
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
    boots: null,
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
    boots?: unknown
    melee?: Partial<EquipmentHandLoadout> | null
    ranged?: Partial<EquipmentHandLoadout> | null
    magic?: Partial<EquipmentHandLoadout> | null
} | null): PlayerEquipmentSettings {
    return {
        head: normalizeHeadEquipmentKind(input?.head, DEFAULT_PLAYER_EQUIPMENT.head),
        boots: normalizeBootEquipmentKind(input?.boots, DEFAULT_PLAYER_EQUIPMENT.boots),
        melee: normalizeHandLoadout(input?.melee, DEFAULT_PLAYER_EQUIPMENT.melee),
        ranged: normalizeHandLoadout(input?.ranged, DEFAULT_PLAYER_EQUIPMENT.ranged),
        magic: normalizeHandLoadout(input?.magic, DEFAULT_PLAYER_EQUIPMENT.magic),
    }
}

export function copyPlayerEquipment(settings?: {
    head?: unknown
    boots?: unknown
    melee?: Partial<EquipmentHandLoadout> | null
    ranged?: Partial<EquipmentHandLoadout> | null
    magic?: Partial<EquipmentHandLoadout> | null
} | null): PlayerEquipmentSettings {
    return normalizePlayerEquipment(settings)
}

export function normalizeBootEquipmentKind(
    value: unknown,
    fallback: BootEquipmentKind | null = null,
): BootEquipmentKind | null {
    if (value === undefined) return fallback
    if (value === null || value === '' || value === 'none') return null
    return (BOOT_EQUIPMENT_KINDS as readonly string[]).includes(String(value))
        ? value as BootEquipmentKind
        : fallback
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

export function isHammerEquipmentKind(value: unknown): value is HammerEquipmentKind {
    return (HAMMER_EQUIPMENT_KINDS as readonly string[]).includes(String(value))
}

export function isSpearEquipmentKind(value: unknown): value is SpearEquipmentKind {
    return (SPEAR_EQUIPMENT_KINDS as readonly string[]).includes(String(value))
}

/** A bow in either hand drives the ranged `shoot` attack clip. */
export function isBowEquipmentKind(value: unknown): value is 'bow' {
    return value === 'bow'
}

export function handLoadoutKey(loadout: EquipmentHandLoadout): string {
    return `${loadout.handR ?? '-'}:${loadout.handL ?? '-'}`
}

export function playerEquipmentKey(settings: PlayerEquipmentSettings): string {
    return `${settings.head ?? '-'}|${settings.boots ?? '-'}|${handLoadoutKey(settings.melee)}|${handLoadoutKey(settings.ranged)}|${handLoadoutKey(settings.magic)}`
}

export function describeHandLoadout(loadout: EquipmentHandLoadout): string {
    const items: string[] = []
    if (loadout.handR) items.push(EQUIPMENT_LABELS[loadout.handR].toLowerCase())
    if (loadout.handL && loadout.handL !== loadout.handR) items.push(EQUIPMENT_LABELS[loadout.handL].toLowerCase())
    if (items.length === 0) return 'empty hands'
    return items.join(' & ')
}

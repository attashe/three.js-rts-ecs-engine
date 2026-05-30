import type { EquipSlot } from '../../engine/anim'

export const EQUIPMENT_KINDS = [
    'hat',
    'sword',
    'shield',
    'bow',
    'staff',
    'book',
] as const

export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number]

export const HAND_EQUIPMENT_KINDS = [
    'sword',
    'shield',
    'bow',
    'staff',
    'book',
] as const satisfies readonly EquipmentKind[]

export type HandEquipmentKind = (typeof HAND_EQUIPMENT_KINDS)[number]

export const EQUIPMENT_LABELS: Record<EquipmentKind, string> = {
    hat: 'Hat',
    sword: 'Sword',
    shield: 'Shield',
    bow: 'Bow',
    staff: 'Staff',
    book: 'Book',
}

export type HandEquipmentSlot = Extract<EquipSlot, 'handR' | 'handL'>

export interface EquipmentHandLoadout {
    handR: HandEquipmentKind | null
    handL: HandEquipmentKind | null
}

export interface PlayerEquipmentSettings {
    melee: EquipmentHandLoadout
    ranged: EquipmentHandLoadout
}

export const EMPTY_HAND_LOADOUT: EquipmentHandLoadout = {
    handR: null,
    handL: null,
}

export const DEFAULT_PLAYER_EQUIPMENT: PlayerEquipmentSettings = {
    melee: {
        handR: 'sword',
        handL: 'shield',
    },
    ranged: {
        handR: null,
        handL: 'bow',
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
    melee?: Partial<EquipmentHandLoadout> | null
    ranged?: Partial<EquipmentHandLoadout> | null
} | null): PlayerEquipmentSettings {
    return {
        melee: normalizeHandLoadout(input?.melee, DEFAULT_PLAYER_EQUIPMENT.melee),
        ranged: normalizeHandLoadout(input?.ranged, DEFAULT_PLAYER_EQUIPMENT.ranged),
    }
}

export function copyPlayerEquipment(settings?: {
    melee?: Partial<EquipmentHandLoadout> | null
    ranged?: Partial<EquipmentHandLoadout> | null
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

export function handLoadoutKey(loadout: EquipmentHandLoadout): string {
    return `${loadout.handR ?? '-'}:${loadout.handL ?? '-'}`
}

export function playerEquipmentKey(settings: PlayerEquipmentSettings): string {
    return `${handLoadoutKey(settings.melee)}|${handLoadoutKey(settings.ranged)}`
}

export function describeHandLoadout(loadout: EquipmentHandLoadout): string {
    const items: string[] = []
    if (loadout.handR) items.push(EQUIPMENT_LABELS[loadout.handR].toLowerCase())
    if (loadout.handL && loadout.handL !== loadout.handR) items.push(EQUIPMENT_LABELS[loadout.handL].toLowerCase())
    if (items.length === 0) return 'empty hands'
    return items.join(' & ')
}

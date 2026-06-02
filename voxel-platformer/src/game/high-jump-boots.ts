import type { PlayerAbilitySettings } from './player-settings'
import type { PlayerEquipmentSettings } from './anim/equipment-types'
import type { InventoryItemOptions } from './inventory'

export const HIGH_JUMP_BOOTS_ITEM_ID = 'high-jump-boots'
export const HIGH_JUMP_BOOTS_NAME = 'High Jump Boots'
export const HIGH_JUMP_BOOTS_DESCRIPTION = 'Equip from Accessories to enable High Jump.'
export const HIGH_SPEED_BOOTS_ITEM_ID = 'high-speed-boots'
export const HIGH_SPEED_BOOTS_NAME = 'Boots of High Speed'
export const HIGH_SPEED_BOOTS_DESCRIPTION = 'Equip from Accessories to increase base movement speed.'

export const HIGH_JUMP_BOOTS_ITEM_OPTIONS = {
    name: HIGH_JUMP_BOOTS_NAME,
    description: HIGH_JUMP_BOOTS_DESCRIPTION,
    category: 'accessories',
    icon: 'boots',
} as const satisfies InventoryItemOptions

export const HIGH_SPEED_BOOTS_ITEM_OPTIONS = {
    name: HIGH_SPEED_BOOTS_NAME,
    description: HIGH_SPEED_BOOTS_DESCRIPTION,
    category: 'accessories',
    icon: 'boots',
} as const satisfies InventoryItemOptions

export const BOOT_EQUIPMENT_ITEM_IDS = [
    HIGH_JUMP_BOOTS_ITEM_ID,
    HIGH_SPEED_BOOTS_ITEM_ID,
] as const

export type BootEquipmentItemId = (typeof BOOT_EQUIPMENT_ITEM_IDS)[number]

export const BOOT_EQUIPMENT_ITEM_OPTIONS: Record<BootEquipmentItemId, InventoryItemOptions> = {
    [HIGH_JUMP_BOOTS_ITEM_ID]: HIGH_JUMP_BOOTS_ITEM_OPTIONS,
    [HIGH_SPEED_BOOTS_ITEM_ID]: HIGH_SPEED_BOOTS_ITEM_OPTIONS,
}

export function isBootEquipmentItemId(value: unknown): value is BootEquipmentItemId {
    return (BOOT_EQUIPMENT_ITEM_IDS as readonly string[]).includes(String(value))
}

export function hasEquippedHighJumpBoots(settings: { equipment: Pick<PlayerEquipmentSettings, 'boots'> }): boolean {
    return settings.equipment.boots === HIGH_JUMP_BOOTS_ITEM_ID
}

export function hasEquippedHighSpeedBoots(settings: { equipment: Pick<PlayerEquipmentSettings, 'boots'> }): boolean {
    return settings.equipment.boots === HIGH_SPEED_BOOTS_ITEM_ID
}

export function playerCanHighJump(
    settings: {
        abilities: Pick<PlayerAbilitySettings, 'highJump'>
        equipment: Pick<PlayerEquipmentSettings, 'boots'>
    },
): boolean {
    return settings.abilities.highJump || hasEquippedHighJumpBoots(settings)
}

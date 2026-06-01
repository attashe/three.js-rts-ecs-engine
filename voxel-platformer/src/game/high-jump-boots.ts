import type { PlayerAbilitySettings } from './player-settings'
import type { PlayerEquipmentSettings } from './anim/equipment-types'
import type { InventoryItemOptions } from './inventory'

export const HIGH_JUMP_BOOTS_ITEM_ID = 'high-jump-boots'
export const HIGH_JUMP_BOOTS_NAME = 'High Jump Boots'
export const HIGH_JUMP_BOOTS_DESCRIPTION = 'Equip from Accessories to enable High Jump.'

export const HIGH_JUMP_BOOTS_ITEM_OPTIONS = {
    name: HIGH_JUMP_BOOTS_NAME,
    description: HIGH_JUMP_BOOTS_DESCRIPTION,
    category: 'accessories',
    icon: 'boots',
} as const satisfies InventoryItemOptions

export function hasEquippedHighJumpBoots(settings: { equipment: Pick<PlayerEquipmentSettings, 'boots'> }): boolean {
    return settings.equipment.boots === HIGH_JUMP_BOOTS_ITEM_ID
}

export function playerCanHighJump(
    settings: {
        abilities: Pick<PlayerAbilitySettings, 'highJump'>
        equipment: Pick<PlayerEquipmentSettings, 'boots'>
    },
): boolean {
    return settings.abilities.highJump || hasEquippedHighJumpBoots(settings)
}

import type { PlayerSettings } from './player-settings'
import { hasEquippedHighSpeedBoots } from './high-jump-boots'

export const HIGH_SPEED_BOOTS_MOVE_SPEED_BONUS = 1.5
export const RANGER_HAT_ARROW_SPEED_BONUS = 4
export const RANGER_HAT_ARROW_LIFT_BONUS = 0.8

export function effectivePlayerMoveSpeed(settings: Pick<PlayerSettings, 'moveSpeed' | 'equipment'>): number {
    return settings.moveSpeed + (hasEquippedHighSpeedBoots(settings) ? HIGH_SPEED_BOOTS_MOVE_SPEED_BONUS : 0)
}

export function effectivePlayerArrowSpeed(settings: Pick<PlayerSettings, 'arrowSpeed' | 'equipment'>): number {
    return settings.arrowSpeed + (settings.equipment.head === 'hat-ranger' ? RANGER_HAT_ARROW_SPEED_BONUS : 0)
}

export function effectivePlayerArrowLift(settings: Pick<PlayerSettings, 'arrowLift' | 'equipment'>): number {
    return settings.arrowLift + (settings.equipment.head === 'hat-ranger' ? RANGER_HAT_ARROW_LIFT_BONUS : 0)
}

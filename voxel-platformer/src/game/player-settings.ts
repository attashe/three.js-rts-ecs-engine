import {
    copyInventoryItems,
    normalizeInventoryItems,
    type InventoryItemMap,
} from './inventory'
import {
    copyPlayerEquipment,
    normalizePlayerEquipment,
    type BootEquipmentKind,
    type EquipmentHandLoadout,
    type HeadEquipmentKind,
    type PlayerEquipmentSettings,
} from './anim/equipment-types'
import { normalizeCharacterBeard, type CharacterBeardKind } from './character-appearance'

export const PLAYER_MODEL_KINDS = [
    'player',
    'keeper',
] as const

export type PlayerModelKind = (typeof PLAYER_MODEL_KINDS)[number]

export const PLAYER_MODEL_LABELS: Record<PlayerModelKind, string> = {
    player: 'Player',
    keeper: 'Keeper',
}

export const PLAYER_ABILITY_KEYS = [
    'movement',
    'jump',
    'bow',
    'highJump',
    'airPush',
    'interact',
    'torch',
] as const

export type PlayerAbilityKey = (typeof PLAYER_ABILITY_KEYS)[number]

export const PLAYER_ABILITY_LABELS: Record<PlayerAbilityKey, string> = {
    movement: 'Movement',
    jump: 'Jump',
    bow: 'Bow',
    highJump: 'High Jump',
    airPush: 'Air Push',
    interact: 'Interaction',
    torch: 'Held torch',
}

export const PLAYER_INVENTORY_LIMITS = {
    gold: 999999,
    arrows: 9999,
} as const

/** How the indoor reveal clears cover over the character:
 *  - `corridor`: a narrow cutaway along the player→camera sight line (surgical).
 *  - `ybox`: hide everything above the player within a wide radius — a
 *    shader "illusion of global" Y-axis cull that follows the player. */
export const INDOOR_CUT_MODES = ['corridor', 'ybox'] as const
export type IndoorCutMode = (typeof INDOOR_CUT_MODES)[number]

export const INDOOR_CUT_MODE_LABELS: Record<IndoorCutMode, string> = {
    corridor: 'Sight-line corridor',
    ybox: 'Y-axis cull',
}

export interface PlayerAbilitySettings {
    movement: boolean
    jump: boolean
    bow: boolean
    highJump: boolean
    airPush: boolean
    interact: boolean
    torch: boolean
}

export interface PlayerInventorySettings {
    gold: number
    arrows: number
    items: InventoryItemMap
}

export interface PlayerTorchSettings {
    intensity: number
    distance: number
    castsShadow: boolean
}

export interface PlayerSettings {
    model: PlayerModelKind
    beard: CharacterBeardKind
    abilities: PlayerAbilitySettings
    inventory: PlayerInventorySettings
    equipment: PlayerEquipmentSettings
    moveSpeed: number
    jumpVelocity: number
    highJumpVelocity: number
    arrowSpeed: number
    arrowLift: number
    airPushRange: number
    airPushPower: number
    airPushLift: number
    torch: PlayerTorchSettings
    /** When true (default), world geometry hiding the character from the
     *  camera (roofs, upper floors) is cut away so they stay visible indoors. */
    indoorCutEnabled: boolean
    /** Shape of the indoor reveal — see `IndoorCutMode`. Default `corridor`. */
    indoorCutMode: IndoorCutMode
}

export interface PlayerEquipmentSettingsPatch {
    head?: HeadEquipmentKind | null
    boots?: BootEquipmentKind | null
    melee?: Partial<EquipmentHandLoadout>
    ranged?: Partial<EquipmentHandLoadout>
    magic?: Partial<EquipmentHandLoadout>
}

export type PlayerSettingsPatch = Partial<Omit<PlayerSettings, 'abilities' | 'inventory' | 'equipment' | 'torch'>> & {
    abilities?: Partial<PlayerAbilitySettings>
    inventory?: Partial<PlayerInventorySettings>
    equipment?: PlayerEquipmentSettingsPatch
    torch?: Partial<PlayerTorchSettings>
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
    model: 'player',
    beard: 'none',
    abilities: {
        movement: true,
        jump: true,
        bow: true,
        highJump: true,
        airPush: true,
        interact: true,
        torch: true,
    },
    inventory: {
        gold: 0,
        arrows: 0,
        items: {
            'heal-potion': {
                quantity: 2,
                name: 'Healing Potion',
                description: 'Restores health when potion use is wired into combat.',
                category: 'consumables',
                icon: 'heal-potion',
            },
        },
    },
    equipment: normalizePlayerEquipment(),
    moveSpeed: 5,
    jumpVelocity: 8,
    highJumpVelocity: 14.5,
    arrowSpeed: 10.5,
    arrowLift: 3.2,
    airPushRange: 5.5,
    airPushPower: 18,
    airPushLift: 5.5,
    torch: {
        intensity: 7.6,
        distance: 14,
        castsShadow: true,
    },
    indoorCutEnabled: true,
    indoorCutMode: 'corridor',
}

export function copyPlayerSettings(settings: PlayerSettings): PlayerSettings {
    return {
        ...settings,
        abilities: { ...settings.abilities },
        inventory: { ...settings.inventory, items: copyInventoryItems(settings.inventory.items) },
        equipment: copyPlayerEquipment(settings.equipment),
        torch: { ...settings.torch },
    }
}

export function normalizePlayerSettings(input?: PlayerSettingsPatch | null): PlayerSettings {
    const base = DEFAULT_PLAYER_SETTINGS
    const model = PLAYER_MODEL_KINDS.includes(input?.model as PlayerModelKind)
        ? input!.model as PlayerModelKind
        : base.model
    return {
        model,
        beard: normalizeCharacterBeard(input?.beard, base.beard),
        abilities: {
            movement: clampBoolean(input?.abilities?.movement, base.abilities.movement),
            jump: clampBoolean(input?.abilities?.jump, base.abilities.jump),
            bow: clampBoolean(input?.abilities?.bow, base.abilities.bow),
            highJump: clampBoolean(input?.abilities?.highJump, base.abilities.highJump),
            airPush: clampBoolean(input?.abilities?.airPush, base.abilities.airPush),
            interact: clampBoolean(input?.abilities?.interact, base.abilities.interact),
            torch: clampBoolean(input?.abilities?.torch, base.abilities.torch),
        },
        inventory: {
            gold: clampInt(input?.inventory?.gold, 0, PLAYER_INVENTORY_LIMITS.gold, base.inventory.gold),
            arrows: clampInt(input?.inventory?.arrows, 0, PLAYER_INVENTORY_LIMITS.arrows, base.inventory.arrows),
            items: input === undefined || input === null
                ? copyInventoryItems(base.inventory.items)
                : normalizeInventoryItems(input.inventory?.items),
        },
        equipment: normalizePlayerEquipment(input?.equipment),
        moveSpeed: clampNumber(input?.moveSpeed, 0, 30, base.moveSpeed),
        jumpVelocity: clampNumber(input?.jumpVelocity, 0, 40, base.jumpVelocity),
        highJumpVelocity: clampNumber(input?.highJumpVelocity, 0, 60, base.highJumpVelocity),
        arrowSpeed: clampNumber(input?.arrowSpeed, 0, 80, base.arrowSpeed),
        arrowLift: clampNumber(input?.arrowLift, -20, 40, base.arrowLift),
        airPushRange: clampNumber(input?.airPushRange, 0, 50, base.airPushRange),
        airPushPower: clampNumber(input?.airPushPower, 0, 80, base.airPushPower),
        airPushLift: clampNumber(input?.airPushLift, 0, 60, base.airPushLift),
        torch: {
            intensity: clampNumber(input?.torch?.intensity, 0, 80, base.torch.intensity),
            distance: clampNumber(input?.torch?.distance, 0, 80, base.torch.distance),
            castsShadow: clampBoolean(input?.torch?.castsShadow, base.torch.castsShadow),
        },
        indoorCutEnabled: clampBoolean(input?.indoorCutEnabled, base.indoorCutEnabled),
        indoorCutMode: INDOOR_CUT_MODES.includes(input?.indoorCutMode as IndoorCutMode)
            ? input!.indoorCutMode as IndoorCutMode
            : base.indoorCutMode,
    }
}

export function applyPlayerSettingsPatch(settings: PlayerSettings, patch: PlayerSettingsPatch): PlayerSettings {
    const currentEquipment = copyPlayerEquipment(settings.equipment)
    return normalizePlayerSettings({
        ...settings,
        ...patch,
        abilities: { ...settings.abilities, ...patch.abilities },
        inventory: {
            ...settings.inventory,
            ...patch.inventory,
            items: patch.inventory?.items !== undefined
                ? copyInventoryItems(patch.inventory.items)
                : copyInventoryItems(settings.inventory.items),
        },
        equipment: patch.equipment !== undefined
            ? {
                head: patch.equipment.head !== undefined ? patch.equipment.head : currentEquipment.head,
                boots: patch.equipment.boots !== undefined ? patch.equipment.boots : currentEquipment.boots,
                melee: { ...currentEquipment.melee, ...patch.equipment.melee },
                ranged: { ...currentEquipment.ranged, ...patch.equipment.ranged },
                magic: { ...currentEquipment.magic, ...patch.equipment.magic },
            }
            : currentEquipment,
        torch: { ...settings.torch, ...patch.torch },
    })
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const n = Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, n))
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
    return Math.floor(clampNumber(value, min, max, fallback))
}

export function clampBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value !== 0
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true
        if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false
    }
    return fallback
}

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
}

export interface PlayerTorchSettings {
    intensity: number
    distance: number
    castsShadow: boolean
}

export interface PlayerSettings {
    model: PlayerModelKind
    abilities: PlayerAbilitySettings
    inventory: PlayerInventorySettings
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
     *  camera (roofs, upper floors) is cut away in a small dome around the
     *  player so they stay visible indoors. */
    indoorCutEnabled: boolean
}

export type PlayerSettingsPatch = Partial<Omit<PlayerSettings, 'abilities' | 'inventory' | 'torch'>> & {
    abilities?: Partial<PlayerAbilitySettings>
    inventory?: Partial<PlayerInventorySettings>
    torch?: Partial<PlayerTorchSettings>
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
    model: 'player',
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
    },
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
}

export function copyPlayerSettings(settings: PlayerSettings): PlayerSettings {
    return {
        ...settings,
        abilities: { ...settings.abilities },
        inventory: { ...settings.inventory },
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
        },
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
    }
}

export function applyPlayerSettingsPatch(settings: PlayerSettings, patch: PlayerSettingsPatch): PlayerSettings {
    return normalizePlayerSettings({
        ...settings,
        ...patch,
        abilities: { ...settings.abilities, ...patch.abilities },
        inventory: { ...settings.inventory, ...patch.inventory },
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

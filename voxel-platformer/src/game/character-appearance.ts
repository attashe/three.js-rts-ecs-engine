export const CHARACTER_BEARD_KINDS = [
    'none',
    'short',
    'full',
    'pointed',
] as const

export type CharacterBeardKind = (typeof CHARACTER_BEARD_KINDS)[number]

export const CHARACTER_BEARD_LABELS: Record<CharacterBeardKind, string> = {
    none: 'No beard',
    short: 'Short beard',
    full: 'Full beard',
    pointed: 'Pointed beard',
}

export const CHARACTER_CLOAK_KINDS = [
    'default',
    'none',
] as const

export type CharacterCloakKind = (typeof CHARACTER_CLOAK_KINDS)[number]

export const CHARACTER_CLOAK_LABELS: Record<CharacterCloakKind, string> = {
    default: 'Default cloak',
    none: 'No cloak',
}

export function normalizeCharacterBeard(value: unknown, fallback: CharacterBeardKind = 'none'): CharacterBeardKind {
    return (CHARACTER_BEARD_KINDS as readonly string[]).includes(String(value))
        ? value as CharacterBeardKind
        : fallback
}

export function normalizeCharacterCloak(value: unknown, fallback: CharacterCloakKind = 'default'): CharacterCloakKind {
    return (CHARACTER_CLOAK_KINDS as readonly string[]).includes(String(value))
        ? value as CharacterCloakKind
        : fallback
}

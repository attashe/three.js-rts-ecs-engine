export const SPELL_IDS = ['bolt', 'nova', 'orb'] as const

export type SpellId = (typeof SPELL_IDS)[number]

export type PlayerSpellSettings = Record<SpellId, boolean>

export const SPELL_LABELS: Record<SpellId, string> = {
    bolt: 'Arcane Bolt',
    nova: 'Frost Nova',
    orb: 'Electric Orb',
}

export const DEFAULT_PLAYER_SPELLS: PlayerSpellSettings = {
    bolt: false,
    nova: false,
    orb: false,
}

export function isSpellId(value: unknown): value is SpellId {
    return (SPELL_IDS as readonly string[]).includes(String(value))
}

export function copyPlayerSpells(spells?: Partial<Record<SpellId, boolean>> | null): PlayerSpellSettings {
    return normalizePlayerSpells(spells)
}

export function normalizePlayerSpells(input?: Partial<Record<string, unknown>> | null): PlayerSpellSettings {
    const out: PlayerSpellSettings = { ...DEFAULT_PLAYER_SPELLS }
    if (!input || typeof input !== 'object') return out
    for (const spellId of SPELL_IDS) {
        out[spellId] = clampBoolean(input[spellId], out[spellId])
    }
    return out
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number' && Number.isFinite(value)) return value !== 0
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase()
        if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
        if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
    }
    return fallback
}

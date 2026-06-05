export type ActionId = string
export type ActionSource = 'player' | 'ai' | 'scripted'
export type ActionPhase = 'pressed' | 'held' | 'released'

export interface ActionInputSource {
    isKeyDown(code: string): boolean
    hasBufferedKeyPressed(code: string, bufferMs: number): boolean
    consumeBufferedKeyPressed(code: string, bufferMs: number): boolean
}

export type ModifierKey = 'Shift' | 'Ctrl' | 'Alt' | 'Meta'

const MODIFIER_CODES: Readonly<Record<ModifierKey, readonly string[]>> = {
    Shift: ['ShiftLeft', 'ShiftRight'],
    Ctrl: ['ControlLeft', 'ControlRight'],
    Alt: ['AltLeft', 'AltRight'],
    Meta: ['MetaLeft', 'MetaRight'],
}
const ALL_MODIFIERS: readonly ModifierKey[] = ['Shift', 'Ctrl', 'Alt', 'Meta']

export interface ActionBinding {
    readonly keys: readonly string[]
    /** When present, the binding only matches if the *exact* modifier set is
     *  held. `[]` means "no modifiers" (so plain Space won't fire when Shift is
     *  held); `['Shift']` is a chord. When omitted the binding is
     *  modifier-agnostic (the historical behaviour). */
    readonly mods?: readonly ModifierKey[]
    readonly displayKeys?: readonly string[]
}

export interface ActionHint {
    readonly group: string
    readonly label: string
    readonly keys: readonly string[]
    readonly order?: number
}

export interface ActionDefinition {
    readonly id: ActionId
    readonly label: string
    readonly bindings?: readonly ActionBinding[]
    readonly bufferMs?: number
    readonly cooldownMs?: number
    readonly tags?: readonly string[]
    readonly hint?: ActionHint
}

export interface ActionIntent {
    readonly actionId: ActionId
    readonly phase: ActionPhase
    readonly source: ActionSource
    readonly key: string
    readonly timeMs: number
}

export interface ActionCommandHint {
    keys: string[]
    label: string
}

export interface ActionMapOptions {
    now?: () => number
}

export type ActionBindingOverrideMap = Readonly<Record<ActionId, readonly ActionBinding[] | undefined>>
export type ActionKeyOverrideMap = Readonly<Record<ActionId, readonly string[] | undefined>>

const DEFAULT_BUFFER_MS = 120

export class ActionMap {
    private readonly definitions = new Map<ActionId, ActionDefinition>()
    private readonly readyAt = new Map<string, number>()
    private readonly now: () => number

    constructor(
        definitions: readonly ActionDefinition[],
        private readonly input: ActionInputSource,
        opts: ActionMapOptions = {},
    ) {
        this.now = opts.now ?? (() => performance.now())
        for (const definition of definitions) {
            if (this.definitions.has(definition.id)) {
                throw new Error(`Duplicate action definition: ${definition.id}`)
            }
            this.definitions.set(definition.id, cloneActionDefinition(definition))
        }
    }

    get(id: ActionId): ActionDefinition {
        const definition = this.definitions.get(id)
        if (!definition) throw new Error(`Unknown action: ${id}`)
        return definition
    }

    all(): ActionDefinition[] {
        return [...this.definitions.values()]
    }

    bindingsFor(id: ActionId): ActionBinding[] {
        return cloneActionBindings(this.get(id).bindings) ?? []
    }

    bindingDisplayKeysFor(id: ActionId): string[] {
        return actionBindingDisplayKeys(this.get(id))
    }

    /** Replace an action's bindings on the live (shared) instance, so every
     *  system holding this ActionMap sees the new keys without re-wiring. */
    rebind(id: ActionId, bindings: readonly ActionBinding[]): void {
        const definition = this.get(id)
        this.definitions.set(id, cloneActionDefinition({
            ...definition,
            bindings: normalizeActionBindings(bindings) ?? [],
        }))
    }

    /** Apply a map of `actionId -> keys` overrides in place (single-binding,
     *  modifier-agnostic — used by the rebind UI / persisted keymaps). */
    applyKeyOverrides(overrides: ActionKeyOverrideMap): void {
        const bindingMap = keyOverridesToActionBindings(overrides)
        for (const id of Object.keys(bindingMap)) {
            const bindings = bindingMap[id]
            if (!bindings || !this.definitions.has(id)) continue
            this.rebind(id, bindings)
        }
    }

    private modifiersSatisfied(binding: ActionBinding): boolean {
        if (!binding.mods) return true
        for (const mod of ALL_MODIFIERS) {
            const required = binding.mods.includes(mod)
            const held = MODIFIER_CODES[mod].some((code) => this.input.isKeyDown(code))
            if (required !== held) return false
        }
        return true
    }

    isHeld(id: ActionId): boolean {
        const definition = this.get(id)
        return (definition.bindings ?? []).some((binding) =>
            this.modifiersSatisfied(binding) && binding.keys.some((key) => this.input.isKeyDown(key)),
        )
    }

    axis(negativeId: ActionId, positiveId: ActionId): number {
        return (this.isHeld(positiveId) ? 1 : 0) - (this.isHeld(negativeId) ? 1 : 0)
    }

    hasBufferedPress(id: ActionId): boolean {
        const definition = this.get(id)
        const bufferMs = definition.bufferMs ?? DEFAULT_BUFFER_MS
        return (definition.bindings ?? []).some((binding) =>
            this.modifiersSatisfied(binding) && binding.keys.some((key) => this.input.hasBufferedKeyPressed(key, bufferMs)),
        )
    }

    consumePressed(id: ActionId, subject: string | number = 'global'): ActionIntent | null {
        const definition = this.get(id)
        const bufferMs = definition.bufferMs ?? DEFAULT_BUFFER_MS
        const now = this.now()
        if (now < this.cooldownReadyAt(definition, subject)) return null

        for (const binding of definition.bindings ?? []) {
            if (!this.modifiersSatisfied(binding)) continue
            for (const key of binding.keys) {
                if (!this.input.hasBufferedKeyPressed(key, bufferMs)) continue
                if (!this.input.consumeBufferedKeyPressed(key, bufferMs)) continue
                this.startCooldown(definition, subject, now)
                return {
                    actionId: id,
                    phase: 'pressed',
                    source: 'player',
                    key,
                    timeMs: now,
                }
            }
        }
        return null
    }

    cooldownRemainingMs(id: ActionId, subject: string | number = 'global'): number {
        const definition = this.get(id)
        return Math.max(0, this.cooldownReadyAt(definition, subject) - this.now())
    }

    commandHints(ids?: readonly ActionId[]): ActionCommandHint[] {
        const source = ids ? ids.map((id) => this.get(id)) : this.all()
        const groups = new Map<string, { label: string; keys: string[]; order: number }>()
        for (const definition of source) {
            const hint = definition.hint
            if (!hint) continue
            const group = groups.get(hint.group) ?? {
                label: hint.label,
                keys: [],
                order: hint.order ?? Number.MAX_SAFE_INTEGER,
            }
            for (const key of hint.keys) {
                if (!group.keys.includes(key)) group.keys.push(key)
            }
            group.order = Math.min(group.order, hint.order ?? group.order)
            groups.set(hint.group, group)
        }
        return [...groups.values()]
            .sort((a, b) => a.order - b.order)
            .map(({ keys, label }) => ({ keys, label }))
    }

    private cooldownReadyAt(definition: ActionDefinition, subject: string | number): number {
        if (!definition.cooldownMs) return 0
        return this.readyAt.get(cooldownKey(definition.id, subject)) ?? 0
    }

    private startCooldown(definition: ActionDefinition, subject: string | number, now: number): void {
        if (!definition.cooldownMs) return
        this.readyAt.set(cooldownKey(definition.id, subject), now + definition.cooldownMs)
    }
}

function cooldownKey(id: ActionId, subject: string | number): string {
    return `${id}:${subject}`
}

export function withActionBindingOverrides(
    definitions: readonly ActionDefinition[],
    overrides: ActionBindingOverrideMap = {},
): ActionDefinition[] {
    return definitions.map((definition) => {
        const override = overrides[definition.id]
        const overrideBindings = override ? normalizeActionBindings(override) : undefined
        const bindings = overrideBindings ?? cloneActionBindings(definition.bindings)
        return cloneActionDefinition({ ...definition, bindings })
    })
}

export function keyOverridesToActionBindings(overrides: ActionKeyOverrideMap = {}): ActionBindingOverrideMap {
    const bindings: Record<ActionId, ActionBinding[]> = {}
    for (const [id, keys] of Object.entries(overrides)) {
        if (!keys) continue
        bindings[id] = [{ keys }]
    }
    return bindings
}

export function actionBindingDisplayKeys(definition: ActionDefinition): string[] {
    const keys: string[] = []
    for (const binding of definition.bindings ?? []) {
        const prefix = binding.mods && binding.mods.length > 0 ? `${binding.mods.join('+')}+` : ''
        const displayKeys = binding.displayKeys && binding.displayKeys.length > 0
            ? binding.displayKeys
            : binding.keys.map(formatKeyCodeForDisplay)
        for (const key of displayKeys) {
            const label = `${prefix}${key}`
            if (!keys.includes(label)) keys.push(label)
        }
    }
    return keys
}

export function formatKeyCodeForDisplay(code: string): string {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`
    if (code === 'Mouse0') return 'LMB'
    if (code === 'Mouse1') return 'MMB'
    if (code === 'Mouse2') return 'RMB'
    return KEY_CODE_LABELS[code] ?? code
}

function cloneActionDefinition(definition: ActionDefinition): ActionDefinition {
    return {
        ...definition,
        bindings: cloneActionBindings(definition.bindings),
        tags: definition.tags ? [...definition.tags] : undefined,
        hint: definition.hint
            ? { ...definition.hint, keys: [...definition.hint.keys] }
            : undefined,
    }
}

function cloneActionBindings(bindings: readonly ActionBinding[] | undefined): ActionBinding[] | undefined {
    if (!bindings) return undefined
    return bindings.map((binding) => ({
        keys: [...binding.keys],
        mods: binding.mods ? [...binding.mods] : undefined,
        displayKeys: binding.displayKeys ? [...binding.displayKeys] : undefined,
    }))
}

function normalizeActionBindings(bindings: readonly ActionBinding[]): ActionBinding[] | undefined {
    const normalized: ActionBinding[] = []
    for (const binding of bindings) {
        const keys = uniqueNonEmpty(binding.keys)
        if (keys.length === 0) continue
        const displayKeys = binding.displayKeys ? uniqueNonEmpty(binding.displayKeys) : undefined
        const mods = binding.mods ? [...binding.mods] : undefined
        const next: ActionBinding = { keys }
        normalized.push({
            ...next,
            ...(mods ? { mods } : {}),
            ...(displayKeys && displayKeys.length > 0 ? { displayKeys } : {}),
        })
    }
    return normalized.length > 0 ? normalized : undefined
}

function uniqueNonEmpty(values: readonly string[]): string[] {
    const out: string[] = []
    for (const value of values) {
        const trimmed = value.trim()
        if (!trimmed || out.includes(trimmed)) continue
        out.push(trimmed)
    }
    return out
}

const KEY_CODE_LABELS: Readonly<Record<string, string>> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Backquote: '`',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    Delete: 'Del',
    Enter: 'Enter',
    Equal: '=',
    Escape: 'Esc',
    MetaLeft: 'Meta',
    MetaRight: 'Meta',
    Minus: '-',
    Period: '.',
    Quote: "'",
    Semicolon: ';',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    Slash: '/',
    Space: 'Space',
    Tab: 'Tab',
}

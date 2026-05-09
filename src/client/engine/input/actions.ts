export type ActionId = string
export type ActionSource = 'player' | 'ai' | 'scripted'
export type ActionPhase = 'pressed' | 'held' | 'released'

export interface ActionInputSource {
    isKeyDown(code: string): boolean
    hasBufferedKeyPressed(code: string, bufferMs: number): boolean
    consumeBufferedKeyPressed(code: string, bufferMs: number): boolean
}

export interface ActionBinding {
    readonly keys: readonly string[]
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
            this.definitions.set(definition.id, definition)
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

    isHeld(id: ActionId): boolean {
        const definition = this.get(id)
        return (definition.bindings ?? []).some((binding) =>
            binding.keys.some((key) => this.input.isKeyDown(key)),
        )
    }

    axis(negativeId: ActionId, positiveId: ActionId): number {
        return (this.isHeld(positiveId) ? 1 : 0) - (this.isHeld(negativeId) ? 1 : 0)
    }

    hasBufferedPress(id: ActionId): boolean {
        const definition = this.get(id)
        const bufferMs = definition.bufferMs ?? DEFAULT_BUFFER_MS
        return (definition.bindings ?? []).some((binding) =>
            binding.keys.some((key) => this.input.hasBufferedKeyPressed(key, bufferMs)),
        )
    }

    consumePressed(id: ActionId, subject: string | number = 'global'): ActionIntent | null {
        const definition = this.get(id)
        const bufferMs = definition.bufferMs ?? DEFAULT_BUFFER_MS
        const now = this.now()
        if (now < this.cooldownReadyAt(definition, subject)) return null

        for (const binding of definition.bindings ?? []) {
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


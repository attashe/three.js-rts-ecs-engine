import { ZONE_PRESETS, applyZonePreset, type WeatherZoneParams } from '../engine/fx'

/**
 * One entry in the palette. Built-ins mirror `ZONE_PRESETS`; custom
 * entries are user-created copies (typically clones of a built-in
 * with tweaked params) and persist to `localStorage`.
 */
export interface FxTemplate {
    id: string
    label: string
    builtin: boolean
    params: WeatherZoneParams
}

type Listener = () => void

const LOCAL_STORAGE_KEY = 'fx-demo:templates'

/**
 * Mutable catalogue of FX templates. Acts as the source of truth for
 * the palette panel and the constructor; emits a single
 * `notifyChange` whenever the list (or any persisted entry) changes,
 * so the UI can refresh without subscribing to each entry.
 */
export class TemplateStore {
    private templates = new Map<string, FxTemplate>()
    private listeners = new Set<Listener>()
    private customSeq = 0

    constructor() {
        this.seedBuiltins()
        this.loadCustom()
    }

    private seedBuiltins(): void {
        for (const id of Object.keys(ZONE_PRESETS)) {
            const preset = ZONE_PRESETS[id]!
            const params = applyZonePreset(id as keyof typeof ZONE_PRESETS)
            this.templates.set(`builtin:${id}`, {
                id: `builtin:${id}`,
                label: preset.label,
                builtin: true,
                params,
            })
        }
    }

    private loadCustom(): void {
        if (typeof localStorage === 'undefined') return
        try {
            const raw = localStorage.getItem(LOCAL_STORAGE_KEY)
            if (!raw) return
            const arr = JSON.parse(raw) as FxTemplate[]
            if (!Array.isArray(arr)) return
            for (const entry of arr) {
                if (!entry || typeof entry !== 'object') continue
                if (!entry.id || !entry.label || !entry.params) continue
                this.templates.set(entry.id, { ...entry, builtin: false })
                const n = parseCustomIndex(entry.id)
                if (n > this.customSeq) this.customSeq = n
            }
        } catch (err) {
            console.warn('TemplateStore: failed to load custom templates', err)
        }
    }

    private saveCustom(): void {
        if (typeof localStorage === 'undefined') return
        const custom = [...this.templates.values()].filter((t) => !t.builtin)
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(custom))
        } catch (err) {
            console.warn('TemplateStore: failed to persist custom templates', err)
        }
    }

    list(): FxTemplate[] {
        const builtins: FxTemplate[] = []
        const customs: FxTemplate[] = []
        for (const t of this.templates.values()) {
            if (t.builtin) builtins.push(t)
            else customs.push(t)
        }
        // Stable order: built-ins first (in their map order, which
        // mirrors ZONE_PRESETS), customs after, alphabetically.
        customs.sort((a, b) => a.label.localeCompare(b.label))
        return [...builtins, ...customs]
    }

    get(id: string): FxTemplate | undefined {
        return this.templates.get(id)
    }

    /**
     * Clone `source` into a new custom template. The custom id is
     * auto-generated (`custom:<n>`) and never collides with existing
     * ids. If `label` is omitted, derives one from the source.
     */
    addCustom(source: WeatherZoneParams, label?: string): FxTemplate {
        this.customSeq += 1
        const id = `custom:${this.customSeq}`
        const finalLabel = label?.trim() || `${source.name || 'Effect'} (custom)`
        const params = cloneParams(source)
        // Custom templates own no live id — the id is regenerated when
        // a zone is spawned. Strip any inherited one.
        params.id = undefined
        params.name = finalLabel
        const entry: FxTemplate = { id, label: finalLabel, builtin: false, params }
        this.templates.set(id, entry)
        this.saveCustom()
        this.notify()
        return entry
    }

    /** Apply a params patch to a custom template. No-op for built-ins
     *  (they're meant to be cloned, not mutated). Returns the updated
     *  template, or `null` if the target wasn't a writable entry. */
    updateCustom(id: string, patch: Partial<WeatherZoneParams> & { label?: string }): FxTemplate | null {
        const entry = this.templates.get(id)
        if (!entry || entry.builtin) return null
        if (patch.label !== undefined) {
            entry.label = patch.label.trim() || entry.label
            entry.params.name = entry.label
        }
        // Strip `label` before merging into params; everything else
        // is a `WeatherZoneParams` field.
        const { label: _label, ...rest } = patch
        void _label
        Object.assign(entry.params, rest)
        if (rest.position) entry.params.position = { ...rest.position }
        if (rest.size) entry.params.size = { ...rest.size }
        this.saveCustom()
        this.notify()
        return entry
    }

    removeCustom(id: string): boolean {
        const entry = this.templates.get(id)
        if (!entry || entry.builtin) return false
        this.templates.delete(id)
        this.saveCustom()
        this.notify()
        return true
    }

    onChange(listener: Listener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private notify(): void {
        for (const l of this.listeners) l()
    }
}

/** Deep clone the params object so mutating the clone never bleeds
 *  back into a built-in template (whose params should be immutable). */
export function cloneParams(p: WeatherZoneParams): WeatherZoneParams {
    return {
        ...p,
        position: { ...p.position },
        size: { ...p.size },
        // Don't carry the live runtime id when cloning into a template
        // or draft — the system will assign a fresh one at spawn time.
        id: undefined,
    }
}

function parseCustomIndex(id: string): number {
    if (!id.startsWith('custom:')) return 0
    const n = parseInt(id.slice('custom:'.length), 10)
    return Number.isFinite(n) ? n : 0
}

// Schema-versioned (de)serialisation for animation graphs. Pure JSON in/out.
import {
    ANIM_GRAPH_SCHEMA_VERSION,
    validateAnimGraph,
    type AnimGraphDef,
} from './state-graph'

export function serializeAnimGraph(def: AnimGraphDef): string {
    return JSON.stringify(def)
}

/**
 * Parse + migrate + validate a graph. Accepts a JSON string or an
 * already-parsed object. Throws on a graph that fails validation so callers
 * never get a half-broken def; use `validateAnimGraph` directly for soft checks.
 */
export function deserializeAnimGraph(input: string | unknown): AnimGraphDef {
    const raw: unknown = typeof input === 'string' ? JSON.parse(input) : input
    const migrated = migrateAnimGraph(raw)
    const result = validateAnimGraph(migrated)
    if (!result.ok) {
        throw new Error(`Invalid animation graph: ${result.errors.join('; ')}`)
    }
    return migrated as AnimGraphDef
}

/**
 * Upgrade an older serialised graph to the current schema. Today the only step
 * is stamping a missing `schemaVersion`; future schema bumps add cases here,
 * keyed on the incoming version, before validation runs.
 */
export function migrateAnimGraph(raw: unknown): unknown {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
    const def = { ...(raw as Record<string, unknown>) }
    if (typeof def.schemaVersion !== 'number') {
        def.schemaVersion = ANIM_GRAPH_SCHEMA_VERSION
    }
    // Future: while (def.schemaVersion < ANIM_GRAPH_SCHEMA_VERSION) { ...; def.schemaVersion++ }
    return def
}

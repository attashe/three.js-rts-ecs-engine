/**
 * Playtest → editor runtime-error bridge.
 *
 * The editor's Logic tab and the playtest game are different page loads
 * sharing one tab. There's no live channel between them, but
 * sessionStorage survives the navigation, so we use it as a one-way
 * journal: when a script throws during playtest, we stash a record under
 * its entry id; when the editor re-renders the Logic tab, it reads the
 * journal and surfaces the message under the matching row.
 *
 * Keep this module DOM-free aside from sessionStorage so both the
 * playtest writer (`script-system.ts`) and the editor reader
 * (`ui/logic-tab.ts`) can import it without dragging extra deps. Wrap
 * every storage access in try/catch — sessionStorage is unavailable in
 * Node test runs and may throw `SecurityError` in private-window
 * iframes.
 */

export const PLAYTEST_ERROR_STORAGE_KEY = 'vp:playtest-script-errors'

/** Phase the error was caught in. `parse` = `new AsyncFunction` threw
 *  on bad syntax; `runtime` = the body's top-level Promise (or a
 *  registered handler) rejected during playtest. */
export type RecordedScriptErrorPhase = 'parse' | 'runtime'

export interface RecordedScriptError {
    /** Stable id of the broken `ScriptEntry`. */
    scriptId: string
    /** Display name carried alongside so the editor can render a row's
     *  error even if the user renamed the entry between playtests. */
    scriptName: string
    phase: RecordedScriptErrorPhase
    /** Short `where` tag the runtime supplied (e.g. `compile.runtime`,
     *  `handler:zone-enter`). Helpful for digging in the console; the
     *  editor surfaces this verbatim under the row. */
    where: string
    message: string
    /** Absolute wall-clock time (`Date.now()`) the error was recorded.
     *  The editor compares against the entry's last-edit timestamp to
     *  decide whether to suppress stale errors after a fresh save. */
    occurredAt: number
}

interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
    removeItem(key: string): void
}

function sessionStorageOrNull(): StorageLike | null {
    if (typeof globalThis === 'undefined') return null
    try {
        const s = (globalThis as { sessionStorage?: StorageLike }).sessionStorage
        return s ?? null
    } catch {
        return null
    }
}

function readAll(storage: StorageLike): Record<string, RecordedScriptError> {
    try {
        const raw = storage.getItem(PLAYTEST_ERROR_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        // Validate each entry shape so a malformed legacy payload
        // doesn't crash the editor's render loop.
        const out: Record<string, RecordedScriptError> = {}
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!value || typeof value !== 'object') continue
            const e = value as Partial<RecordedScriptError>
            if (typeof e.scriptId !== 'string' || typeof e.message !== 'string') continue
            out[id] = {
                scriptId: e.scriptId,
                scriptName: typeof e.scriptName === 'string' ? e.scriptName : id,
                phase: e.phase === 'parse' ? 'parse' : 'runtime',
                where: typeof e.where === 'string' ? e.where : '',
                message: e.message,
                occurredAt: typeof e.occurredAt === 'number' && Number.isFinite(e.occurredAt)
                    ? e.occurredAt
                    : 0,
            }
        }
        return out
    } catch {
        return {}
    }
}

function writeAll(storage: StorageLike, all: Record<string, RecordedScriptError>): void {
    try {
        storage.setItem(PLAYTEST_ERROR_STORAGE_KEY, JSON.stringify(all))
    } catch {
        // Quota-exceeded or unavailable storage — log channel only.
    }
}

/** Stash an error so the editor's Logic tab can surface it on next
 *  render. Overwrites any previously-recorded error for the same
 *  `scriptId` — the latest error wins, which is what authors expect
 *  while iterating on a single broken handler. */
export function recordPlaytestScriptError(
    entry: { id: string; name: string },
    phase: RecordedScriptErrorPhase,
    where: string,
    err: unknown,
    storage: StorageLike | null = sessionStorageOrNull(),
): void {
    if (!storage) return
    const all = readAll(storage)
    all[entry.id] = {
        scriptId: entry.id,
        scriptName: entry.name,
        phase,
        where,
        message: err instanceof Error ? err.message : String(err),
        occurredAt: Date.now(),
    }
    writeAll(storage, all)
}

/** Drop the stashed error for one script id. Called by the editor when
 *  the user edits a row (the recorded error is now stale relative to
 *  the in-progress source). */
export function clearPlaytestScriptError(
    scriptId: string,
    storage: StorageLike | null = sessionStorageOrNull(),
): void {
    if (!storage) return
    const all = readAll(storage)
    if (!(scriptId in all)) return
    delete all[scriptId]
    if (Object.keys(all).length === 0) {
        try {
            storage.removeItem(PLAYTEST_ERROR_STORAGE_KEY)
        } catch {
            // Best effort.
        }
    } else {
        writeAll(storage, all)
    }
}

/** Drop every stashed error. Wired to the Logic tab's "Clear errors"
 *  button so authors can reset the banner sweep without launching a
 *  fresh playtest. */
export function clearAllPlaytestScriptErrors(
    storage: StorageLike | null = sessionStorageOrNull(),
): void {
    if (!storage) return
    try {
        storage.removeItem(PLAYTEST_ERROR_STORAGE_KEY)
    } catch {
        // Best effort.
    }
}

/** Snapshot of every stashed error keyed by `scriptId`. The editor calls
 *  this on every Logic-tab refresh — it's a JSON.parse so don't loop
 *  millions of times, but per-render-loop overhead is fine. */
export function readPlaytestScriptErrors(
    storage: StorageLike | null = sessionStorageOrNull(),
): Map<string, RecordedScriptError> {
    if (!storage) return new Map()
    const all = readAll(storage)
    return new Map(Object.entries(all))
}

/**
 * Script engine — source compilation.
 *
 * Wraps a `ScriptEntry`'s raw text in the destructure prelude and
 * builds an `AsyncFunction` we can invoke with the `ScriptContext`.
 * Parse errors throw synchronously (from the `AsyncFunction`
 * constructor) and are returned as `{ ok: false }`. Runtime errors —
 * thrown by the script's top-level body — surface via the returned
 * Promise's `.catch`, plumbed to the runtime's `onError`.
 *
 * No `eval`, no `Function` from a Worker, no third-party VM. We
 * deliberately use the host realm's `AsyncFunction` because the
 * sandbox isn't part of this design (`docs/script-engine.md` §0).
 */

import type { ScriptContext, ScriptEntry } from './types'

// Capture the AsyncFunction constructor once. We can't `import` it; it's
// the same .constructor of any `async function () {}` instance.
// eslint-disable-next-line @typescript-eslint/no-empty-function
const AsyncFunctionCtor: new (...args: string[]) => (ctx: ScriptContext) => Promise<unknown> =
    Object.getPrototypeOf(async function () {}).constructor

/** Destructure list, kept in sync with `ScriptContext` in types.ts.
 *  Exported so the editor's parse-check helpers (Logic tab, NPC tab) use
 *  the same prelude as the runtime — adding a binding here automatically
 *  shows up wherever scripts are parse-checked. */
export const PRELUDE_LOCALS = [
    'on', 'once', 'emit', 'wait', 'log',
    'player', 'chunks', 'pickups', 'audio',
    'flags', 'time', 'zone', 'geom', 'ui',
    'dayCycle', 'weather', 'travel', 'level', 'random',
].join(', ')

export interface CompileSuccess {
    ok: true
    /** The Promise returned by invoking the script's top-level body.
     *  Resolves when the body finishes (typically immediately, after
     *  registering handlers). Pending if the body itself awaits. */
    pending: Promise<unknown>
}

export interface CompileFailure {
    ok: false
    /** Set when `new AsyncFunction(...)` threw — a syntax error in the
     *  source. Distinguished from runtime errors so the editor's failure
     *  UI can show "parse error" vs "exception at line N". */
    error: Error
}

/** Compile + invoke a script once. Returns synchronously; runtime
 *  failures inside the body's microtask chain are forwarded to
 *  `onRuntimeError` so the engine system can mark the entry broken
 *  without crashing the tick loop.
 *
 *  The wrapper prepends `"use strict"` so the script picks up the
 *  modern semantics (let/const block scoping, throwing on undeclared
 *  identifiers) even though `AsyncFunction` runs sloppy by default. */
export function compileScript(
    entry: ScriptEntry,
    ctx: ScriptContext,
    onRuntimeError: (entry: ScriptEntry, err: unknown) => void,
): CompileSuccess | CompileFailure {
    let fn: (ctx: ScriptContext) => Promise<unknown>
    const sourceUrl = sanitizeSourceUrl(entry.name) || entry.id || 'script.js'
    try {
        fn = new AsyncFunctionCtor('ctx', `
            "use strict";
            const { ${PRELUDE_LOCALS} } = ctx;
            ${entry.source}
            //# sourceURL=${sourceUrl}
        `)
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) }
    }
    let pending: Promise<unknown>
    try {
        pending = fn(ctx)
    } catch (err) {
        // Defensive: the AsyncFunction wrapper itself shouldn't throw
        // synchronously, but if a host-injected getter on `ctx` does
        // (none of ours do — checked the bindings), we still capture.
        return { ok: false, error: err instanceof Error ? err : new Error(String(err)) }
    }
    pending.catch((err) => onRuntimeError(entry, err))
    return { ok: true, pending }
}

/** Strip newlines so a malformed name can't terminate the `//# sourceURL=`
 *  pragma early. Returns the trimmed result (possibly empty). */
function sanitizeSourceUrl(name: string): string {
    return name.replace(/[\r\n]+/g, ' ').trim()
}

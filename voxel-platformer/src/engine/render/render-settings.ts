/**
 * Tiny localStorage-backed render settings store + subscriber API.
 *
 * Currently houses one flag — `renderTextures` — which toggles the
 * chunk material's atlas-sampling pass. The store survives across
 * page reloads but is intentionally separate from the level save
 * format: a render preference is per-user, not per-level.
 *
 * Reads are synchronous and cheap (one localStorage hit on first
 * access, cached thereafter). The subscribe API is unconditional —
 * listeners are called when the value actually changes, not when it
 * is merely re-set to the same value, so wiring this into a re-render
 * loop doesn't stall.
 *
 * No UI dependency lives here — the editor mounts a checkbox that
 * calls `setRenderTextures`; gameplay clients subscribe to react.
 */

const STORAGE_KEY = 'vp:render:textures'
const DEFAULT_TEXTURES = true

type Listener = (enabled: boolean) => void

const listeners = new Set<Listener>()
let cached: boolean | null = null

function loadFromStorage(): boolean {
    if (typeof localStorage === 'undefined') return DEFAULT_TEXTURES
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw === '0' || raw === 'false') return false
        if (raw === '1' || raw === 'true') return true
    } catch {
        // Private-mode browsers throw on storage access. Fall through to
        // the default — losing the preference is preferable to crashing.
    }
    return DEFAULT_TEXTURES
}

function persist(value: boolean): void {
    if (typeof localStorage === 'undefined') return
    try {
        localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
    } catch {
        // Same private-mode case — silently ignore.
    }
}

/** Current value of the textures flag. Caches after first read so
 *  repeated calls don't re-touch storage on every chunk rebuild. */
export function getRenderTextures(): boolean {
    if (cached === null) cached = loadFromStorage()
    return cached
}

/** Update the flag and notify subscribers if the value actually
 *  changed. Persists to localStorage. */
export function setRenderTextures(enabled: boolean): void {
    if (cached === null) cached = loadFromStorage()
    if (cached === enabled) return
    cached = enabled
    persist(enabled)
    for (const listener of listeners) {
        try {
            listener(enabled)
        } catch (err) {
            console.warn('renderTextures listener threw:', err)
        }
    }
}

/** Subscribe to changes. Returns an unsubscribe function. The listener
 *  is NOT invoked synchronously with the current value — callers that
 *  want the initial state should also call `getRenderTextures()`. */
export function subscribeRenderTextures(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

/** Test-only: clear the in-memory cache so the next read pulls fresh
 *  from storage. Used by the render-settings tests to verify the
 *  storage round-trip. Don't call from production code. */
export function __resetRenderTexturesCache(): void {
    cached = null
}

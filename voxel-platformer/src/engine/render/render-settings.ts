/**
 * Tiny localStorage-backed render settings store + subscriber API.
 *
 * Houses per-user render/debug flags such as `renderTextures` and
 * `debugInfo`. The store survives across page reloads but is
 * intentionally separate from the level save format: a render
 * preference is per-user, not per-level.
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

const TORCH_STORAGE_KEY = 'vp:render:torches'
const DEFAULT_TORCH_SYSTEM: TorchSystemKind = 'classic'

const PLAYER_TORCH_SHADOW_KEY = 'vp:render:player-torch-shadow'
const DEFAULT_PLAYER_TORCH_SHADOW = true

const DEBUG_INFO_KEY = 'vp:render:debug-info'
const DEFAULT_DEBUG_INFO = true

type Listener = (enabled: boolean) => void

const listeners = new Set<Listener>()
const playerTorchShadowListeners = new Set<Listener>()
const debugInfoListeners = new Set<Listener>()
let cached: boolean | null = null
let cachedTorchSystem: TorchSystemKind | null = null
let cachedPlayerTorchShadow: boolean | null = null
let cachedDebugInfo: boolean | null = null

/**
 * Which torch-block render system the client boots with.
 *
 * - `classic` — the production system in `torch-block-system.ts`.
 *   InstancedMesh-based geometry, pool of unshadowed PointLights.
 *   Default. Fast, distinct lit pools, exactly matches the look
 *   committed to the game.
 * - `experimental` — `torch-block-system-v2.ts`. Same InstancedMesh
 *   geometry, but the PointLight pool is replaced by a single
 *   global LightProbe whose SH9 coefficients are recomputed each
 *   frame from the nearest torches. No per-light shader cost, no
 *   shadow maps; visually a softer "warm cave" wash rather than
 *   distinct torch pools. Use this to evaluate alternative
 *   illumination approaches before promoting them.
 *
 * Legacy storage values that may still be present in users'
 * browsers (mapped to `experimental` on load):
 *   - `shadowed`: the old name when v2 was the shadow-casting prototype.
 *
 * Both systems coexist in the codebase so we can A/B them; reading
 * the flag happens once at startup, so switching requires a reload.
 */
export type TorchSystemKind = 'classic' | 'experimental'

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

// ─────────────────────────────────────────────────────────────────────
// Torch system selector. Reads happen once at engine startup, so we
// don't ship a subscriber API for this flag — flipping it from the
// editor triggers a page reload prompt via the UI layer.
// ─────────────────────────────────────────────────────────────────────

function loadTorchSystem(): TorchSystemKind {
    if (typeof localStorage === 'undefined') return DEFAULT_TORCH_SYSTEM
    try {
        const raw = localStorage.getItem(TORCH_STORAGE_KEY)
        if (raw === 'experimental') return 'experimental'
        // Legacy value from when v2 was the shadow-casting prototype.
        // The current `experimental` slot is the LightProbe variant
        // and is the spiritual successor; users with the old key
        // get migrated transparently on next read.
        if (raw === 'shadowed') return 'experimental'
        if (raw === 'classic') return 'classic'
    } catch {
        // Private-mode storage failure — fall back to the default.
    }
    return DEFAULT_TORCH_SYSTEM
}

function persistTorchSystem(value: TorchSystemKind): void {
    if (typeof localStorage === 'undefined') return
    try {
        localStorage.setItem(TORCH_STORAGE_KEY, value)
    } catch {
        // Same private-mode case.
    }
}

export function getTorchSystem(): TorchSystemKind {
    if (cachedTorchSystem === null) cachedTorchSystem = loadTorchSystem()
    return cachedTorchSystem
}

export function setTorchSystem(value: TorchSystemKind): void {
    if (cachedTorchSystem === null) cachedTorchSystem = loadTorchSystem()
    if (cachedTorchSystem === value) return
    cachedTorchSystem = value
    persistTorchSystem(value)
}

export function __resetTorchSystemCache(): void {
    cachedTorchSystem = null
}

// ─────────────────────────────────────────────────────────────────────
// Player-held torch shadow casting. Unlike the v1/v2 torch-system
// selector this one IS live-toggleable — flipping `castShadow` on a
// single existing light forces three.js to recompile only the
// shaders that sample that light's shadow map (a one-time stall),
// not the wholesale recompile that adding/removing lights causes. So
// the host can subscribe and react without a page reload.
// ─────────────────────────────────────────────────────────────────────

function loadPlayerTorchShadow(): boolean {
    if (typeof localStorage === 'undefined') return DEFAULT_PLAYER_TORCH_SHADOW
    try {
        const raw = localStorage.getItem(PLAYER_TORCH_SHADOW_KEY)
        if (raw === '0' || raw === 'false') return false
        if (raw === '1' || raw === 'true') return true
    } catch {
        // Private-mode fallback — accept the default.
    }
    return DEFAULT_PLAYER_TORCH_SHADOW
}

function persistPlayerTorchShadow(value: boolean): void {
    if (typeof localStorage === 'undefined') return
    try {
        localStorage.setItem(PLAYER_TORCH_SHADOW_KEY, value ? '1' : '0')
    } catch {
        // Same private-mode case.
    }
}

export function getPlayerTorchShadow(): boolean {
    if (cachedPlayerTorchShadow === null) cachedPlayerTorchShadow = loadPlayerTorchShadow()
    return cachedPlayerTorchShadow
}

export function setPlayerTorchShadow(enabled: boolean): void {
    if (cachedPlayerTorchShadow === null) cachedPlayerTorchShadow = loadPlayerTorchShadow()
    if (cachedPlayerTorchShadow === enabled) return
    cachedPlayerTorchShadow = enabled
    persistPlayerTorchShadow(enabled)
    for (const listener of playerTorchShadowListeners) {
        try {
            listener(enabled)
        } catch (err) {
            console.warn('playerTorchShadow listener threw:', err)
        }
    }
}

export function subscribePlayerTorchShadow(listener: Listener): () => void {
    playerTorchShadowListeners.add(listener)
    return () => { playerTorchShadowListeners.delete(listener) }
}

export function __resetPlayerTorchShadowCache(): void {
    cachedPlayerTorchShadow = null
}

// ─────────────────────────────────────────────────────────────────────
// Shared debug-info toggle. This controls runtime debug overlays and
// debug-only world visuals such as invisible border blocks.
// ─────────────────────────────────────────────────────────────────────

function loadDebugInfo(): boolean {
    if (typeof localStorage === 'undefined') return DEFAULT_DEBUG_INFO
    try {
        const raw = localStorage.getItem(DEBUG_INFO_KEY)
        if (raw === '0' || raw === 'false') return false
        if (raw === '1' || raw === 'true') return true
    } catch {
        // Private-mode fallback — accept the default.
    }
    return DEFAULT_DEBUG_INFO
}

function persistDebugInfo(value: boolean): void {
    if (typeof localStorage === 'undefined') return
    try {
        localStorage.setItem(DEBUG_INFO_KEY, value ? '1' : '0')
    } catch {
        // Same private-mode case.
    }
}

export function getDebugInfoEnabled(): boolean {
    if (cachedDebugInfo === null) cachedDebugInfo = loadDebugInfo()
    return cachedDebugInfo
}

export function setDebugInfoEnabled(enabled: boolean): void {
    if (cachedDebugInfo === null) cachedDebugInfo = loadDebugInfo()
    if (cachedDebugInfo === enabled) return
    cachedDebugInfo = enabled
    persistDebugInfo(enabled)
    for (const listener of debugInfoListeners) {
        try {
            listener(enabled)
        } catch (err) {
            console.warn('debugInfo listener threw:', err)
        }
    }
}

export function subscribeDebugInfo(listener: Listener): () => void {
    debugInfoListeners.add(listener)
    return () => { debugInfoListeners.delete(listener) }
}

export function __resetDebugInfoCache(): void {
    cachedDebugInfo = null
}

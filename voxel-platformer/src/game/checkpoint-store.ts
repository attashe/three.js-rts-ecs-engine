import type { VoxelCoord } from '../engine/ecs/world'

/** Per-session persistence layer behind `player.setCheckpoint(...)`.
 *  Production uses `sessionStorage` so the checkpoint survives a
 *  death-triggered `location.reload()`; tests inject the in-memory
 *  variant.
 *
 *  Out of scope: persistence across browser tabs / restarts. That would
 *  be a save-game concern — see `docs/script-engine-slice-3-plan.md` §4.3. */
export interface CheckpointStore {
    get(): VoxelCoord | null
    set(pos: VoxelCoord): void
    clear(): void
}

/** Web-Storage-backed store (any object satisfying the Storage API).
 *  Production passes `sessionStorage`; tests pass a fake. Silently
 *  degrades to a no-op if the storage object throws on access (quota
 *  exceeded, disabled storage, malformed JSON in the slot, …). */
export function createWebStorageCheckpointStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, key: string): CheckpointStore {
    return {
        get() {
            try {
                const raw = storage.getItem(key)
                if (!raw) return null
                const parsed = JSON.parse(raw) as Partial<VoxelCoord>
                if (!isFiniteCoord(parsed)) return null
                return { x: parsed.x!, y: parsed.y!, z: parsed.z! }
            } catch {
                return null
            }
        },
        set(pos) {
            if (!isFiniteCoord(pos)) return
            try {
                storage.setItem(key, JSON.stringify({ x: pos.x, y: pos.y, z: pos.z }))
            } catch {
                // sessionStorage can throw on quota / disabled storage; the
                // in-memory `world.lastCheckpoint` still holds, so the
                // current session keeps working — only the post-reload
                // restoration breaks.
            }
        },
        clear() {
            try { storage.removeItem(key) } catch { /* see above */ }
        },
    }
}

/** Session-storage-backed store keyed per level. Thin wrapper over
 *  `createWebStorageCheckpointStore` that picks up the browser's
 *  `sessionStorage` global. */
export function createSessionCheckpointStore(key: string): CheckpointStore {
    return createWebStorageCheckpointStore(sessionStorage, key)
}

/** Build the per-location storage key. Strips characters that would make the
 *  key ambiguous in inspection tooling, collapses whitespace, and falls
 *  back to a literal `'untitled'` when the location id/name is empty. */
export function checkpointStorageKey(locationId: string): string {
    const sanitised = locationId
        .replace(/[\x00-\x1f\x7f]+/g, '')
        .trim()
        .replace(/\s+/g, '-')
    return `vp:checkpoint:${sanitised || 'untitled'}`
}

/** Map-backed implementation for tests. */
export function createMemoryCheckpointStore(): CheckpointStore {
    let saved: VoxelCoord | null = null
    return {
        get() { return saved ? { ...saved } : null },
        set(pos) {
            if (!isFiniteCoord(pos)) return
            saved = { x: pos.x, y: pos.y, z: pos.z }
        },
        clear() { saved = null },
    }
}

function isFiniteCoord(pos: Partial<VoxelCoord> | null | undefined): pos is VoxelCoord {
    return !!pos
        && Number.isFinite(pos.x)
        && Number.isFinite(pos.y)
        && Number.isFinite(pos.z)
}

/** Resolve the effective spawn for a freshly-loaded level: an active
 *  checkpoint wins over the level's authored spawn. Pure — used by both
 *  the production wiring and tests. */
export function resolveSpawn(authored: VoxelCoord, store: CheckpointStore): VoxelCoord {
    const stored = store.get()
    return stored ?? authored
}

import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { serializeLevel } from '../engine/voxel/level-serializer'
import { toLevelMeta, type EditorState } from './editor-state'

/** sessionStorage key the game side reads when launched via `?level=playtest`. */
export const PLAYTEST_STORAGE_KEY = 'vp:playtest-level'

const PLAYTEST_DB_NAME = 'vp-playtest'
const PLAYTEST_DB_VERSION = 1
const PLAYTEST_DB_STORE = 'levels'
const PLAYTEST_DB_KEY = 'current'

interface IndexedDbPlaytestPointer {
    transport: 'indexeddb'
    db: string
    store: string
    key: string
    bytes: number
    createdAt: number
}

/**
 * Snapshot the editor's current level (chunks + metadata) and hand it to the
 * game entry. Large snapshots are stored in IndexedDB and referenced by a tiny
 * `sessionStorage` pointer, then the editor redirects to
 * `index.html?level=playtest`. The game's `client.ts` picks the snapshot up and
 * loads it instead of generating the demo level.
 *
 * If IndexedDB is unavailable, small levels fall back to the legacy base64
 * sessionStorage transport. Large levels need IndexedDB because base64 exceeds
 * common sessionStorage quotas.
 */
export function launchPlaytest(chunks: ChunkManager, editorState: EditorState, name = 'playtest-level'): void {
    // Placement systems consume pointer clicks in the fixed-step loop. If the
    // user places an object and immediately presses Playtest, serialize on the
    // next animation frame so the scheduler can run the pending fixed step
    // first and include the latest placement in the snapshot.
    requestAnimationFrame(() => {
        void (async () => {
            const meta = toLevelMeta(editorState, name)
            const buffer = serializeLevel(chunks, meta)
            const written = await writePlaytestLevel(buffer)
            if (!written) return
            // Same-origin navigation — preserves any hash routing the host page uses.
            window.location.href = './index.html?level=playtest'
        })()
    })
}

/**
 * Read the saved playtest level back as a fresh ArrayBuffer. Returns null if the
 * pointer/snapshot is missing or fails to decode. The caller falls back to the
 * procedural demo level when null.
 */
export async function consumePlaytestLevel(): Promise<ArrayBuffer | null> {
    const encoded = readSessionStorage(PLAYTEST_STORAGE_KEY)
    if (!encoded) return null
    const pointer = readIndexedDbPointer(encoded)
    if (pointer) {
        try {
            const buffer = await readIndexedDbLevel(pointer.key)
            if (buffer) return buffer
            console.error('Playtest: IndexedDB snapshot was missing; falling back to demo.')
            return null
        } catch (err) {
            console.error('Playtest: failed to read level from IndexedDB', err)
            return null
        }
    }
    try {
        const bytes = decodeBase64(encoded)
        // Copy into a fresh ArrayBuffer so the return type is firmly
        // ArrayBuffer (not ArrayBufferLike, which Uint8Array.buffer can be).
        const out = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(out).set(bytes)
        return out
    } catch (err) {
        console.error('Playtest: failed to decode level from sessionStorage', err)
        return null
    }
}

async function writePlaytestLevel(buffer: ArrayBuffer): Promise<boolean> {
    try {
        await writeIndexedDbLevel(buffer)
        const pointer: IndexedDbPlaytestPointer = {
            transport: 'indexeddb',
            db: PLAYTEST_DB_NAME,
            store: PLAYTEST_DB_STORE,
            key: PLAYTEST_DB_KEY,
            bytes: buffer.byteLength,
            createdAt: Date.now(),
        }
        sessionStorage.setItem(PLAYTEST_STORAGE_KEY, JSON.stringify(pointer))
        return true
    } catch (err) {
        console.warn('Playtest: failed to write IndexedDB snapshot; trying sessionStorage fallback.', err)
    }

    const encoded = encodeBase64(new Uint8Array(buffer))
    try {
        sessionStorage.setItem(PLAYTEST_STORAGE_KEY, encoded)
        return true
    } catch (err) {
        console.error('Playtest: failed to write sessionStorage', err)
        return false
    }
}

function readSessionStorage(key: string): string | null {
    try {
        return sessionStorage.getItem(key)
    } catch (err) {
        console.error('Playtest: failed to read sessionStorage', err)
        return null
    }
}

function readIndexedDbPointer(encoded: string): IndexedDbPlaytestPointer | null {
    try {
        const parsed = JSON.parse(encoded) as Partial<IndexedDbPlaytestPointer>
        if (
            parsed.transport === 'indexeddb' &&
            parsed.db === PLAYTEST_DB_NAME &&
            parsed.store === PLAYTEST_DB_STORE &&
            typeof parsed.key === 'string' &&
            parsed.key.length > 0
        ) {
            return {
                transport: 'indexeddb',
                db: PLAYTEST_DB_NAME,
                store: PLAYTEST_DB_STORE,
                key: parsed.key,
                bytes: typeof parsed.bytes === 'number' && Number.isFinite(parsed.bytes) ? parsed.bytes : 0,
                createdAt: typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt) ? parsed.createdAt : 0,
            }
        }
        return null
    } catch {
        return null
    }
}

async function writeIndexedDbLevel(buffer: ArrayBuffer): Promise<void> {
    const db = await openPlaytestDb()
    try {
        await idbRequest(db.transaction(PLAYTEST_DB_STORE, 'readwrite').objectStore(PLAYTEST_DB_STORE).put(buffer, PLAYTEST_DB_KEY))
    } finally {
        db.close()
    }
}

async function readIndexedDbLevel(key: string): Promise<ArrayBuffer | null> {
    const db = await openPlaytestDb()
    try {
        const value = await idbRequest(db.transaction(PLAYTEST_DB_STORE, 'readonly').objectStore(PLAYTEST_DB_STORE).get(key))
        if (!(value instanceof ArrayBuffer)) return null
        const out = new ArrayBuffer(value.byteLength)
        new Uint8Array(out).set(new Uint8Array(value))
        return out
    } finally {
        db.close()
    }
}

function openPlaytestDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
            reject(new Error('IndexedDB is unavailable.'))
            return
        }
        const request = indexedDB.open(PLAYTEST_DB_NAME, PLAYTEST_DB_VERSION)
        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(PLAYTEST_DB_STORE)) db.createObjectStore(PLAYTEST_DB_STORE)
        }
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'))
        request.onblocked = () => reject(new Error('IndexedDB open was blocked.'))
        request.onsuccess = () => resolve(request.result)
    })
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
        request.onsuccess = () => resolve(request.result)
    })
}

/** Base64 helpers — Uint8Array ↔ atob/btoa with byte safety. */
function encodeBase64(bytes: Uint8Array): string {
    // Chunk the conversion so we don't blow the call stack on big levels.
    const chunkSize = 0x8000
    let binary = ''
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize)
        binary += String.fromCharCode.apply(null, chunk as unknown as number[])
    }
    return btoa(binary)
}

function decodeBase64(s: string): Uint8Array {
    const binary = atob(s)
    const out = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
    return out
}

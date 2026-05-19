import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { serializeLevel } from '../engine/voxel/level-serializer'
import { toLevelMeta, type EditorState } from './editor-state'

/** sessionStorage key the game side reads when launched via `?level=playtest`. */
export const PLAYTEST_STORAGE_KEY = 'vp:playtest-level'

/**
 * Snapshot the editor's current level (chunks + metadata) and hand it to the
 * game entry. Encodes the binary level file as base64 in `sessionStorage`,
 * then redirects to `index.html?level=playtest`. The game's `client.ts`
 * picks the snapshot up by key and loads it instead of generating the demo
 * level.
 *
 * sessionStorage (not localStorage) so the snapshot evaporates when the
 * editor tab closes — the user shouldn't see stale playtest data three days
 * later.
 */
export function launchPlaytest(chunks: ChunkManager, editorState: EditorState, name = 'playtest-level'): void {
    // Placement systems consume pointer clicks in the fixed-step loop. If the
    // user places an object and immediately presses Playtest, serialize on the
    // next animation frame so the scheduler can run the pending fixed step
    // first and include the latest placement in the snapshot.
    requestAnimationFrame(() => {
        const meta = toLevelMeta(editorState, name)
        const buffer = serializeLevel(chunks, meta)
        const encoded = encodeBase64(new Uint8Array(buffer))
        try {
            sessionStorage.setItem(PLAYTEST_STORAGE_KEY, encoded)
        } catch (err) {
            console.error('Playtest: failed to write sessionStorage', err)
            return
        }
        // Same-origin navigation — preserves any hash routing the host page uses.
        window.location.href = './index.html?level=playtest'
    })
}

/**
 * Read the saved playtest level back as a fresh ArrayBuffer. Returns null if
 * the key is missing or fails to decode (e.g. user cleared storage between
 * tabs). The caller falls back to the procedural demo level when null.
 */
export function consumePlaytestLevel(): ArrayBuffer | null {
    const encoded = sessionStorage.getItem(PLAYTEST_STORAGE_KEY)
    if (!encoded) return null
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

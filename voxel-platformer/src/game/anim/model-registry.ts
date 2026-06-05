// Character model registry: optionally preloads Blender `.glb` rigs and serves
// them as clip sources, with the code reference rig as the fallback.
//
// By default CHARACTER_MODEL_URLS is empty, so the game makes no network request
// and every character uses the reference rig. Drop a conforming `.glb` into
// public/models/, add its id → URL here, and it loads at startup and replaces
// the reference rig for that character with zero other code changes.

import type { ClipSource } from '../../engine/anim'
import { COMBAT_REQUIRED_CLIP_IDS } from '../../engine/anim/core'
import { loadGltfClipSource } from '../../engine/anim/runtime/gltf-clip-source'

/** Character id → public glb URL. Empty by default: the player uses the existing
 *  procedural model (animated via the part-based clip source). Register an id
 *  here (e.g. `'player.player': '/models/reference-character.glb'`) to override a
 *  character with a Blender rig; it then wins in `playerProfile`. */
export const CHARACTER_MODEL_URLS: Record<string, string> = {}

const registry = new Map<string, ClipSource>()

/** Load every configured character model. Non-conforming or missing files log a
 *  warning and are skipped (the reference rig fills in). Awaited once at startup
 *  before the first spawn; a no-op when CHARACTER_MODEL_URLS is empty. */
export async function preloadCharacterModels(): Promise<void> {
    await Promise.all(Object.entries(CHARACTER_MODEL_URLS).map(async ([id, url]) => {
        try {
            registry.set(id, await loadGltfClipSource(url, COMBAT_REQUIRED_CLIP_IDS))
        } catch (err) {
            console.warn(`[anim] ${id}: ${(err as Error).message}\n[anim] falling back to the code reference rig.`)
        }
    }))
}

export function registeredCharacterSource(id: string): ClipSource | undefined {
    return registry.get(id)
}

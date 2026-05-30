// Character model registry: optionally preloads Blender `.glb` rigs and serves
// them as clip sources, with the code reference rig as the fallback.
//
// By default CHARACTER_MODEL_URLS is empty, so the game makes no network request
// and every character uses the reference rig. Drop a conforming `.glb` into
// public/models/, add its id → URL here, and it loads at startup and replaces
// the reference rig for that character with zero other code changes.

import type { ClipSource } from '../../engine/anim'
import { loadGltfClipSource } from '../../engine/anim/runtime/gltf-clip-source'

/** Character id → public glb URL. The `player.player` rig is the Blender
 *  reference character (built by `tools/build-reference-character.py`); other
 *  ids (e.g. `player.keeper`) fall through to the code reference rig, so both
 *  the glTF and code paths are exercised in-game. */
export const CHARACTER_MODEL_URLS: Record<string, string> = {
    'player.player': '/models/reference-character.glb',
}

const registry = new Map<string, ClipSource>()

/** Load every configured character model. Non-conforming or missing files log a
 *  warning and are skipped (the reference rig fills in). Awaited once at startup
 *  before the first spawn; a no-op when CHARACTER_MODEL_URLS is empty. */
export async function preloadCharacterModels(): Promise<void> {
    await Promise.all(Object.entries(CHARACTER_MODEL_URLS).map(async ([id, url]) => {
        try {
            registry.set(id, await loadGltfClipSource(url))
        } catch (err) {
            console.warn(`[anim] ${id}: ${(err as Error).message}\n[anim] falling back to the code reference rig.`)
        }
    }))
}

export function registeredCharacterSource(id: string): ClipSource | undefined {
    return registry.get(id)
}

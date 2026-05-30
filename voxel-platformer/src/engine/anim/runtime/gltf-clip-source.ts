// glTF / Blender clip source. Loads a `.glb`, validates it against the
// convention, and exposes it as a ClipSource. Each `instantiate()` deep-clones
// the rig with SkeletonUtils so every entity gets its own skeleton (plain
// Object3D.clone() shares the skeleton and breaks skinning); clip data is
// immutable and shared across instances.

import { type AnimationClip } from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { REQUIRED_CLIP_IDS } from '../core/convention'
import type { ClipSet, ClipSource } from './clip-source'
import { resolveSockets } from './sockets'
import { validateGltfAsset } from './blender-validator'

export class BlenderValidationError extends Error {
    constructor(readonly url: string, readonly errors: string[]) {
        super(`glTF "${url}" violates the Blender convention:\n - ${errors.join('\n - ')}`)
        this.name = 'BlenderValidationError'
    }
}

/** Fetch + parse a `.glb`, validate it, and wrap it as a ClipSource. Throws
 *  BlenderValidationError on a non-conforming file; logs warnings. */
export async function loadGltfClipSource(url: string, required: readonly string[] = REQUIRED_CLIP_IDS): Promise<ClipSource> {
    const gltf = await new GLTFLoader().loadAsync(url)
    const validation = validateGltfAsset(gltf, required)
    for (const w of validation.warnings) console.warn(`[anim] ${url}: ${w}`)
    if (!validation.ok) throw new BlenderValidationError(url, validation.errors)
    return gltfClipSource(gltf)
}

export function gltfClipSource(gltf: GLTF): ClipSource {
    const clips = new Map<string, AnimationClip>(gltf.animations.map((c) => [c.name, c]))
    return {
        kind: 'gltf',
        instantiate(): ClipSet {
            const root = cloneSkeleton(gltf.scene)
            return { root, clips, sockets: resolveSockets(root) }
        },
    }
}

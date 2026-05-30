// Validate a loaded glTF against the Blender authoring convention.
//
// Errors are hard failures (the asset can't drive the engine); warnings are
// advisory (the asset still works, but something is off — a missing optional
// socket, an unexpected scale). The name-rule checks reuse the pure
// `validateClipNames` / `validateSocketNames` from core/convention so the
// contract is single-sourced.

import { Box3, Vector3, type AnimationClip, type Object3D } from 'three'
import { REQUIRED_CLIP_IDS, SOCKET_NAMES, validateClipNames, validateSocketNames } from '../core/convention'

export interface GltfLike {
    scene: Object3D
    animations: AnimationClip[]
}

export interface BlenderValidation {
    ok: boolean
    errors: string[]
    warnings: string[]
}

export function validateGltfAsset(gltf: GltfLike, required: readonly string[] = REQUIRED_CLIP_IDS): BlenderValidation {
    const errors: string[] = []
    const warnings: string[] = []
    const scene = gltf.scene

    let hasSkinned = false
    let hasBone = false
    let hasArmature = false
    scene.traverse((o: Object3D) => {
        const any = o as { isSkinnedMesh?: boolean; isBone?: boolean }
        if (any.isSkinnedMesh) hasSkinned = true
        if (any.isBone) hasBone = true
        if (o.name === 'Armature') hasArmature = true
    })
    if (!hasSkinned) errors.push('no SkinnedMesh found — export a single skinned mesh bound to the armature')
    if (!hasBone) errors.push('no bones found — the armature did not export')
    if (!hasArmature) warnings.push("no node named 'Armature' — name the armature 'Armature' per the convention")

    const clipNames = gltf.animations.map((a) => a.name)
    const clips = validateClipNames(clipNames, required)
    if (!clips.ok) {
        errors.push(`missing required clips [${clips.missing.join(', ')}]; present: [${clipNames.join(', ') || 'none'}]`)
    }

    const presentSockets = SOCKET_NAMES.filter((n) => scene.getObjectByName(n))
    const sockets = validateSocketNames(presentSockets)
    if (sockets.missing.length > 0) {
        warnings.push(`optional sockets absent (those equip slots disabled): ${sockets.missing.join(', ')}`)
    }

    const box = new Box3().setFromObject(scene)
    if (Number.isFinite(box.min.y) && Number.isFinite(box.max.y)) {
        const size = box.getSize(new Vector3())
        if (Math.abs(box.min.y) > 0.15) {
            warnings.push(`origin is not at the feet (bbox min.y=${box.min.y.toFixed(2)}, expected ≈ 0)`)
        }
        if (size.y < 0.5 || size.y > 4) {
            warnings.push(`unusual height ${size.y.toFixed(2)} units (expected ≈ 1.6; check Blender unit scale)`)
        }
    }

    return { ok: errors.length === 0, errors, warnings }
}

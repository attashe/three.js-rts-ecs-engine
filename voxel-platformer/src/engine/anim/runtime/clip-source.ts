// The source-agnostic contract between clip providers and the controller.
//
// A ClipSet is everything an AnimationController needs: a root Object3D to
// animate, the named clips the state graph references, and the equipment socket
// nodes resolved by name. Both the code reference rig and a Blender .glb import
// produce this identical shape, so the controller never branches on origin.

import type { AnimationClip, Object3D } from 'three'

export interface ClipSet {
    /** Attach this under the entity's render root; the mixer drives it. */
    root: Object3D
    /** Clip id (== state id) → clip. */
    clips: Map<string, AnimationClip>
    /** Socket bone name (e.g. `socket.hand.R`) → node, for equipment. */
    sockets: Map<string, Object3D>
}

export interface ClipSource {
    readonly kind: 'reference' | 'gltf' | 'part'
    /** Build a fresh, independently-animatable instance (own skeleton + clips). */
    instantiate(): ClipSet
}

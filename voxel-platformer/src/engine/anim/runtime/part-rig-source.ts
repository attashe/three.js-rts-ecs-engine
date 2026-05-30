// Part-based clip source: animates an EXISTING part-based model Group (the
// hand-authored procedural characters — main character, keeper, troll) with
// procedural clips whose tracks target the model's named child nodes.
//
// It produces the same ClipSet contract as the skeletal reference rig / glTF
// source, so AnimationController, sockets, and equipment all work unchanged. The
// model just needs named, joint-pivoted limb nodes and `socket_*` groups (see
// main-character.ts) for the clips/sockets to resolve.

import { type AnimationClip, type Object3D } from 'three'
import { buildProcClip, type ProcClipDef } from './proc-clip-builder'
import { resolveSockets } from './sockets'
import type { ClipSet, ClipSource } from './clip-source'

export function partRigSource(buildModel: () => Object3D, clips: readonly ProcClipDef[]): ClipSource {
    return {
        kind: 'part',
        instantiate(): ClipSet {
            const root = buildModel()
            const clipMap = new Map<string, AnimationClip>()
            for (const def of clips) clipMap.set(def.name, buildProcClip(def))
            return { root, clips: clipMap, sockets: resolveSockets(root) }
        },
    }
}

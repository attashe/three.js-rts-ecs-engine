// Per-character animation profiles: which graph + which clip source drive a
// given character. Phase 1 always uses the code reference rig; Phase 2 will
// return a glTF source (with reference-rig fallback) for kinds backed by a
// Blender .glb in public/models/.

import { referenceRigSource, type ClipSource } from '../../engine/anim'
import type { AnimGraphDef } from '../../engine/anim/core'
import type { PlayerModelKind } from '../player-settings'
import { locomotionGraph } from './graph-defaults'
import { registeredCharacterSource } from './model-registry'

export interface CharacterAnimProfile {
    id: string
    graph: AnimGraphDef
    clipSource: ClipSource
}

const PLAYER_BODY_COLOR: Record<PlayerModelKind, number> = {
    player: 0x3f6f9f,
    keeper: 0x39324f,
}

export function playerProfile(kind: PlayerModelKind): CharacterAnimProfile {
    const id = `player.${kind}`
    return {
        id,
        graph: locomotionGraph(),
        // A preloaded Blender rig wins; otherwise the code reference rig.
        clipSource: registeredCharacterSource(id) ?? referenceRigSource({ bodyColor: PLAYER_BODY_COLOR[kind] }),
    }
}

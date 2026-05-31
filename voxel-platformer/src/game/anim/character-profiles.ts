// Per-character animation profiles: which graph + which clip source drive a
// given character. The player now uses the existing detailed procedural model
// (createMainCharacter) animated via the part-based clip source + the combat
// graph (idle/walk/run/jump/fall/land + attack/die). A registered Blender glb
// still wins when present; the code reference rig stays available to the
// animation page.

import { partRigSource, type ClipSource } from '../../engine/anim'
import type { AnimGraphDef } from '../../engine/anim/core'
import { createMainCharacter, type MainCharacterOptions } from '../assets'
import type { CharacterBeardKind } from '../character-appearance'
import type { PlayerModelKind } from '../player-settings'
import { combatLocomotionGraph } from './graph-defaults'
import { partCharacterClips } from './part-clips'
import { registeredCharacterSource } from './model-registry'

export interface CharacterAnimProfile {
    id: string
    graph: AnimGraphDef
    clipSource: ClipSource
}

export interface CharacterAppearanceOptions {
    beard?: CharacterBeardKind
}

const PLAYER_COLORS: Record<PlayerModelKind, MainCharacterOptions> = {
    player: {},
    keeper: { tunicColor: 0x1f2c3f, cloakColor: 0x3f2818, skinColor: 0xc89461, metalColor: 0xffc462, bootColor: 0x17120d },
}

export function playerProfile(kind: PlayerModelKind, appearance: CharacterAppearanceOptions = {}): CharacterAnimProfile {
    const id = `player.${kind}`
    const colors = PLAYER_COLORS[kind]
    return {
        id,
        graph: combatLocomotionGraph(),
        // A preloaded Blender rig wins (none registered by default); otherwise the
        // existing procedural model, animated via the part-based clip source.
        clipSource: registeredCharacterSource(id) ?? partRigSource(
            () => createMainCharacter({ ...colors, beard: appearance.beard ?? 'none' }),
            partCharacterClips(),
        ),
    }
}

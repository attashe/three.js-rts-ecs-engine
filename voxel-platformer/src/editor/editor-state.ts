import { DEFAULT_PALETTE } from '../engine/voxel'
import { PickupKind } from '../engine/ecs/systems/pickup-system'
import type { VoxelCoord } from '../engine/ecs/world'
import type { BrushKind } from './brush'

export type EditorMode = 'paint' | 'erase' | 'spawn-pickup'

export interface EditorPickup {
    /** World-space pickup position (foot of the visual). Stored in editor
     *  metadata so save/load round-trips preserve the placement. */
    position: { x: number; y: number; z: number }
    /** PickupKind from pickup-system. Only `Gold` for now. */
    kind: number
    /** Gold amount granted on collection. */
    amount: number
    /** Live entity id of the preview mesh in the editor scene, so we can
     *  despawn it when the metadata entry is removed. -1 when not spawned. */
    eid: number
}

export interface EditorState {
    /** Currently-selected palette index for paint mode. */
    activeBlock: number
    /** Currently-selected brush. */
    brush: BrushKind
    /** What clicks do. */
    mode: EditorMode
    /** Last cell the mouse raycast hit (in voxel coords). null when no hit. */
    cursor: VoxelCoord | null
    /** Spawn position the saved level reports back to the game loader. */
    spawn: { x: number; y: number; z: number }
    /** Pickups placed in the editor — serialised into the level metadata. */
    pickups: EditorPickup[]
    /** Pickup type for spawn-pickup mode. */
    pickupKind: number
    /** Pickup stack amount applied to placed gold piles. */
    pickupAmount: number
}

export function createEditorState(spawn: { x: number; y: number; z: number }): EditorState {
    // Default to grass (index 1) since it's the most common surface and
    // makes the cursor outline immediately readable.
    const grass = Math.max(1, DEFAULT_PALETTE.entries.findIndex((entry) => entry.name === 'grass'))
    return {
        activeBlock: grass,
        brush: 'single',
        mode: 'paint',
        cursor: null,
        spawn,
        pickups: [],
        pickupKind: PickupKind.Gold,
        pickupAmount: 12,
    }
}

/**
 * Shape of the JSON metadata blob saved inside the level binary. The game's
 * level loader reads this to reconstruct spawn + pickups on load.
 */
export interface EditorLevelMeta {
    name: string
    spawn: { x: number; y: number; z: number }
    pickups: Array<{
        position: { x: number; y: number; z: number }
        kind: number
        amount: number
    }>
}

export function toLevelMeta(state: EditorState, name: string): EditorLevelMeta {
    return {
        name,
        spawn: { ...state.spawn },
        pickups: state.pickups.map((p) => ({
            position: { ...p.position },
            kind: p.kind,
            amount: p.amount,
        })),
    }
}

import { BLOCK, DEFAULT_PALETTE } from '../engine/voxel'
import { PickupKind } from '../engine/ecs/systems/pickup-system'
import type { VoxelCoord } from '../engine/ecs/world'
import type { BrushKind } from './brush'
import type { PistonDirection } from './piston-direction'

export type EditorMode = 'paint' | 'erase' | 'spawn-pickup' | 'place-piston' | 'place-spawn'

/** Camera view used by the editor. `top-down` enables the working-plane cut. */
export type EditorViewMode = 'iso' | 'top-down'
export type EditorPistonMotion = 'teleport' | 'physical'

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

export interface EditorPiston {
    from: VoxelCoord
    to: VoxelCoord
    block: number
    delay: number
    /** Backward-compatible field for old saved metadata. Prefer `delay`. */
    interval?: number
    characterPolicy: 'block' | 'push'
    motion: EditorPistonMotion
    travelTime: number
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

    /** Pistons placed in the editor — serialised into the level metadata. */
    pistons: EditorPiston[]
    /** Direction for the next piston placement. */
    pistonDirection: PistonDirection
    /** Cell-count travelled by the next piston (from → to). */
    pistonDistance: number
    /** Seconds a piston waits at each endpoint before moving/flipping. */
    pistonDelay: number
    /** Piston movement implementation for the next placement. */
    pistonMotion: EditorPistonMotion
    /** Seconds a physical piston spends moving between endpoints. */
    pistonTravelTime: number
    /** Character handling on flip — see PistonMechanism.characterPolicy. */
    pistonPolicy: 'block' | 'push'

    /** Y-row of the working plane. Used by the cursor system as the placement
     *  Y when no voxel is hit, and (when planeLock is on) overrides voxel
     *  hits so the user can paint a specific layer through existing geometry. */
    workingPlaneY: number
    /** When true, the cursor always uses workingPlaneY regardless of voxel hits. */
    planeLock: boolean

    /** Camera view. In `top-down` mode the camera looks straight down and
     *  the near plane clips everything above `workingPlaneY`. */
    viewMode: EditorViewMode
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
        pistons: [],
        pistonDirection: 'up',
        pistonDistance: 2,
        pistonDelay: 2,
        pistonMotion: 'teleport',
        pistonTravelTime: 1,
        pistonPolicy: 'push',
        workingPlaneY: Math.floor(spawn.y),
        planeLock: false,
        viewMode: 'iso',
    }
}

/**
 * Shape of the JSON metadata blob saved inside the level binary. The game's
 * level loader reads this to reconstruct spawn + pickups + pistons on load.
 */
export interface EditorLevelMeta {
    name: string
    spawn: { x: number; y: number; z: number }
    pickups: Array<{
        position: { x: number; y: number; z: number }
        kind: number
        amount: number
    }>
    pistons: EditorPiston[]
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
        pistons: state.pistons.map((p) => ({
            from: { ...p.from },
            to: { ...p.to },
            block: p.block,
            delay: p.delay ?? p.interval ?? 2,
            characterPolicy: p.characterPolicy,
            motion: p.motion ?? 'teleport',
            travelTime: p.travelTime ?? 1,
        })),
    }
}

/** Re-export so editor-ui only needs editor-state to know default block ids. */
export { BLOCK }

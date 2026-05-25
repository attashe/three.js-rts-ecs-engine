import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { AIR } from '../../engine/voxel/palette'
import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import { despawnEntity } from '../../engine/ecs/entity'
import { registerPistonMechanism } from '../../game/mechanisms'
import { addOffset, pistonOffset } from '../piston-direction'
import type { EditorState } from '../editor-state'
import { handlePistonClicks } from './piston-clicks'

/**
 * One-click piston placement. With editor mode = 'place-piston', LMB on
 * any cell registers a piston whose `from` = clicked cell and `to` = cell +
 * direction × distance (taken from editorState.piston* fields). The block
 * for the piston is the active palette index, the initial occupied cell is
 * seeded via `registerPistonMechanism`.
 *
 * RMB removes the most-recently-placed piston (cheap-and-simple undo for
 * the editor; selection / per-row deletes still work via the UI panel).
 */
export function createPistonPlaceSystem(chunks: ChunkManager, input: Input, editorState: EditorState): System {
    return {
        fixed: true,
        // After voxel-paint-system and pickup-spawn-system; each system bails
        // out early when the editor mode isn't theirs, so coexistence works
        // even though all three call into the same input click queue.
        order: FixedOrder.input + 6,
        update(world) {
            if (editorState.mode !== 'place-piston') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return

            handlePistonClicks(clicks, {
                hasCursor: () => editorState.cursor !== null,
                place: () => placePiston(world, chunks, editorState),
                removeLast: () => removeLastPiston(world, chunks, editorState),
            })
        },
    }
}

function placePiston(world: GameWorld, chunks: ChunkManager, state: EditorState): void {
    const from = state.cursor
    if (!from) return
    const offset = pistonOffset(state.pistonDirection, state.pistonDistance)
    if (offset.x === 0 && offset.y === 0 && offset.z === 0) return
    const to = addOffset(from, offset)
    const moveSoundId = state.pistonMoveSoundId || undefined
    const moveSoundVolume = state.pistonMoveSoundVolume
    registerPistonMechanism(world, chunks, {
        from,
        to,
        block: state.activeBlock,
        delay: state.pistonDelay,
        motion: state.pistonMotion,
        travelTime: state.pistonTravelTime,
        characterPolicy: state.pistonPolicy,
        moveSoundId,
        moveSoundVolume,
    })
    state.pistons.push({
        from: { ...from },
        to: { ...to },
        block: state.activeBlock,
        delay: state.pistonDelay,
        motion: state.pistonMotion,
        travelTime: state.pistonTravelTime,
        characterPolicy: state.pistonPolicy,
        moveSoundId,
        moveSoundVolume,
    })
    pushLog(world, `Piston placed (${state.pistonMotion}, ${state.pistonDirection} ×${state.pistonDistance}, ${state.pistonPolicy}).`)
}

function removeLastPiston(world: GameWorld, chunks: ChunkManager, state: EditorState): void {
    if (state.pistons.length === 0) return
    removePistonAt(world, chunks, state, state.pistons.length - 1)
}

/**
 * Remove a specific piston by index. Used by both RMB undo (last index)
 * and the per-row remove button in the editor UI. Keeps `world.pistons`
 * and `state.pistons` in lockstep by splicing the same index from both —
 * the editor is the only thing appending to either, so the index is
 * meaningful across both arrays.
 *
 * Tears down whatever the piston owns: a physical block's entity +
 * obstacle entry, or a teleport piston's voxel cells. For teleport, only
 * clears the cell whose block matches the piston — a player who painted
 * over the cell after placement keeps their paint instead of getting it
 * wiped to AIR.
 */
export function removePistonAt(
    world: GameWorld,
    chunks: ChunkManager,
    state: EditorState,
    index: number,
): void {
    if (index < 0 || index >= state.pistons.length) return
    const removed = state.pistons.splice(index, 1)[0]!
    const live = world.pistons.splice(index, 1)[0]
    if (live) {
        if (live.motion === 'physical') {
            world.obstacles.remove(live.eid)
            if (live.eid >= 0) despawnEntity(world, live.eid)
        } else {
            // For teleport pistons, the piston could be currently at
            // `from` *or* `to` (after a flip). Clear whichever cell still
            // holds the piston's block; leave anything else alone so user
            // paint over the piston's cells survives the removal.
            clearIfBlock(chunks, live.from, live.block)
            clearIfBlock(chunks, live.to, live.block)
        }
    }
    pushLog(world, `Removed piston @ (${removed.from.x}, ${removed.from.y}, ${removed.from.z}).`)
}

export function removePistonsTouchingCells(
    world: GameWorld,
    chunks: ChunkManager,
    state: EditorState,
    cells: readonly { x: number; y: number; z: number }[],
): number {
    if (state.pistons.length === 0 || cells.length === 0) return 0
    const cellKeys = new Set(cells.map((cell) => cellKey(cell)))
    let removed = 0
    for (let i = state.pistons.length - 1; i >= 0; i--) {
        const piston = state.pistons[i]!
        if (!cellKeys.has(cellKey(piston.from)) && !cellKeys.has(cellKey(piston.to))) continue
        removePistonAt(world, chunks, state, i)
        removed++
    }
    return removed
}

function clearIfBlock(chunks: ChunkManager, cell: { x: number; y: number; z: number }, block: number): void {
    if (chunks.getVoxel(cell.x, cell.y, cell.z) === block) {
        chunks.setVoxel(cell.x, cell.y, cell.z, AIR)
    }
}

function cellKey(cell: { x: number; y: number; z: number }): string {
    return `${cell.x},${cell.y},${cell.z}`
}

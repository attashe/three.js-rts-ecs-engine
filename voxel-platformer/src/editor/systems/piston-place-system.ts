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
            if (!editorState.cursor) return

            for (const click of clicks) {
                if (click.button === 2) {
                    removeLastPiston(world, chunks, editorState)
                } else {
                    placePiston(world, chunks, editorState)
                }
            }
        },
    }
}

function placePiston(world: GameWorld, chunks: ChunkManager, state: EditorState): void {
    const from = state.cursor
    if (!from) return
    const offset = pistonOffset(state.pistonDirection, state.pistonDistance)
    if (offset.x === 0 && offset.y === 0 && offset.z === 0) return
    const to = addOffset(from, offset)
    registerPistonMechanism(world, chunks, {
        from,
        to,
        block: state.activeBlock,
        delay: state.pistonDelay,
        motion: state.pistonMotion,
        travelTime: state.pistonTravelTime,
        characterPolicy: state.pistonPolicy,
    })
    state.pistons.push({
        from: { ...from },
        to: { ...to },
        block: state.activeBlock,
        delay: state.pistonDelay,
        motion: state.pistonMotion,
        travelTime: state.pistonTravelTime,
        characterPolicy: state.pistonPolicy,
    })
    pushLog(world, `Piston placed (${state.pistonMotion}, ${state.pistonDirection} ×${state.pistonDistance}, ${state.pistonPolicy}).`)
}

function removeLastPiston(world: GameWorld, chunks: ChunkManager, state: EditorState): void {
    if (state.pistons.length === 0) return
    const removed = state.pistons.pop()!
    // Editor metadata index N matches world.pistons index N because the
    // editor is the only thing appending to world.pistons.
    const live = world.pistons.pop()
    // Clear the live cells the piston was occupying so RMB-undo doesn't
    // leave orphan blocks the user can't easily delete.
    if (live) {
        if (live.motion === 'physical') {
            world.obstacles.remove(live.eid)
            if (live.eid >= 0) despawnEntity(world, live.eid)
        } else {
            chunks.setVoxel(live.from.x, live.from.y, live.from.z, AIR)
            chunks.setVoxel(live.to.x, live.to.y, live.to.z, AIR)
        }
    }
    pushLog(world, `Removed last piston @ (${removed.from.x}, ${removed.from.y}, ${removed.from.z}).`)
}

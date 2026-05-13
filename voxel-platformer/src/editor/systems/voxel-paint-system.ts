import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { AIR } from '../../engine/voxel/palette'
import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { brushFootprint } from '../brush'
import type { EditorState } from '../editor-state'
import { pushLog } from '../../engine/ecs/world'

/**
 * Click-driven voxel editing. LMB applies the active block via the current
 * brush; RMB always erases (writes AIR) regardless of mode so the user has
 * a consistent undo gesture. The `spawn-pickup` mode bypasses this system —
 * pickup placement lives in pickup-spawn-system.
 *
 * All voxel writes go through `chunks.applyBulk` so the chunk renderer
 * remeshes affected chunks once per stroke instead of once per voxel.
 */
export function createVoxelPaintSystem(chunks: ChunkManager, input: Input, editorState: EditorState): System {
    return {
        fixed: true,
        order: FixedOrder.input,
        update(world) {
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return
            if (!editorState.cursor) return
            if (editorState.mode === 'spawn-pickup') return  // handled elsewhere

            // Process each click — same brush, same active block.
            let edits = 0
            for (const click of clicks) {
                const erase = click.button === 2 || editorState.mode === 'erase'
                const value = erase ? AIR : editorState.activeBlock
                const footprint = brushFootprint(editorState.brush, editorState.cursor)
                chunks.applyBulk(footprint.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, value })))
                edits += footprint.length
            }
            if (edits > 0) {
                const verb = editorState.mode === 'erase' ? 'Erased' : 'Painted'
                pushLog(world, `${verb} ${edits} cell${edits === 1 ? '' : 's'}.`)
            }
        },
    }
}

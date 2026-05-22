import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { AIR } from '../../engine/voxel/palette'
import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import type { GameWorld } from '../../engine/ecs/world'
import { brushFootprint } from '../brush'
import type { EditorState } from '../editor-state'
import { removePistonsTouchingCells } from './piston-place-system'

const LMB = 0
const RMB = 2

/**
 * Continuous voxel editing while the mouse button is held. LMB paints with
 * the active block; RMB erases. Only runs in `paint` / `erase` modes — the
 * placement modes (`spawn-pickup`, `place-piston`, `place-spawn`) own their
 * own click handlers and would otherwise double up with an unwanted paint.
 *
 * Deliberately polls `isMouseButtonDown` instead of `consumeClicks`. The
 * click filter drops anything held > 350 ms or dragged > 6 px, which kills
 * the natural press-and-drag-to-paint feel of a voxel editor. Polling each
 * fixed step paints once per tick (60 Hz) while held, and
 * `chunks.setVoxel` no-ops when a cell's value didn't change, so
 * re-painting the same cell while the cursor sits still is free.
 */
export function createVoxelPaintSystem(chunks: ChunkManager, input: Input, editorState: EditorState): System {
    return {
        fixed: true,
        order: FixedOrder.input,
        update(world) {
            if (editorState.mode !== 'paint' && editorState.mode !== 'erase') return
            if (!editorState.cursor) return
            const lmb = input.isMouseButtonDown(LMB)
            const rmb = input.isMouseButtonDown(RMB)
            if (!lmb && !rmb) return

            const erase = editorState.mode === 'erase' ? (lmb || rmb) : rmb
            const value = erase ? AIR : editorState.activeBlock
            const footprint = brushFootprint(editorState.brush, editorState.cursor)
            if (erase) removePistonsTouchingCells(world as GameWorld, chunks, editorState, footprint)
            chunks.applyBulk(footprint.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, value })))
        },
    }
}

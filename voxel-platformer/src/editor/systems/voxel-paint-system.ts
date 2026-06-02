import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { AIR } from '../../engine/voxel/palette'
import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import type { GameWorld, VoxelCoord } from '../../engine/ecs/world'
import { brushDragFootprint, brushFootprint, isDragBrush } from '../brush'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import { removePistonsTouchingCells } from './piston-place-system'

const LMB = 0
const RMB = 2

interface StrokeCell {
    x: number
    y: number
    z: number
    /** Block at the cell *before* the stroke first touched it. */
    before: number
    /** Latest block written by the stroke. */
    after: number
}

function brushOptions(state: EditorState) {
    return {
        columnHeight: state.brushColumnHeight,
        wallLength: state.brushWallLength,
    }
}

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
 *
 * Each stroke (mouse-down → mouse-up) becomes a single `Command` pushed to
 * the editor history, so Ctrl+Z reverts the whole stroke in one step.
 * Piston removals triggered by erase strokes are NOT included in the
 * command — Ctrl+Z restores the chunk cells but leaves the pistons gone.
 * Phase 2 of the history work covers that.
 */
export function createVoxelPaintSystem(
    chunks: ChunkManager,
    input: Input,
    editorState: EditorState,
    history?: CommandStack,
): System {
    // Stroke-local state. Each entry records the *first* `before` value at
    // a cell (so a multi-tick stroke that re-touches the same cell keeps
    // the right undo target) and the *latest* `after` value.
    let strokeActive = false
    let strokeErase = false
    let strokeDrag = false
    let strokeBrush = editorState.brush
    let strokeValue = AIR
    let dragAnchor: VoxelCoord | null = null
    let dragLast: VoxelCoord | null = null
    const strokeCells = new Map<string, StrokeCell>()

    function clearStroke(): void {
        strokeActive = false
        strokeDrag = false
        dragAnchor = null
        dragLast = null
        editorState.brushDragAnchor = null
    }

    function recordFootprint(
        world: GameWorld,
        footprint: readonly VoxelCoord[],
        value: number,
        erase: boolean,
    ): void {
        for (const cell of footprint) {
            const key = `${cell.x},${cell.y},${cell.z}`
            const existing = strokeCells.get(key)
            if (existing) {
                existing.after = value
            } else {
                const before = chunks.getVoxel(cell.x, cell.y, cell.z)
                strokeCells.set(key, { x: cell.x, y: cell.y, z: cell.z, before, after: value })
            }
        }

        if (erase) removePistonsTouchingCells(world, chunks, editorState, footprint)
        chunks.applyBulk(footprint.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, value })))
    }

    function applyDragStroke(world: GameWorld): void {
        if (!strokeDrag || !dragAnchor || !dragLast) return
        recordFootprint(world, brushDragFootprint(strokeBrush, dragAnchor, dragLast, brushOptions(editorState)), strokeValue, strokeErase)
    }

    function endStroke(): void {
        if (!strokeActive) return
        clearStroke()
        if (!history || strokeCells.size === 0) {
            strokeCells.clear()
            return
        }
        // Skip strokes that produced no net change (e.g. painted air over
        // air, or repainted the same colour onto itself).
        const cells = [...strokeCells.values()].filter((c) => c.before !== c.after)
        strokeCells.clear()
        if (cells.length === 0) return
        const label = strokeErase ? 'erase' : 'paint'
        history.pushApplied({
            label,
            apply: () => chunks.applyBulk(cells.map((c) => ({ x: c.x, y: c.y, z: c.z, value: c.after }))),
            revert: () => chunks.applyBulk(cells.map((c) => ({ x: c.x, y: c.y, z: c.z, value: c.before }))),
        })
    }

    return {
        fixed: true,
        order: FixedOrder.input,
        update(world) {
            const inPaintLike = editorState.mode === 'paint' || editorState.mode === 'erase'
            if (editorState.viewMode === 'orbit') {
                if (strokeActive) endStroke()
                if (!inPaintLike || !editorState.cursor) return
                const clicks = input.consumeClicks()
                if (clicks.length === 0) return
                for (const click of clicks) {
                    if (click.button !== LMB && click.button !== RMB) continue
                    const erase = editorState.mode === 'erase' || click.button === RMB
                    const value = erase ? AIR : editorState.activeBlock
                    strokeActive = true
                    strokeErase = erase
                    strokeDrag = false
                    strokeCells.clear()
                    recordFootprint(
                        world as GameWorld,
                        brushFootprint(editorState.brush, editorState.cursor, brushOptions(editorState)),
                        value,
                        erase,
                    )
                    endStroke()
                }
                return
            }
            const lmb = input.isMouseButtonDown(LMB)
            const rmb = input.isMouseButtonDown(RMB)
            const anyDown = lmb || rmb

            // If the user releases / switches modes mid-stroke, finalise
            // whatever was accumulated so far.
            if (strokeActive && (!anyDown || !inPaintLike)) {
                if (strokeDrag) applyDragStroke(world as GameWorld)
                endStroke()
            }

            if (!inPaintLike) return
            if (!editorState.cursor) {
                if (strokeActive) {
                    if (strokeDrag) applyDragStroke(world as GameWorld)
                    endStroke()
                }
                return
            }
            if (!anyDown) return

            const erase = editorState.mode === 'erase' ? (lmb || rmb) : rmb
            const value = erase ? AIR : editorState.activeBlock

            if (!strokeActive) {
                strokeActive = true
                strokeErase = erase
                strokeDrag = isDragBrush(editorState.brush)
                strokeBrush = editorState.brush
                strokeValue = value
                if (strokeDrag) {
                    dragAnchor = { ...editorState.cursor }
                    dragLast = { ...editorState.cursor }
                    editorState.brushDragAnchor = { ...editorState.cursor }
                }
                strokeCells.clear()
            }

            if (strokeDrag) {
                dragLast = { ...editorState.cursor }
                return
            }

            recordFootprint(
                world as GameWorld,
                brushFootprint(editorState.brush, editorState.cursor, brushOptions(editorState)),
                value,
                erase,
            )
        },
    }
}

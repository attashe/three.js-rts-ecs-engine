import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import {
    captureBeforeEdits,
    measureStructurePlacement,
    structurePlacementEdits,
} from '../../procedural-structures/asset'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import { resolveStructureAsset, structureTransformFromState } from '../structure-asset-cache'

/**
 * Click-to-place multi-block structures. Active only in `place-structure`
 * mode.
 *
 *  - **LMB** stamps the currently-configured structure asset at the editor
 *    cursor, baking its voxels into the level as one undoable bulk edit
 *    (Ctrl+Z reverts the whole structure in a single step). Because the
 *    structure becomes ordinary voxels it round-trips through save/load
 *    and the runtime with zero extra machinery.
 *  - **RMB** rerolls the procedural seed (no-op for prefabs) so the author
 *    can dial in a variant before committing.
 *
 * Placement reads `editorState.cursor` (resolved by the voxel-cursor
 * system to the empty cell on top of the surface under the pointer), so a
 * structure with a `bottom-center` anchor rests its base on that surface.
 */
export function createStructurePlaceSystem(
    input: Input,
    chunks: ChunkManager,
    editorState: EditorState,
    history: CommandStack,
): System {
    return {
        fixed: true,
        order: FixedOrder.input + 13,
        update(world) {
            if (editorState.mode !== 'place-structure') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return

            for (const click of clicks) {
                if (click.button === 2) {
                    rerollSeed(world as GameWorld, editorState)
                    continue
                }
                if (click.button !== 0) continue
                place(world as GameWorld, chunks, editorState, history)
            }
        },
    }
}

function rerollSeed(world: GameWorld, state: EditorState): void {
    if (state.structureSourceKind !== 'procedural') return
    const next = (state.structureSeed * 1103515245 + 12345) >>> 0
    state.structureSeed = next % 1_000_000
    pushLog(world, `Structure seed → ${state.structureSeed}.`)
}

function place(world: GameWorld, chunks: ChunkManager, state: EditorState, history: CommandStack): void {
    const cursor = state.cursor
    if (!cursor) return
    const asset = resolveStructureAsset(state, chunks.palette)
    if (asset.stats.voxelCount === 0) {
        pushLog(world, 'Structure is empty — nothing to place.')
        return
    }
    const transform = structureTransformFromState(state, cursor)
    const after = structurePlacementEdits(asset, transform)
    const before = captureBeforeEdits(chunks, after)
    history.push({
        label: `place ${asset.label}`,
        apply: () => { chunks.applyBulk(after) },
        revert: () => { chunks.applyBulk(before) },
    })
    const m = measureStructurePlacement(asset, transform)
    pushLog(world, `Placed ${asset.label} — ${m.bounds.width}×${m.bounds.height}×${m.bounds.depth}, ${after.length} voxels.`)
}

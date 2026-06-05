import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import {
    captureBeforeEdits,
    measureStructurePlacement,
    structurePlacementEdits,
    structurePropPlacements,
} from '../../procedural-structures/asset'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import { resolveStructureAsset, structureTransformFromState, wallEndpointsFromState, wallPlacementEditsFromState } from '../structure-asset-cache'

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
                    if (isWallPlacement(editorState) && editorState.structureWallStart) {
                        editorState.structureWallStart = null
                        pushLog(world as GameWorld, 'Wall start cleared.')
                        continue
                    }
                    rerollSeed(world as GameWorld, editorState)
                    continue
                }
                if (click.button !== 0) continue
                if (isWallPlacement(editorState)) placeWall(world as GameWorld, chunks, editorState, history)
                else place(world as GameWorld, chunks, editorState, history)
            }
        },
    }
}

function isWallPlacement(state: EditorState): boolean {
    return state.structureSourceKind === 'procedural' && state.structureKind === 'wall'
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
    const propPrefix = nextStructurePropPrefix(state, asset.label, cursor)
    const afterProps = structurePropPlacements(asset, transform, propPrefix)
    const afterPropIds = new Set(afterProps.map((p) => p.id))
    const before = captureBeforeEdits(chunks, after)
    history.push({
        label: `place ${asset.label}`,
        apply: () => {
            chunks.applyBulk(after)
            for (const prop of afterProps) {
                if (!state.props.some((existing) => existing.id === prop.id)) state.props.push({ ...prop, position: { ...prop.position } })
            }
        },
        revert: () => {
            chunks.applyBulk(before)
            for (let i = state.props.length - 1; i >= 0; i--) {
                if (afterPropIds.has(state.props[i]!.id)) state.props.splice(i, 1)
            }
        },
    })
    const m = measureStructurePlacement(asset, transform)
    const propText = afterProps.length > 0 ? `, ${afterProps.length} props` : ''
    pushLog(world, `Placed ${asset.label} — ${m.bounds.width}×${m.bounds.height}×${m.bounds.depth}, ${after.length} voxels${propText}.`)
}

function nextStructurePropPrefix(state: EditorState, label: string, cursor: { x: number; y: number; z: number }): string {
    const root = `structure:${slug(label)}:${cursor.x}-${cursor.y}-${cursor.z}`
    let prefix = root
    let n = 2
    while (state.props.some((p) => p.id.startsWith(prefix + ':'))) {
        prefix = `${root}-${n}`
        n++
    }
    return prefix
}

function slug(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'structure'
}

function placeWall(world: GameWorld, chunks: ChunkManager, state: EditorState, history: CommandStack): void {
    const cursor = state.cursor
    if (!cursor) return
    if (!state.structureWallStart) {
        state.structureWallStart = { ...cursor }
        const label = state.structureWallEndpointMode === 'tower-socket' ? 'tower center' : 'wall start'
        pushLog(world, `${label} set at ${cursor.x}, ${cursor.y}, ${cursor.z}.`)
        return
    }
    const start = state.structureWallStart
    if (start.x === cursor.x && start.y === cursor.y && start.z === cursor.z) {
        pushLog(world, 'Move the cursor to a different cell to finish the wall.')
        return
    }
    const after = wallPlacementEditsFromState(state, start, cursor)
    if (after.length === 0) {
        pushLog(world, 'Wall is empty — nothing to place.')
        return
    }
    const before = captureBeforeEdits(chunks, after)
    history.push({
        label: 'place wall',
        apply: () => { chunks.applyBulk(after) },
        revert: () => { chunks.applyBulk(before) },
    })
    state.structureWallStart = null
    const [from, to] = wallEndpointsFromState(state, start, cursor)
    const width = Math.abs(to.x - from.x) + 1
    const depth = Math.abs(to.z - from.z) + 1
    pushLog(world, `Placed wall — ${width}×${depth} path span, ${after.length} voxels.`)
}

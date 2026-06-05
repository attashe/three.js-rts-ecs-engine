import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState } from '../src/editor/editor-state'
import { createCommandStack } from '../src/editor/history'
import { createStructurePlaceSystem } from '../src/editor/systems/structure-place-system'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { createGameWorld } from '../src/engine/ecs/world'
import type { ClickEvent, Input } from '../src/engine/input/input'

function fakeInput(clicks: ClickEvent[]): Input {
    let pending = clicks
    return {
        consumeClicks: () => {
            const out = pending
            pending = []
            return out
        },
    } as unknown as Input
}

test('placing a prefab structure also places embedded props undoably', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    const history = createCommandStack()
    state.mode = 'place-structure'
    state.structureSourceKind = 'prefab'
    state.structurePrefabId = 'train-station'
    state.cursor = { x: 20, y: 3, z: 30 }

    const system = createStructurePlaceSystem(
        fakeInput([{ x: 0, y: 0, button: 0 }]),
        chunks,
        state,
        history,
    )
    system.update(createGameWorld(), 0)

    assert.ok(countVoxels(chunks) > 0)
    assert.ok(state.props.length > 0)
    assert.ok(state.props.every((prop) => prop.id.startsWith('structure:train-station:20-3-30:')))

    history.undo()
    assert.equal(countVoxels(chunks), 0)
    assert.equal(state.props.length, 0)

    history.redo()
    assert.ok(countVoxels(chunks) > 0)
    assert.ok(state.props.length > 0)
})

function countVoxels(chunks: ChunkManager): number {
    let count = 0
    for (const chunk of chunks.allChunks()) count += chunk.nonAirCount
    return count
}


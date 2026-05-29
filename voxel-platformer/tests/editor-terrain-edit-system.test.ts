import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import type { Input } from '../src/engine/input/input'
import { createGameWorld } from '../src/engine/ecs/world'
import { createCommandStack } from '../src/editor/history'
import { createTerrainEditSystem } from '../src/editor/systems/terrain-edit-system'
import type { EditorState } from '../src/editor/editor-state'

test('TerrainEditSystem: sculpt stroke writes once and undo restores the whole stroke', () => {
    const chunks = seededGround()
    const world = createGameWorld()
    const history = createCommandStack()
    let lmbDown = true
    const input = {
        isMouseButtonDown: (button: number) => button === 0 && lmbDown,
    } as unknown as Input
    const state = terrainState({ terrainTool: 'sculpt', cursor: { x: 1, y: 4, z: 1 } })
    const system = createTerrainEditSystem(chunks, input, state, history)

    system.update(world, 0.1)
    assert.equal(chunks.getVoxel(1, 5, 1), BLOCK.grass)

    lmbDown = false
    system.update(world, 0.1)
    assert.equal(history.undoDepth(), 1)

    history.undo()
    assert.equal(chunks.getVoxel(1, 5, 1), BLOCK.air)
    assert.equal(chunks.getVoxel(1, 4, 1), BLOCK.grass)
})

test('TerrainEditSystem: ramp previews during drag and commits on release', () => {
    const chunks = seededGround()
    const world = createGameWorld()
    const history = createCommandStack()
    let lmbDown = true
    const input = {
        isMouseButtonDown: (button: number) => button === 0 && lmbDown,
    } as unknown as Input
    const state = terrainState({
        terrainTool: 'ramp',
        terrainRadius: 0,
        terrainTargetHeight: 8,
        terrainRepaintTop: true,
        activeBlock: BLOCK.stone,
        cursor: { x: 0, y: 4, z: 1 },
    })
    const system = createTerrainEditSystem(chunks, input, state, history)

    system.update(world, 0.1)
    state.cursor = { x: 4, y: 4, z: 1 }
    system.update(world, 0.1)
    assert.equal(chunks.getVoxel(4, 8, 1), BLOCK.air, 'drag preview must not mutate chunks')
    assert.deepEqual(state.terrainDragAnchor, { x: 0, y: 4, z: 1 })

    lmbDown = false
    system.update(world, 0.1)
    assert.equal(chunks.getVoxel(4, 8, 1), BLOCK.stone)
    assert.equal(state.terrainDragAnchor, null)
    assert.equal(history.undoDepth(), 1)
})

function terrainState(overrides: Partial<EditorState>): EditorState {
    return {
        mode: 'terrain',
        cursor: { x: 0, y: 4, z: 0 },
        activeBlock: BLOCK.grass,
        terrainTool: 'sculpt',
        terrainBrushShape: 'circle',
        terrainRadius: 0,
        terrainStrength: 1,
        terrainFalloff: 'hard',
        terrainTargetHeight: 4,
        terrainFillBlock: BLOCK.dirt,
        terrainRepaintTop: false,
        terrainMinY: 0,
        terrainMaxY: 16,
        terrainDragAnchor: null,
        ...overrides,
    } as EditorState
}

function seededGround(): ChunkManager {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x < 5; x++) {
        for (let z = 0; z < 5; z++) {
            for (let y = 0; y < 4; y++) chunks.setVoxel(x, y, z, BLOCK.dirt)
            chunks.setVoxel(x, 4, z, BLOCK.grass)
        }
    }
    return chunks
}

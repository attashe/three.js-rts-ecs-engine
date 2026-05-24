import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import type { Input } from '../src/engine/input/input'
import { createGameWorld } from '../src/engine/ecs/world'
import { createCommandStack } from '../src/editor/history'
import { createVoxelPaintSystem } from '../src/editor/systems/voxel-paint-system'
import type { EditorState } from '../src/editor/editor-state'

test('VoxelPaintSystem: cursor loss finalizes the current history stroke', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const history = createCommandStack()
    let lmbDown = true
    const input = {
        isMouseButtonDown: (button: number) => button === 0 && lmbDown,
    } as unknown as Input
    const state = {
        activeBlock: BLOCK.grass,
        brush: 'single',
        mode: 'paint',
        cursor: { x: 0, y: 0, z: 0 },
        pistons: [],
    } as unknown as EditorState
    const system = createVoxelPaintSystem(chunks, input, state, history)

    system.update(world, 1 / 60)
    assert.equal(chunks.getVoxel(0, 0, 0), BLOCK.grass)

    state.cursor = null
    system.update(world, 1 / 60)
    assert.equal(history.undoDepth(), 1, 'cursor loss commits the first stroke')

    state.cursor = { x: 1, y: 0, z: 0 }
    system.update(world, 1 / 60)
    lmbDown = false
    system.update(world, 1 / 60)

    assert.equal(history.undoDepth(), 2, 'second segment becomes its own stroke')
    history.undo()
    assert.equal(chunks.getVoxel(0, 0, 0), BLOCK.grass, 'undo keeps the earlier stroke intact')
    assert.equal(chunks.getVoxel(1, 0, 0), 0, 'undo reverts only the post-cursor-loss stroke')
})

test('VoxelPaintSystem: box brush previews during drag and fills on release', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const history = createCommandStack()
    let lmbDown = true
    const input = {
        isMouseButtonDown: (button: number) => button === 0 && lmbDown,
    } as unknown as Input
    const state = {
        activeBlock: BLOCK.brick,
        brush: 'box',
        brushDragAnchor: null,
        mode: 'paint',
        cursor: { x: 0, y: 0, z: 0 },
        pistons: [],
    } as unknown as EditorState
    const system = createVoxelPaintSystem(chunks, input, state, history)

    system.update(world, 1 / 60)
    assert.deepEqual(state.brushDragAnchor, { x: 0, y: 0, z: 0 })
    assert.equal(chunks.getVoxel(0, 0, 0), 0, 'box drag does not write until release')

    state.cursor = { x: 2, y: 0, z: 1 }
    system.update(world, 1 / 60)
    assert.equal(chunks.getVoxel(2, 0, 1), 0, 'drag preview still does not mutate chunks')

    lmbDown = false
    system.update(world, 1 / 60)

    assert.equal(state.brushDragAnchor, null, 'release clears drag preview anchor')
    assert.equal(history.undoDepth(), 1, 'completed box fill records one history command')
    for (let z = 0; z <= 1; z++) {
        for (let x = 0; x <= 2; x++) {
            assert.equal(chunks.getVoxel(x, 0, z), BLOCK.brick, `filled ${x},0,${z}`)
        }
    }

    history.undo()
    for (let z = 0; z <= 1; z++) {
        for (let x = 0; x <= 2; x++) {
            assert.equal(chunks.getVoxel(x, 0, z), 0, `undo cleared ${x},0,${z}`)
        }
    }
})

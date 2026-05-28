import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState, toLevelMeta } from '../src/editor/editor-state'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { serializeLevel } from '../src/engine/voxel/level-serializer'
import { loadLevelFromBuffer } from '../src/editor/save-load'
import { createGameWorld } from '../src/engine/ecs/world'
import { nextEditorPistonId } from '../src/editor/systems/piston-place-system'

test('piston id survives a save → load round-trip through the level binary', () => {
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    state.pistons.push({
        id: 'piston.elevator',
        from: { x: 4, y: 1, z: 4 },
        to: { x: 4, y: 3, z: 4 },
        block: BLOCK.plank,
        delay: 2,
        motion: 'teleport',
        travelTime: 1,
        characterPolicy: 'push',
    })
    state.pistons.push({
        id: 'piston-2',
        from: { x: 8, y: 1, z: 4 },
        to: { x: 9, y: 1, z: 4 },
        block: BLOCK.brick,
        delay: 1,
        motion: 'teleport',
        travelTime: 1,
        characterPolicy: 'block',
    })

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = toLevelMeta(state, 'piston-id-test')
    assert.equal(meta.pistons[0]!.id, 'piston.elevator')
    assert.equal(meta.pistons[1]!.id, 'piston-2')

    const buffer = serializeLevel(chunks, meta)
    const restoreState = createEditorState({ x: 0, y: 0, z: 0 })
    loadLevelFromBuffer(buffer, createGameWorld(), new ChunkManager(DEFAULT_PALETTE), restoreState)

    assert.equal(restoreState.pistons.length, 2)
    assert.equal(restoreState.pistons[0]!.id, 'piston.elevator')
    assert.equal(restoreState.pistons[1]!.id, 'piston-2')
})

test('legacy pistons without an id load cleanly (id stays undefined)', () => {
    // Build a metadata blob manually without `id` to mimic a level saved
    // before the field existed. The loader must not crash; pistons without
    // an id are simulated but not script-targetable.
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    const meta = toLevelMeta(state, 'legacy')
    meta.pistons = [{
        from: { x: 4, y: 1, z: 4 },
        to: { x: 4, y: 3, z: 4 },
        block: BLOCK.plank,
        delay: 2,
        motion: 'teleport',
        travelTime: 1,
        characterPolicy: 'push',
    }] as Array<typeof meta.pistons[number]>

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const buffer = serializeLevel(chunks, meta)
    const restoreState = createEditorState({ x: 0, y: 0, z: 0 })
    const world = createGameWorld()
    loadLevelFromBuffer(buffer, world, new ChunkManager(DEFAULT_PALETTE), restoreState)

    assert.equal(restoreState.pistons.length, 1)
    assert.equal(restoreState.pistons[0]!.id, undefined)
    assert.equal(world.pistonsById.size, 0, 'pistons without an id are never indexed')
})

test('nextEditorPistonId auto-generates increasing ids and fills gaps after a delete', () => {
    assert.equal(nextEditorPistonId([]), 'piston-1')
    assert.equal(nextEditorPistonId([{ id: 'piston-1' }]), 'piston-2')
    assert.equal(nextEditorPistonId([{ id: 'piston-1' }, { id: 'piston-3' }]), 'piston-4')
    // Author-named ids never confuse the auto-counter.
    assert.equal(nextEditorPistonId([{ id: 'piston.elevator' }]), 'piston-1')
})

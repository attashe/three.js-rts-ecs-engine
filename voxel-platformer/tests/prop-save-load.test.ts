import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState, toLevelMeta } from '../src/editor/editor-state'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { serializeLevel } from '../src/engine/voxel/level-serializer'
import { loadLevelFromBuffer } from '../src/editor/save-load'
import { createGameWorld } from '../src/engine/ecs/world'

test('props survive a save → load round-trip through the level binary', () => {
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    state.props.push({
        id: 'prop-flower-1',
        kind: 'flower',
        position: { x: 4.5, y: 2.0, z: 7.5 },
        yaw: 1.2,
        scale: 1.4,
        gridAligned: true,
    })
    state.props.push({
        id: 'prop-bush-2',
        kind: 'bush',
        position: { x: -3.1, y: 0.0, z: 2.2 },
        yaw: 0,
        scale: 0.9,
        gridAligned: false,
    })

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = toLevelMeta(state, 'props-test')
    assert.ok(meta.props, 'toLevelMeta must include props when state.props is non-empty')
    assert.equal(meta.props!.length, 2)

    const buffer = serializeLevel(chunks, meta)
    const restoreState = createEditorState({ x: 0, y: 0, z: 0 })
    assert.equal(restoreState.props.length, 0, 'sanity: fresh state starts with no props')

    loadLevelFromBuffer(buffer, createGameWorld(), new ChunkManager(DEFAULT_PALETTE), restoreState)

    assert.equal(restoreState.props.length, 2)
    assert.deepEqual(restoreState.props[0], {
        id: 'prop-flower-1',
        kind: 'flower',
        position: { x: 4.5, y: 2.0, z: 7.5 },
        yaw: 1.2,
        scale: 1.4,
        gridAligned: true,
    })
    assert.deepEqual(restoreState.props[1], {
        id: 'prop-bush-2',
        kind: 'bush',
        position: { x: -3.1, y: 0.0, z: 2.2 },
        yaw: 0,
        scale: 0.9,
        gridAligned: false,
    })
})

test('toLevelMeta omits props entirely when none are placed', () => {
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    const meta = toLevelMeta(state, 'empty')
    assert.equal(meta.props, undefined,
        'empty props array should not bloat the saved level format')
})

test('loadLevelFromBuffer defaults yaw/scale/gridAligned when meta omits them', () => {
    // Simulate an old save where these fields are missing or invalid.
    const state = createEditorState({ x: 0, y: 0, z: 0 })
    state.props = []
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = toLevelMeta(state, 'defaults')
    // Manually inject a malformed prop entry to test the loader's
    // defensive fallbacks. EditorLevelMeta.props is optional so we
    // build the array ourselves.
    meta.props = [{
        id: 'p-broken',
        kind: 'book',
        position: { x: 0, y: 0, z: 0 },
        yaw: Number.NaN as unknown as number,
        scale: -1,
        gridAligned: undefined as unknown as boolean,
    }]
    const buffer = serializeLevel(chunks, meta)

    const restoreState = createEditorState({ x: 0, y: 0, z: 0 })
    loadLevelFromBuffer(buffer, createGameWorld(), new ChunkManager(DEFAULT_PALETTE), restoreState)

    assert.equal(restoreState.props.length, 1)
    const p = restoreState.props[0]!
    assert.equal(p.yaw, 0, 'NaN yaw → 0')
    assert.equal(p.scale, 1, 'non-positive scale → 1')
    assert.equal(p.gridAligned, true, 'missing gridAligned → true (the default UI state)')
})

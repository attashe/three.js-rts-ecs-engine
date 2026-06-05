import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { serializeLevel } from '../src/engine/voxel/level-serializer'
import { createGameWorld } from '../src/engine/ecs/world'
import { createEditorState, toLevelMeta } from '../src/editor/editor-state'
import { loadLevelFromBuffer } from '../src/editor/save-load'
import { levelMetaFromEditor } from '../src/game/level-from-meta'

test('rail carts survive editor save/load and runtime meta conversion', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(3, 5, 7, BLOCK.rail)
    const state = createEditorState({ x: 0, y: 1, z: 0 })
    state.railCarts.push({
        id: 'cart.demo',
        railCell: { x: 3, y: 5, z: 7 },
        front: 'north',
        speed: 5.5,
        interactionRadius: 2.25,
        enabled: false,
    })

    const meta = toLevelMeta(state, 'rail-cart-test')
    assert.deepEqual(meta.railCarts, [{
        id: 'cart.demo',
        railCell: { x: 3, y: 5, z: 7 },
        front: 'north',
        speed: 5.5,
        interactionRadius: 2.25,
        enabled: false,
    }])

    const restored = createEditorState({ x: 0, y: 1, z: 0 })
    const buffer = serializeLevel(chunks, meta)
    loadLevelFromBuffer(buffer, createGameWorld(), new ChunkManager(DEFAULT_PALETTE), restored)
    assert.deepEqual(restored.railCarts, state.railCarts)

    const runtime = levelMetaFromEditor(toLevelMeta(restored, 'rail-cart-test'))
    assert.deepEqual(runtime.railCarts, state.railCarts)
})

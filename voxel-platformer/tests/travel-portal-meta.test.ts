import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState, toLevelMeta } from '../src/editor/editor-state'
import { loadLevelFromBuffer } from '../src/editor/save-load'
import { createGameWorld } from '../src/engine/ecs/world'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { serializeLevel } from '../src/engine/voxel/level-serializer'
import { levelMetaFromEditor } from '../src/game/level-from-meta'

test('portal zone metadata survives editor save/load and runtime translation', () => {
    const state = createEditorState({ x: 2, y: 5, z: 2 })
    state.stoneSpawners.push({
        id: 'spawner.cliff',
        enabled: true,
        position: { x: 9, y: 12, z: 9 },
        velocity: { x: 0, y: -4, z: 0 },
        interval: 3,
        delay: 0.75,
        maxLive: 2,
        jitter: 0.5,
        tier: 'rock',
        size: 0.4,
        options: { radius: 0.36 },
    })
    state.stones.push({
        id: 'stone.demo',
        position: { x: 7.5, y: 6, z: 7.5 },
        velocity: { x: 1, y: 0, z: 0 },
        tier: 'cobble',
        size: 0.22,
    })
    state.zones.push({
        id: 'exit-a',
        kind: 'portal',
        label: 'Basement door',
        min: { x: 4, y: 5, z: 4 },
        max: { x: 6, y: 8, z: 6 },
        triggerSources: ['player'],
        active: false,
        portal: { targetLevelId: 'basement', targetArrivalId: 'from-courtyard' },
        interaction: {
            prompt: 'Enter',
            anchor: { x: 5, y: 7, z: 5 },
            radius: 2.5,
        },
    })

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = toLevelMeta(state, 'courtyard')
    const runtime = levelMetaFromEditor(meta)
    assert.deepEqual(runtime.stoneSpawners[0], {
        id: 'spawner.cliff',
        enabled: true,
        position: { x: 9, y: 12, z: 9 },
        velocity: { x: 0, y: -4, z: 0 },
        interval: 3,
        delay: 0.75,
        maxLive: 2,
        jitter: 0.5,
        tier: 'rock',
        size: 0.4,
        options: { radius: 0.36 },
    })
    assert.deepEqual(runtime.stones[0], {
        id: 'stone.demo',
        position: { x: 7.5, y: 6, z: 7.5 },
        velocity: { x: 1, y: 0, z: 0 },
        tier: 'cobble',
        size: 0.22,
    })
    assert.deepEqual(runtime.zones[0]?.portal, {
        targetLevelId: 'basement',
        targetArrivalId: 'from-courtyard',
    })
    assert.equal(runtime.zones[0]?.active, false)
    assert.deepEqual(runtime.zones[0]?.interaction?.anchor, { x: 5, y: 7, z: 5 })

    const restoredState = createEditorState({ x: 0, y: 0, z: 0 })
    loadLevelFromBuffer(
        serializeLevel(chunks, meta),
        createGameWorld(),
        new ChunkManager(DEFAULT_PALETTE),
        restoredState,
    )
    assert.deepEqual(restoredState.zones[0]?.portal, {
        targetLevelId: 'basement',
        targetArrivalId: 'from-courtyard',
    })
    assert.equal(restoredState.zones[0]?.active, false)
    assert.deepEqual(restoredState.stoneSpawners[0]?.position, { x: 9, y: 12, z: 9 })
    assert.equal(restoredState.stoneSpawners[0]?.maxLive, 2)
    assert.deepEqual(restoredState.stones[0]?.position, { x: 7.5, y: 6, z: 7.5 })
    assert.equal(restoredState.zones[0]?.interaction?.prompt, 'Enter')
})

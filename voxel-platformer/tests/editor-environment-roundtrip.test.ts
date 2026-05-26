import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState, toLevelMeta } from '../src/editor/editor-state'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { serializeLevel } from '../src/engine/voxel/level-serializer'
import { loadLevelFromBuffer } from '../src/editor/save-load'
import { createGameWorld } from '../src/engine/ecs/world'
import { GameAudio } from '../src/game/audio'

// Regression test for the playtest round-trip bug: the editor's Level
// tab music selection used to silently revert to "(none)" every time
// the editor reopened, because `loadLevelFromBuffer` never restored
// `metadata.environment` into `editorState.environment`. The session
// restore path (`restoreSessionLevel` in editor.ts) is the most common
// way users hit this — Play → tweak → ← Editor and the track was gone.

test('loadLevelFromBuffer restores the environment music selection', () => {
    const editorState = createEditorState({ x: 0, y: 0, z: 0 })
    editorState.environment = { soundId: GameAudio.PianoQuiet, volume: 0.28 }

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = toLevelMeta(editorState, 'round-trip')
    const buffer = serializeLevel(chunks, meta)

    const restoreWorld = createGameWorld()
    const restoreChunks = new ChunkManager(DEFAULT_PALETTE)
    const restoreState = createEditorState({ x: 0, y: 0, z: 0 })
    assert.equal(restoreState.environment.soundId, null,
        'sanity: a fresh editor state starts with no track selected')

    loadLevelFromBuffer(buffer, restoreWorld, restoreChunks, restoreState)
    assert.equal(restoreState.environment.soundId, GameAudio.PianoQuiet)
    assert.equal(restoreState.environment.volume, 0.28)
})

test('loadLevelFromBuffer leaves environment alone when the metadata omits it', () => {
    // No track selected — toLevelMeta drops the `environment` field
    // entirely. The loader should NOT clobber the destination state's
    // default volume just because the metadata is absent.
    const editorState = createEditorState({ x: 0, y: 0, z: 0 })
    assert.equal(editorState.environment.soundId, null)

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = toLevelMeta(editorState, 'no-track')
    assert.equal(meta.environment, undefined,
        'sanity: a null soundId means the meta omits the environment field')
    const buffer = serializeLevel(chunks, meta)

    const restoreState = createEditorState({ x: 0, y: 0, z: 0 })
    restoreState.environment = { soundId: null, volume: 0.55 }
    loadLevelFromBuffer(
        buffer,
        createGameWorld(),
        new ChunkManager(DEFAULT_PALETTE),
        restoreState,
    )

    assert.equal(restoreState.environment.soundId, null)
    assert.equal(restoreState.environment.volume, 0.55)
})

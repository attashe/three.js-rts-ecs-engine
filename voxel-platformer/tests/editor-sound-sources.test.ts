import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState, toLevelMeta, type EditorLevelMeta } from '../src/editor/editor-state'
import { GameAudio } from '../src/game/audio'
import { levelMetaFromEditor } from '../src/game/level-from-meta'

test('editor level metadata includes sound sources by value', () => {
    const state = createEditorState({ x: 1, y: 2, z: 3 })
    state.soundSources.push({
        id: 'sound-1',
        soundId: GameAudio.AmbWater,
        label: 'river',
        position: { x: 4.5, y: 5.5, z: 6.5 },
        radius: 9,
        volume: 0.6,
        loop: true,
        autoplay: true,
    })

    const meta = toLevelMeta(state, 'sound-test')
    assert.deepEqual(meta.soundSources, [{
        id: 'sound-1',
        soundId: GameAudio.AmbWater,
        label: 'river',
        position: { x: 4.5, y: 5.5, z: 6.5 },
        radius: 9,
        volume: 0.6,
        loop: true,
        autoplay: true,
    }])

    meta.soundSources![0]!.position.x = 100
    assert.equal(state.soundSources[0]!.position.x, 4.5)
})

test('runtime level metadata maps sound sources and clamps unsafe values', () => {
    const meta: EditorLevelMeta = {
        name: 'sound-test',
        spawn: { x: 1, y: 2, z: 3 },
        pickups: [],
        pistons: [],
        zones: [],
        soundSources: [{
            id: 'sound-1',
            soundId: GameAudio.AmbLava,
            position: { x: 7, y: 8, z: 9 },
            radius: -4,
            volume: 2,
            loop: true,
            autoplay: true,
        }],
    }

    const runtime = levelMetaFromEditor(meta, 40)
    assert.deepEqual(runtime.soundSources, [{
        id: 'sound-1',
        soundId: GameAudio.AmbLava,
        label: undefined,
        position: { x: 7, y: 8, z: 9 },
        radius: 0.5,
        volume: 1,
        loop: true,
        autoplay: true,
    }])
})

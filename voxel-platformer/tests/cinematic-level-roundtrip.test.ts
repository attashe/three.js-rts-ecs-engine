import test from 'node:test'
import assert from 'node:assert/strict'
import { createEditorState, toLevelMeta } from '../src/editor/editor-state'
import { levelMetaFromEditor } from '../src/game/level-from-meta'
import { newStep, type Cinematic } from '../src/game/cinematics/cinematic-types'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { generateProceduralLevel } from '../src/game/procedural-levels'
import { TELEPORT_GARDEN_LEVEL_ID } from '../src/game/procedural-level-ids'

function sampleCinematic(): Cinematic {
    return {
        id: 'intro',
        name: 'Intro',
        playOnStart: true,
        letterbox: true,
        steps: [
            { id: 's1', type: 'camera', wait: true, duration: 2, ease: 'easeInOut', shot: { position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 }, zoom: 1.5 } },
            { id: 's2', type: 'subtitle', wait: false, duration: 3, text: 'At last...', speaker: 'Narrator' },
            { id: 's3', type: 'move', wait: true, npcId: 'arlen', to: { x: 7, y: 0, z: 8 }, timeoutSeconds: 6 },
            newStep('fade', 's4'),
        ],
    }
}

test('cinematics survive the editor → level-meta → runtime round-trip intact', () => {
    const state = createEditorState({ x: 0, y: 5, z: 0 })
    state.cinematics = [sampleCinematic()]

    const editorMeta = toLevelMeta(state, 'lvl')
    assert.equal(editorMeta.cinematics?.length, 1)

    const runtime = levelMetaFromEditor(editorMeta)
    assert.equal(runtime.cinematics?.length, 1)
    const c = runtime.cinematics![0]!
    assert.equal(c.id, 'intro')
    assert.equal(c.playOnStart, true)
    assert.equal(c.steps.length, 4)
    const cam = c.steps[0]
    assert.ok(cam.type === 'camera' && cam.shot.zoom === 1.5 && cam.shot.position.x === 1)
    const move = c.steps[2]
    assert.ok(move.type === 'move' && move.npcId === 'arlen' && move.to.z === 8)
})

test('the round-trip is a deep copy — mutating the runtime meta never touches editor state', () => {
    const state = createEditorState({ x: 0, y: 5, z: 0 })
    state.cinematics = [sampleCinematic()]
    const runtime = levelMetaFromEditor(toLevelMeta(state, 'lvl'))
    const cam = runtime.cinematics![0]!.steps[0]
    if (cam.type === 'camera') cam.shot.zoom = 99
    const original = state.cinematics[0]!.steps[0]
    assert.equal(original.type === 'camera' ? original.shot.zoom : null, 1.5)
})

test('the Teleport Garden ships a play-once arrival cinematic (camera orbit + text + music)', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generateProceduralLevel(TELEPORT_GARDEN_LEVEL_ID, chunks, {})
    const intro = meta.cinematics?.find((c) => c.id === 'garden-intro')
    assert.ok(intro, 'garden-intro cinematic is present on the generated level')
    assert.equal(intro!.playOnStart, true, 'auto-plays on first entry (client guards against replays)')
    const types = new Set(intro!.steps.map((s) => s.type))
    assert.ok(types.has('camera'), 'rotates the camera')
    assert.ok(types.has('subtitle'), 'shows background text')
    assert.ok(types.has('sound'), 'sets the music')
    // The camera steps trace a ring of distinct framings (an orbit).
    const cams = intro!.steps.filter((s) => s.type === 'camera')
    assert.ok(cams.length >= 4, 'several camera shots make the rotation')
})

test('an empty cinematics list is omitted from the serialized meta', () => {
    const state = createEditorState({ x: 0, y: 5, z: 0 })
    assert.equal(toLevelMeta(state, 'lvl').cinematics, undefined)
    // …and the runtime side defaults to an empty array, never undefined-explodes.
    assert.deepEqual(levelMetaFromEditor(toLevelMeta(state, 'lvl')).cinematics, [])
})

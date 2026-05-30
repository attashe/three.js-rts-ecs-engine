import test from 'node:test'
import assert from 'node:assert/strict'
import { partRigSource } from '../src/engine/anim'
import { partCharacterClips } from '../src/game/anim/part-clips'
import { createMainCharacter } from '../src/game/assets'
import { SOCKET_NAMES } from '../src/engine/anim/core'

// Guards the part-rig contract: the procedural clips and equipment sockets must
// resolve against the actual model node names. If main-character.ts renames or
// re-parents a joint (e.g. the Figure/Chest hierarchy), this fails loudly
// instead of silently animating nothing.

test('part rig instantiates with all clips and sockets resolved', () => {
    const source = partRigSource(() => createMainCharacter(), partCharacterClips())
    const { root, clips, sockets } = source.instantiate()

    const expectedClips = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'attack', 'shoot', 'die', 'dead']
    for (const id of expectedClips) assert.ok(clips.has(id), `clip ${id} present`)
    assert.equal(clips.size, expectedClips.length)

    for (const name of SOCKET_NAMES) assert.ok(sockets.has(name), `socket ${name} resolved`)
    assert.equal(sockets.size, SOCKET_NAMES.length)

    // The death topple node + the upper-body pivot must exist.
    assert.ok(root.getObjectByName('Figure'), 'Figure node exists')
    assert.ok(root.getObjectByName('Chest'), 'Chest node exists')
})

test('every clip track targets a real node in the model', () => {
    const root = createMainCharacter()
    for (const clip of partCharacterClips()) {
        for (const track of clip.tracks) {
            assert.ok(
                root.getObjectByName(track.target),
                `clip "${clip.name}" track targets missing node "${track.target}"`,
            )
        }
    }
})

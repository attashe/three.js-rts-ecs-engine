import test from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
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

    const expectedClips = ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'attack', 'spearAttack', 'attackWide', 'staffAttack', 'hammerAttack', 'shoot', 'shieldBlock', 'die', 'dead']
    for (const id of expectedClips) assert.ok(clips.has(id), `clip ${id} present`)
    assert.equal(clips.size, expectedClips.length)

    for (const name of SOCKET_NAMES) assert.ok(sockets.has(name), `socket ${name} resolved`)
    assert.equal(sockets.size, SOCKET_NAMES.length)

    // The death topple node + the upper-body pivot must exist.
    assert.ok(root.getObjectByName('Figure'), 'Figure node exists')
    assert.ok(root.getObjectByName('Chest'), 'Chest node exists')
})

test('shared humanoid model uses layered cloak panels instead of a cone tail', () => {
    const root = createMainCharacter()
    const cloak = root.getObjectByName('Cloak')

    assert.ok(cloak, 'cloak group exists')
    assert.ok(root.getObjectByName('CloakBackPanel'), 'cloak has an upper back panel')
    assert.ok(root.getObjectByName('CloakLowerPanel'), 'cloak has a lower panel')
    assert.ok(root.getObjectByName('CloakFoldL'), 'cloak has a left fold')
    assert.ok(root.getObjectByName('CloakFoldR'), 'cloak has a right fold')
    assert.equal(cloak!.parent?.name, 'Chest', 'cloak rides the animated upper body')
})

test('shoot draw pose keeps the arrow hand close to the bow hand', () => {
    const root = createMainCharacter()
    const chest = root.getObjectByName('Chest')
    const leftArm = root.getObjectByName('UpperArmL')
    const rightArm = root.getObjectByName('UpperArmR')
    const leftHand = root.getObjectByName('socket_hand_L')
    const rightHand = root.getObjectByName('socket_hand_R')

    assert.ok(chest)
    assert.ok(leftArm)
    assert.ok(rightArm)
    assert.ok(leftHand)
    assert.ok(rightHand)

    chest.rotation.set(0.015, 0.52, -0.02)
    leftArm.rotation.set(-1.52, -0.1, 0.02)
    rightArm.rotation.set(-1.26, 0.85, -0.5)
    root.updateMatrixWorld(true)

    const bowHand = leftHand.getWorldPosition(new Vector3())
    const arrowHand = rightHand.getWorldPosition(new Vector3())
    assert.ok(bowHand.distanceTo(arrowHand) < 0.58, 'draw hand should stay close enough to visually nock the arrow')
    assert.ok(Math.abs(bowHand.y - arrowHand.y) < 0.08, 'draw hand should stay near bow-hand height')
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

test('every part clip authors the whole-body figure pose', () => {
    for (const clip of partCharacterClips()) {
        assert.ok(
            clip.tracks.some((track) => track.target === 'Figure' && track.property === 'quaternion'),
            `clip "${clip.name}" resets or authors Figure.quaternion`,
        )
    }
})

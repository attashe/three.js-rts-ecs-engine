import test from 'node:test'
import assert from 'node:assert/strict'
import { AnimationClip, Group, Object3D, VectorKeyframeTrack } from 'three'
import { AnimationController, type ClipSet } from '../src/engine/anim'
import type { AnimGraphDef } from '../src/engine/anim/core'

function singleStateGraph(): AnimGraphDef {
    return {
        schemaVersion: 1,
        id: 'test.single',
        initial: 'idle',
        states: [{ id: 'idle', loop: 'loop' }],
        transitions: [],
    }
}

function clipSetWithIdle(): { root: Group; bone: Object3D; clipSet: ClipSet } {
    const root = new Group()
    const bone = new Object3D()
    bone.name = 'Bone'
    root.add(bone)
    const idle = new AnimationClip('idle', 1, [
        new VectorKeyframeTrack('Bone.position', [0, 1], [0, 0, 0, 0, 1, 0]),
    ])
    return {
        root,
        bone,
        clipSet: { root, sockets: new Map(), clips: new Map([['idle', idle]]) },
    }
}

test('controller update resumes a scrubbed active action', () => {
    const { bone, clipSet } = clipSetWithIdle()
    const controller = new AnimationController(clipSet, singleStateGraph())

    controller.scrub('idle', 0.1)
    const scrubbedY = bone.position.y
    controller.update(0.35)

    assert.ok(bone.position.y > scrubbedY + 0.2, 'scrubbed action resumed during normal update')
    controller.dispose()
})

test('playStateImmediate clears scrub pause before preview playback', () => {
    const { bone, clipSet } = clipSetWithIdle()
    const controller = new AnimationController(clipSet, singleStateGraph())

    controller.scrub('idle', 0.8)
    controller.playStateImmediate('idle')
    controller.advance(0.25)

    assert.ok(bone.position.y > 0.2 && bone.position.y < 0.3, 'preview action advanced after scrub')
    controller.dispose()
})

test('controller fails fast when graph states reference missing clips', () => {
    const { clipSet } = clipSetWithIdle()
    const graph: AnimGraphDef = {
        schemaVersion: 1,
        id: 'test.missing',
        initial: 'idle',
        states: [{ id: 'idle' }, { id: 'attack' }],
        transitions: [],
    }

    assert.throws(
        () => new AnimationController(clipSet, graph),
        /Animation graph "test\.missing" references missing clips: attack->attack/,
    )
})

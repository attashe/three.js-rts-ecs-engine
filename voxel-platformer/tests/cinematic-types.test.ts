import test from 'node:test'
import assert from 'node:assert/strict'
import {
    cloneCinematic,
    estimateDuration,
    estimateSpeechSeconds,
    newStep,
    stepDuration,
    validateCinematic,
    type Cinematic,
} from '../src/game/cinematics/cinematic-types'

function cinematic(steps: Cinematic['steps']): Cinematic {
    return { id: 'c1', name: 'Test', steps }
}

test('cloneCinematic is a deep copy — mutating the clone never touches the original', () => {
    const original = cinematic([
        newStep('camera', 's1'),
        newStep('move', 's2'),
    ])
    const copy = cloneCinematic(original)
    const cam = copy.steps[0]
    const move = copy.steps[1]
    if (cam.type === 'camera') cam.shot.position.x = 999
    if (move.type === 'move') move.to.z = 42
    copy.name = 'Changed'
    const origCam = original.steps[0]
    const origMove = original.steps[1]
    assert.equal(origCam.type === 'camera' ? origCam.shot.position.x : null, 0)
    assert.equal(origMove.type === 'move' ? origMove.to.z : null, 0)
    assert.equal(original.name, 'Test')
})

test('stepDuration: sound is instant, move uses its timeout, speech estimates from text', () => {
    assert.equal(stepDuration({ id: 's', type: 'sound', wait: false, soundId: 'x' }), 0)
    assert.equal(stepDuration({ id: 's', type: 'move', wait: true, npcId: 'n', to: { x: 0, y: 0, z: 0 }, timeoutSeconds: 5 }), 5)
    const speech = stepDuration({ id: 's', type: 'speech', wait: true, npcId: 'n', text: 'one two three four' })
    assert.equal(speech, estimateSpeechSeconds('one two three four'))
})

test('estimateDuration honours the wait/parallel model: only wait steps advance the clock', () => {
    // A 3s subtitle running concurrently (‖) with a 1s wait step → the
    // subtitle's tail (3s) outlasts the 1s clock advance, so total ≈ 3s.
    const c = cinematic([
        { id: 'a', type: 'subtitle', wait: false, duration: 3, text: 'hi' },
        { id: 'b', type: 'wait', wait: true, duration: 1 },
    ])
    assert.equal(estimateDuration(c), 3)

    // Two sequential (▶) waits sum.
    const seq = cinematic([
        { id: 'a', type: 'wait', wait: true, duration: 1 },
        { id: 'b', type: 'wait', wait: true, duration: 0.5 },
    ])
    assert.equal(estimateDuration(seq), 1.5)
})

test('validateCinematic flags empty, duplicate ids, and unknown NPC targets', () => {
    assert.deepEqual(validateCinematic(cinematic([])).length > 0, true)
    const dup = cinematic([newStep('wait', 'same'), newStep('wait', 'same')])
    assert.ok(validateCinematic(dup).some((p) => /Duplicate/.test(p)))
    const speaks = cinematic([{ id: 's', type: 'speech', wait: true, npcId: 'ghost', text: 'boo' }])
    const problems = validateCinematic(speaks, new Set(['real-npc']))
    assert.ok(problems.some((p) => /unknown NPC "ghost"/.test(p)))
    assert.equal(validateCinematic(speaks, new Set(['ghost'])).length, 0)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { DirectionalLight } from 'three'
import { createSunFollowSystem } from '../src/engine/render/sun-follow-system'
import type { GameWorld } from '../src/engine/ecs/world'

function makeSun(): DirectionalLight {
    const sun = new DirectionalLight(0xffffff, 1)
    sun.position.set(32, 60, 24)
    sun.target.position.set(12, 0, 12)
    return sun
}

test('sun-follow re-anchors the shadow frustum on the moving focus point', () => {
    const sun = makeSun()
    // sunOffset = sun.position - sun.target.position = (20, 60, 12)
    let focus = { x: 12, y: 0, z: 12 }
    const sys = createSunFollowSystem(sun, () => focus)

    sys.init!({} as GameWorld)
    assert.deepEqual(
        [sun.target.position.x, sun.target.position.y, sun.target.position.z],
        [12, 0, 12],
    )
    assert.deepEqual(
        [sun.position.x, sun.position.y, sun.position.z],
        [32, 60, 24],
    )

    // Move the focal point — sun direction stays the same, target moves.
    focus = { x: 50, y: 4, z: -30 }
    sys.update!({} as GameWorld, 1 / 60)
    assert.deepEqual(
        [sun.target.position.x, sun.target.position.y, sun.target.position.z],
        [50, 4, -30],
    )
    assert.deepEqual(
        [sun.position.x, sun.position.y, sun.position.z],
        [70, 64, -18],
    )
})

test('sun-follow preserves the sun direction across focus moves', () => {
    const sun = makeSun()
    const before = sun.position.clone().sub(sun.target.position)
    const focus = { x: -100, y: 0, z: 80 }
    const sys = createSunFollowSystem(sun, () => focus)
    sys.update!({} as GameWorld, 1 / 60)
    const after = sun.position.clone().sub(sun.target.position)
    assert.equal(after.x, before.x)
    assert.equal(after.y, before.y)
    assert.equal(after.z, before.z)
})

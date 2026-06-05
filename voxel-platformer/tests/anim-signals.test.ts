import test from 'node:test'
import assert from 'node:assert/strict'
import { computeLocomotionParams, LOCOMOTION_PARAM } from '../src/engine/anim/core'

const P = LOCOMOTION_PARAM

test('computeLocomotionParams encodes booleans as 0/1 and passes numbers through', () => {
    const grounded = computeLocomotionParams({ speedXZ: 2.5, vy: -1.2, grounded: true, blocked: false, movementState: 1 })
    assert.equal(grounded[P.speed], 2.5)
    assert.equal(grounded[P.vy], -1.2)
    assert.equal(grounded[P.grounded], 1)
    assert.equal(grounded[P.blocked], 0)
    assert.equal(grounded[P.moveState], 1)

    const airborneBlocked = computeLocomotionParams({ speedXZ: 0, vy: 5, grounded: false, blocked: true, movementState: 2 })
    assert.equal(airborneBlocked[P.grounded], 0)
    assert.equal(airborneBlocked[P.blocked], 1)
    assert.equal(airborneBlocked[P.vy], 5)
})

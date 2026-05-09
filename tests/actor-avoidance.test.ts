import test from 'node:test'
import assert from 'node:assert/strict'
import { steerAroundActors, type AvoidanceActor } from '../src/client/engine/ecs/actor-avoidance'

test('steerAroundActors keeps forward movement while adding lateral steer around a blocker', () => {
    const self: AvoidanceActor = { eid: 1, x: 0, y: 0, z: 0, radius: 0.32 }
    const blocker: AvoidanceActor = { eid: 2, x: 0, y: 0, z: 0.7, radius: 0.32 }

    const result = steerAroundActors(self, 0, 2, [self, blocker])

    assert.equal(result.avoided, true)
    assert.ok(result.z > 0, `expected continued forward movement, got z=${result.z}`)
    assert.ok(Math.abs(result.x) > 0.05, `expected lateral steering, got x=${result.x}`)
    assert.ok(Math.abs(Math.hypot(result.x, result.z) - 2) < 1e-6)
})

test('steerAroundActors separates from overlapping side actors', () => {
    const self: AvoidanceActor = { eid: 5, x: 0, y: 0, z: 0, radius: 0.32 }
    const blocker: AvoidanceActor = { eid: 8, x: 0.3, y: 0, z: 0.1, radius: 0.32 }

    const result = steerAroundActors(self, 0, 2, [self, blocker])

    assert.equal(result.avoided, true)
    assert.ok(result.x < 0, `expected steer away from right-side actor, got x=${result.x}`)
})

test('steerAroundActors ignores actors on different vertical layers', () => {
    const self: AvoidanceActor = { eid: 1, x: 0, y: 0, z: 0, radius: 0.32 }
    const blocker: AvoidanceActor = { eid: 2, x: 0, y: 3, z: 0.4, radius: 0.32 }

    const result = steerAroundActors(self, 0, 2, [self, blocker])

    assert.equal(result.avoided, false)
    assert.equal(result.x, 0)
    assert.equal(result.z, 2)
})


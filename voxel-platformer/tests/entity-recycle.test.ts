import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameWorld } from '../src/engine/ecs/world'
import { createEntity, despawnEntity } from '../src/engine/ecs/entity'
import { Rotation, Velocity, Position } from '../src/engine/ecs/components'

// Regression: bitecs recycles entity ids without clearing component data. A
// tumbling stone (physics writes Rotation.x/z) or an arrow (pitch) leaves stale
// transform on its id; when a player or rail cart later reuses that id, it would
// spawn tipped onto its side. createEntity must hand back zeroed transforms.

test('createEntity zeroes transform components on a recycled id', () => {
    const world = createGameWorld()

    const first = createEntity(world)
    Rotation.x[first] = 1.3
    Rotation.z[first] = -0.8
    Velocity.y[first] = 5
    Position.x[first] = 42
    despawnEntity(world, first)

    // Churn ids so the next create is likely to recycle `first`.
    const reused = createEntity(world)
    assert.equal(Rotation.x[reused], 0, 'pitch reset')
    assert.equal(Rotation.y[reused], 0, 'yaw reset')
    assert.equal(Rotation.z[reused], 0, 'roll reset')
    assert.equal(Velocity.x[reused], 0)
    assert.equal(Velocity.y[reused], 0)
    assert.equal(Velocity.z[reused], 0)
    assert.equal(Position.x[reused], 0)
})

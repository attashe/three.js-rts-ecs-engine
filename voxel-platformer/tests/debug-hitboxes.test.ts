import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameWorld } from '../src/engine/ecs/world'
import { __resetDebugInfoCache, setDebugInfoEnabled } from '../src/engine/render/render-settings'
import { clearDebugHitbox, pushDebugHitbox } from '../src/engine/ecs/debug-hitboxes'

test('debug hitboxes are gated by debug info and stable ids upsert', () => {
    __resetDebugInfoCache()
    const world = createGameWorld()

    setDebugInfoEnabled(false)
    pushDebugHitbox(world, {
        id: 'shield',
        kind: 'wedge',
        ttl: 0.1,
        color: [0.2, 0.8, 1],
        origin: { x: 0, y: 1, z: 0 },
        yaw: 0,
        range: 1,
        arcRadians: Math.PI / 2,
        minY: 0,
        maxY: 1.8,
    })
    assert.equal(world.debugHitboxes.length, 0)

    setDebugInfoEnabled(true)
    pushDebugHitbox(world, {
        id: 'shield',
        kind: 'wedge',
        ttl: 0.1,
        color: [0.2, 0.8, 1],
        origin: { x: 0, y: 1, z: 0 },
        yaw: 0,
        range: 1,
        arcRadians: Math.PI / 2,
        minY: 0,
        maxY: 1.8,
    })
    pushDebugHitbox(world, {
        id: 'shield',
        kind: 'wedge',
        ttl: 0.2,
        color: [1, 0.8, 0.2],
        origin: { x: 2, y: 1, z: 3 },
        yaw: 1,
        range: 2,
        arcRadians: Math.PI,
        minY: 0,
        maxY: 1.8,
    })

    assert.equal(world.debugHitboxes.length, 1)
    assert.equal(world.debugHitboxes[0]!.ttl, 0.2)
    assert.deepEqual(world.debugHitboxes[0]!.color, [1, 0.8, 0.2])

    clearDebugHitbox(world, 'shield')
    assert.equal(world.debugHitboxes.length, 0)
})

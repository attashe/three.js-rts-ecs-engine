import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { Health, PlayerControlled } from '../src/client/engine/ecs/components'
import { createHealthRegenSystem } from '../src/client/engine/ecs/systems/health-regen-system'
import { createGameWorld } from '../src/client/engine/ecs/world'

function setupPlayer(world: ReturnType<typeof createGameWorld>, current: number, max: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, PlayerControlled)
    addComponent(world, eid, Health)
    Health.max[eid] = max
    Health.current[eid] = current
    return eid
}

test('HealthRegenSystem accumulates health at the configured rate', () => {
    const world = createGameWorld()
    const player = setupPlayer(world, 50, 100)

    const system = createHealthRegenSystem({ rate: 2 })
    // 1 second total over 60 steps → +2 HP.
    for (let i = 0; i < 60; i++) system.update(world, 1 / 60)

    assert.ok(Math.abs(Health.current[player] - 52) < 1e-3,
        `expected ≈52 HP, got ${Health.current[player]}`)
})

test('HealthRegenSystem caps at Health.max', () => {
    const world = createGameWorld()
    const player = setupPlayer(world, 99, 100)

    const system = createHealthRegenSystem({ rate: 5 })
    for (let i = 0; i < 60; i++) system.update(world, 1 / 60)

    assert.equal(Health.current[player], 100, 'regen must not exceed maxHealth')
})

test('HealthRegenSystem skips dead actors by default', () => {
    const world = createGameWorld()
    const player = setupPlayer(world, 0, 100)

    createHealthRegenSystem({ rate: 10 }).update(world, 1)
    assert.equal(Health.current[player], 0, 'dead actor should not regen back to life')
})

test('HealthRegenSystem can be configured to revive dead actors when skipDead is false', () => {
    const world = createGameWorld()
    const player = setupPlayer(world, 0, 100)

    createHealthRegenSystem({ rate: 10, skipDead: false }).update(world, 1)
    assert.ok(Health.current[player] > 0, 'with skipDead=false, regen ticks even from 0')
})

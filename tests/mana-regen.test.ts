import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { PlayerControlled, PlayerResources } from '../src/client/engine/ecs/components'
import { createManaRegenSystem } from '../src/client/engine/ecs/systems/mana-regen-system'
import { createGameWorld } from '../src/client/engine/ecs/world'

function setupPlayer(world: ReturnType<typeof createGameWorld>, current: number, max: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, PlayerControlled)
    addComponent(world, eid, PlayerResources)
    PlayerResources.maxMana[eid] = max
    PlayerResources.mana[eid] = current
    return eid
}

test('ManaRegenSystem accumulates mana at the configured rate', () => {
    const world = createGameWorld()
    const player = setupPlayer(world, 10, 60)

    const system = createManaRegenSystem({ rate: 6 })
    // 1 second total over 60 steps → +6 mana.
    for (let i = 0; i < 60; i++) system.update(world, 1 / 60)

    assert.ok(Math.abs(PlayerResources.mana[player] - 16) < 1e-3,
        `expected ≈16 mana, got ${PlayerResources.mana[player]}`)
})

test('ManaRegenSystem caps at PlayerResources.maxMana', () => {
    const world = createGameWorld()
    const player = setupPlayer(world, 58, 60)

    const system = createManaRegenSystem({ rate: 8 })
    for (let i = 0; i < 60; i++) system.update(world, 1 / 60)

    assert.equal(PlayerResources.mana[player], 60, 'regen must not exceed maxMana')
})

test('ManaRegenSystem ignores actors with maxMana <= 0', () => {
    const world = createGameWorld()
    const eid = addEntity(world)
    addComponent(world, eid, PlayerControlled)
    addComponent(world, eid, PlayerResources)
    PlayerResources.maxMana[eid] = 0
    PlayerResources.mana[eid] = 0

    createManaRegenSystem({ rate: 10 }).update(world, 1)
    assert.equal(PlayerResources.mana[eid], 0)
})

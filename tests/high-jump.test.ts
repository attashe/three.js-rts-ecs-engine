import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { ActionMap, type ActionDefinition, type ActionInputSource } from '../src/client/engine/input/actions'
import { Grounded, PlayerControlled, PlayerResources, Position, Velocity } from '../src/client/engine/ecs/components'
import { createHighJumpSystem } from '../src/client/engine/ecs/systems/high-jump-system'
import { createGameWorld } from '../src/client/engine/ecs/world'
import { populateDefaultPlayerLoadout } from '../src/client/game/items'

class FakeInput implements ActionInputSource {
    pressedAt = new Map<string, number>()

    constructor(private readonly now: () => number) {}

    isKeyDown(): boolean {
        return false
    }

    hasBufferedKeyPressed(code: string, bufferMs: number): boolean {
        const t = this.pressedAt.get(code)
        if (t === undefined) return false
        if (this.now() - t <= bufferMs) return true
        this.pressedAt.delete(code)
        return false
    }

    consumeBufferedKeyPressed(code: string, bufferMs: number): boolean {
        if (!this.hasBufferedKeyPressed(code, bufferMs)) return false
        this.pressedAt.delete(code)
        return true
    }
}

const definitions: readonly ActionDefinition[] = [{
    id: 'spell.highJump',
    label: 'High jump',
    bindings: [{ keys: ['KeyF'] }],
    bufferMs: 160,
}]

test('HighJumpSystem pushes grounded player upward and consumes selected spell action', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })
    const world = createGameWorld()
    const player = addEntity(world)
    addComponent(world, player, PlayerControlled)
    addComponent(world, player, Position)
    addComponent(world, player, Velocity)
    addComponent(world, player, Grounded)
    input.pressedAt.set('KeyF', now)

    createHighJumpSystem(actions, { jumpVelocity: 13 }).update(world, 1 / 60)

    assert.equal(Velocity.y[player], 13)
    assert.equal(hasComponent(world, player, Grounded), false)
})

test('HighJumpSystem debits its spell cost from PlayerResources.mana on cast', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    // Switch to the high-jump slot so activePlayerSpellCost returns its 12-cost.
    world.playerLoadout.activeSlot = 3

    const player = addEntity(world)
    addComponent(world, player, PlayerControlled)
    addComponent(world, player, Position)
    addComponent(world, player, Velocity)
    addComponent(world, player, Grounded)
    addComponent(world, player, PlayerResources)
    PlayerResources.maxMana[player] = 60
    PlayerResources.mana[player] = 60
    input.pressedAt.set('KeyF', now)

    createHighJumpSystem(actions, { jumpVelocity: 13 }).update(world, 1 / 60)

    assert.equal(Velocity.y[player], 13)
    assert.equal(PlayerResources.mana[player], 48, 'expected 60 - 12 = 48 mana after one cast')
})

test('HighJumpSystem refuses to cast when mana is below the spell cost', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    world.playerLoadout.activeSlot = 3

    const player = addEntity(world)
    addComponent(world, player, PlayerControlled)
    addComponent(world, player, Position)
    addComponent(world, player, Velocity)
    addComponent(world, player, Grounded)
    addComponent(world, player, PlayerResources)
    PlayerResources.maxMana[player] = 60
    PlayerResources.mana[player] = 5  // below 12-cost
    // Velocity is a module-level Float32Array shared across worlds — clear
    // any residual y-velocity that leaked from earlier tests on the same eid.
    Velocity.y[player] = 0
    input.pressedAt.set('KeyF', now)

    createHighJumpSystem(actions, { jumpVelocity: 13 }).update(world, 1 / 60)

    assert.equal(Velocity.y[player], 0, 'no jump should fire when mana is insufficient')
    assert.equal(PlayerResources.mana[player], 5, 'mana must be untouched on rejection')
    assert.equal(hasComponent(world, player, Grounded), true, 'Grounded tag should not be removed when cast is rejected')
})

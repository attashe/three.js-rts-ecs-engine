import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { createAirPushSystem } from '../src/client/engine/ecs/systems/air-push-system'
import {
    Behaviour,
    BoxCollider,
    MoveAlongPath,
    MovementState,
    PlayerControlled,
    PlayerResources,
    Position,
    Rotation,
    Velocity,
} from '../src/client/engine/ecs/components'
import { BehaviourProfileId, assignBehaviourProfile } from '../src/client/engine/ecs/behaviour'
import { MovementStateId } from '../src/client/engine/ecs/movement-state'
import { createGameWorld } from '../src/client/engine/ecs/world'
import { ActionMap, type ActionDefinition, type ActionInputSource } from '../src/client/engine/input/actions'
import { populateDefaultPlayerLoadout } from '../src/client/game/items'

class FakeInput implements ActionInputSource {
    pressed = true

    isKeyDown(): boolean {
        return false
    }

    hasBufferedKeyPressed(): boolean {
        return this.pressed
    }

    consumeBufferedKeyPressed(): boolean {
        if (!this.pressed) return false
        this.pressed = false
        return true
    }
}

const definitions: readonly ActionDefinition[] = [{
    id: 'spell.airPush',
    label: 'Air Push',
    bindings: [{ keys: ['KeyG'] }],
    bufferMs: 120,
}]

test('AirPush interrupts path-following wanderers so movement does not overwrite the impulse', () => {
    const world = createGameWorld()
    const input = new FakeInput()
    const actions = new ActionMap(definitions, input, { now: () => 0 })

    const player = addEntity(world)
    addComponent(world, player, PlayerControlled)
    addComponent(world, player, Position)
    addComponent(world, player, Rotation)
    Position.x[player] = 0
    Position.y[player] = 0
    Position.z[player] = 0
    Rotation.y[player] = 0

    const wanderer = addEntity(world)
    addComponent(world, wanderer, Position)
    addComponent(world, wanderer, Rotation)
    addComponent(world, wanderer, BoxCollider)
    addComponent(world, wanderer, Velocity)
    addComponent(world, wanderer, MoveAlongPath)
    addComponent(world, wanderer, Behaviour)
    addComponent(world, wanderer, MovementState)
    Position.x[wanderer] = 0
    Position.y[wanderer] = 0
    Position.z[wanderer] = 2
    BoxCollider.x[wanderer] = 0.34
    BoxCollider.y[wanderer] = 0.9
    BoxCollider.z[wanderer] = 0.34
    assignBehaviourProfile(world, wanderer, BehaviourProfileId.NeutralWanderer, { x: 0, y: 0, z: 2 })
    world.pathByEid.set(wanderer, { points: [], index: 0, speed: 2.2 })

    createAirPushSystem(actions, { actorRecoveryDelay: 0.5 }).update(world, 1 / 60)

    assert.ok(Velocity.z[wanderer] > 0, `expected wanderer to receive forward impulse, got ${Velocity.z[wanderer]}`)
    assert.equal(hasComponent(world, wanderer, MoveAlongPath), false)
    assert.equal(world.pathByEid.has(wanderer), false)
    assert.ok(Behaviour.nextRepathAt[wanderer] >= 0.5)
    assert.equal(world.behaviourByEid.get(wanderer)?.pathGoal, null)
    assert.equal(MovementState.value[wanderer], MovementStateId.Airborne)
})

test('AirPush debits its spell cost from PlayerResources.mana on cast', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    // The default loadout has airPush in slot 2 — switch to it so
    // activePlayerSpellCost picks up its 20-cost def.
    world.playerLoadout.activeSlot = 2

    const input = new FakeInput()
    const actions = new ActionMap(definitions, input, { now: () => 0 })

    const player = addEntity(world)
    addComponent(world, player, PlayerControlled)
    addComponent(world, player, Position)
    addComponent(world, player, Rotation)
    addComponent(world, player, PlayerResources)
    Position.x[player] = 0; Position.y[player] = 0; Position.z[player] = 0
    PlayerResources.maxMana[player] = 60
    PlayerResources.mana[player] = 60

    createAirPushSystem(actions, {}).update(world, 1 / 60)
    assert.equal(PlayerResources.mana[player], 40, 'expected 60 - 20 = 40 mana after one cast')
})

test('AirPush refuses to cast when PlayerResources.mana is below the spell cost', () => {
    const world = createGameWorld()
    populateDefaultPlayerLoadout(world)
    world.playerLoadout.activeSlot = 2

    const input = new FakeInput()
    const actions = new ActionMap(definitions, input, { now: () => 0 })

    const player = addEntity(world)
    addComponent(world, player, PlayerControlled)
    addComponent(world, player, Position)
    addComponent(world, player, Rotation)
    addComponent(world, player, PlayerResources)
    Position.x[player] = 0; Position.y[player] = 0; Position.z[player] = 0
    PlayerResources.maxMana[player] = 60
    PlayerResources.mana[player] = 5  // below the 20-cost Air Push

    // Stone target so we can verify it doesn't get pushed.
    const stone = addEntity(world)
    addComponent(world, stone, Position); addComponent(world, stone, BoxCollider); addComponent(world, stone, Velocity)
    Position.x[stone] = 0; Position.y[stone] = 0; Position.z[stone] = 2
    BoxCollider.x[stone] = 0.3; BoxCollider.y[stone] = 0.3; BoxCollider.z[stone] = 0.3

    // Velocity is a module-level Float32Array shared across worlds, so a
    // previous test's push on the same eid bleeds into this stone unless we
    // clear it explicitly.
    Velocity.x[stone] = 0; Velocity.y[stone] = 0; Velocity.z[stone] = 0

    createAirPushSystem(actions, {}).update(world, 1 / 60)

    assert.equal(PlayerResources.mana[player], 5, 'mana must be untouched when the cast is rejected')
    assert.equal(Velocity.z[stone], 0, 'no push impulse should reach the stone when the cast is rejected')
})

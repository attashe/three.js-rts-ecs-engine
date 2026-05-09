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
    Position,
    Rotation,
    Velocity,
} from '../src/client/engine/ecs/components'
import { BehaviourProfileId, assignBehaviourProfile } from '../src/client/engine/ecs/behaviour'
import { MovementStateId } from '../src/client/engine/ecs/movement-state'
import { createGameWorld } from '../src/client/engine/ecs/world'
import { ActionMap, type ActionDefinition, type ActionInputSource } from '../src/client/engine/input/actions'

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

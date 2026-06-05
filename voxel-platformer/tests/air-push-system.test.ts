import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents } from 'bitecs'
import { BoxCollider, Mana, PlayerControlled, Position, Rotation, Velocity } from '../src/engine/ecs/components'
import { createEntity } from '../src/engine/ecs/entity'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import { createAirPushSystem } from '../src/engine/ecs/systems/air-push-system'
import type { ActionMap } from '../src/engine/input/actions'
import { AIR_PUSH_MANA_COST, PLAYER_DEFAULT_MAX_MANA } from '../src/game/mana'

function onePressAction(): ActionMap {
    let pressed = true
    return {
        consumePressed() {
            if (!pressed) return null
            pressed = false
            return { actionId: 'spell.airPush' }
        },
    } as unknown as ActionMap
}

function spawnPlayer(world: GameWorld, mana = PLAYER_DEFAULT_MAX_MANA): number {
    const eid = createEntity(world)
    addComponents(world, eid, [PlayerControlled, Position, Rotation, Mana])
    Position.x[eid] = 0
    Position.y[eid] = 0
    Position.z[eid] = 0
    Rotation.y[eid] = 0
    Mana.max[eid] = PLAYER_DEFAULT_MAX_MANA
    Mana.current[eid] = mana
    return eid
}

function spawnPushable(world: GameWorld): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, BoxCollider, Velocity])
    Position.x[eid] = 0
    Position.y[eid] = 0
    Position.z[eid] = 2
    BoxCollider.x[eid] = 0.35
    BoxCollider.y[eid] = 0.35
    BoxCollider.z[eid] = 0.35
    return eid
}

test('Air Push spends mana and pushes valid physics targets', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    const target = spawnPushable(world)

    createAirPushSystem(onePressAction()).update(world, 1 / 60)

    assert.equal(Mana.current[player], PLAYER_DEFAULT_MAX_MANA - AIR_PUSH_MANA_COST)
    assert.ok(Velocity.z[target]! > 0)
})

test('Air Push consumes the press but does not push without enough mana', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, 0)
    const target = spawnPushable(world)

    createAirPushSystem(onePressAction()).update(world, 1 / 60)

    assert.equal(Mana.current[player], 0)
    assert.equal(Velocity.z[target], 0)
    assert.ok(world.log.includes('Not enough mana.'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { BoxCollider, Grounded, Mana, PlayerControlled, Position, Velocity } from '../src/engine/ecs/components'
import { createHighJumpSystem } from '../src/engine/ecs/systems/high-jump-system'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { HIGH_JUMP_BOOTS_ITEM_ID } from '../src/game/high-jump-boots'
import { HIGH_JUMP_MANA_COST, PLAYER_DEFAULT_MAX_MANA } from '../src/game/mana'
import { normalizePlayerSettings } from '../src/game/player-settings'

function onePressAction(): ActionMap {
    let pressed = true
    return {
        consumePressed() {
            if (!pressed) return null
            pressed = false
            return { actionId: 'test.highJump' }
        },
    } as unknown as ActionMap
}

function spawnPlayer(world: GameWorld): number {
    const eid = addEntity(world)
    for (const component of [PlayerControlled, Position, Velocity, BoxCollider, Grounded, Mana]) {
        addComponent(world, eid, component)
    }
    Position.x[eid] = 0
    Position.y[eid] = 1
    Position.z[eid] = 0
    Velocity.x[eid] = 0
    Velocity.y[eid] = 0
    Velocity.z[eid] = 0
    BoxCollider.x[eid] = 0.3
    BoxCollider.y[eid] = 0.75
    BoxCollider.z[eid] = 0.3
    Mana.current[eid] = PLAYER_DEFAULT_MAX_MANA
    Mana.max[eid] = PLAYER_DEFAULT_MAX_MANA
    return eid
}

test('high jump stays disabled when base ability is off and boots are not equipped', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    world.playerSettings = normalizePlayerSettings({ abilities: { highJump: false } })

    createHighJumpSystem(onePressAction(), { actionId: 'test.highJump' }).update(world, 1 / 60)

    assert.equal(Velocity.y[player], 0)
    assert.equal(hasComponent(world, player, Grounded), true)
})

test('equipped high jump boots enable high jump when base ability is off', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    world.playerSettings = normalizePlayerSettings({
        abilities: { highJump: false },
        equipment: { boots: HIGH_JUMP_BOOTS_ITEM_ID },
    })
    let fired = false

    createHighJumpSystem(onePressAction(), {
        actionId: 'test.highJump',
        onHighJump: () => { fired = true },
    }).update(world, 1 / 60)

    assert.equal(Velocity.y[player], world.playerSettings.highJumpVelocity)
    assert.equal(Mana.current[player], PLAYER_DEFAULT_MAX_MANA - HIGH_JUMP_MANA_COST)
    assert.equal(hasComponent(world, player, Grounded), false)
    assert.equal(fired, true)
})

test('high jump consumes the press but does not fire without enough mana', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world)
    Mana.current[player] = 0

    createHighJumpSystem(onePressAction(), {
        actionId: 'test.highJump',
    }).update(world, 1 / 60)

    assert.equal(Velocity.y[player], 0)
    assert.equal(Mana.current[player], 0)
    assert.equal(hasComponent(world, player, Grounded), true)
})

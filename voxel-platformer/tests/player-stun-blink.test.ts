import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents, removeComponent } from 'bitecs'
import { Group } from 'three'
import { createEntity } from '../src/engine/ecs/entity'
import { PlayerControlled, Stunned } from '../src/engine/ecs/components'
import { createGameWorld } from '../src/engine/ecs/world'
import { createPlayerStunBlinkSystem } from '../src/game/player-stun-blink-system'

test('player stun blink toggles the player model and restores visibility', () => {
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [PlayerControlled, Stunned])
    Stunned.seconds[player] = 0.25

    const root = new Group()
    const model = new Group()
    model.name = 'PlayerModel'
    root.add(model)
    world.object3DByEid.set(player, root)

    const system = createPlayerStunBlinkSystem()
    system.update(world, 0.08)
    assert.equal(model.visible, false)

    removeComponent(world, player, Stunned)
    system.update(world, 0.01)
    assert.equal(model.visible, true)

    addComponents(world, player, [Stunned])
    Stunned.seconds[player] = 0.25
    system.update(world, 0.08)
    assert.equal(model.visible, false)
    system.dispose?.()
    assert.equal(model.visible, true)
})

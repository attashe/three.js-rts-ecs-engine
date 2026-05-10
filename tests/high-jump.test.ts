import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { ActionMap, type ActionDefinition, type ActionInputSource } from '../src/client/engine/input/actions'
import { Grounded, PlayerControlled, Position, Velocity } from '../src/client/engine/ecs/components'
import { createHighJumpSystem } from '../src/client/engine/ecs/systems/high-jump-system'
import { createGameWorld } from '../src/client/engine/ecs/world'

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

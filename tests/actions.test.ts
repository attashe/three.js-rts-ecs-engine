import test from 'node:test'
import assert from 'node:assert/strict'
import { ActionMap, type ActionDefinition, type ActionInputSource } from '../src/client/engine/input/actions'
import { GAME_ACTIONS, GAME_COMMAND_HINT_ACTIONS, GameAction } from '../src/client/game/actions'

class FakeInput implements ActionInputSource {
    held = new Set<string>()
    pressedAt = new Map<string, number>()

    constructor(private readonly now: () => number) {}

    isKeyDown(code: string): boolean {
        return this.held.has(code)
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

const definitions: readonly ActionDefinition[] = [
    {
        id: 'move.left',
        label: 'Move left',
        bindings: [{ keys: ['KeyA'] }],
        hint: { group: 'move', label: 'Move', keys: ['WASD'], order: 10 },
    },
    {
        id: 'move.right',
        label: 'Move right',
        bindings: [{ keys: ['KeyD'] }],
        hint: { group: 'move', label: 'Move', keys: ['WASD'], order: 10 },
    },
    {
        id: 'attack.primary',
        label: 'Attack',
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 120,
        cooldownMs: 360,
        hint: { group: 'attack', label: 'Attack', keys: ['F'], order: 20 },
    },
    {
        id: 'world.interact',
        label: 'Interact',
        bindings: [{ keys: ['KeyE'] }],
        bufferMs: 200,
        hint: { group: 'interact', label: 'Interact', keys: ['E'], order: 30 },
    },
]

test('ActionMap reads held actions and axes from key bindings', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })

    input.held.add('KeyA')
    assert.equal(actions.isHeld('move.left'), true)
    assert.equal(actions.isHeld('move.right'), false)
    assert.equal(actions.axis('move.left', 'move.right'), -1)

    input.held.add('KeyD')
    assert.equal(actions.axis('move.left', 'move.right'), 0)
})

test('ActionMap consumes buffered presses once', () => {
    let now = 1000
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })

    input.pressedAt.set('KeyE', now)
    const intent = actions.consumePressed('world.interact', 7)

    assert.equal(intent?.actionId, 'world.interact')
    assert.equal(intent?.key, 'KeyE')
    assert.equal(actions.consumePressed('world.interact', 7), null)
})

test('ActionMap drops expired buffered presses', () => {
    let now = 1000
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })

    input.pressedAt.set('KeyE', now)
    now += 250

    assert.equal(actions.hasBufferedPress('world.interact'), false)
    assert.equal(actions.consumePressed('world.interact', 1), null)
})

test('ActionMap enforces per-subject cooldowns', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })

    input.pressedAt.set('KeyF', now)
    assert.ok(actions.consumePressed('attack.primary', 1))

    now = 100
    input.pressedAt.set('KeyF', now)
    assert.equal(actions.consumePressed('attack.primary', 1), null)
    assert.ok(actions.consumePressed('attack.primary', 2), 'other actor has separate cooldown')

    now = 500
    input.pressedAt.set('KeyF', now)
    assert.ok(actions.consumePressed('attack.primary', 1))
})

test('ActionMap groups command hints by hint group and order', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })

    assert.deepEqual(actions.commandHints(['attack.primary', 'move.left', 'move.right']), [
        { keys: ['WASD'], label: 'Move' },
        { keys: ['F'], label: 'Attack' },
    ])
})

test('game actions expose held shield input and command hint', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(GAME_ACTIONS, input, { now: () => now })

    input.held.add('ShiftLeft')

    assert.equal(actions.isHeld(GameAction.Shield), true)
    assert.deepEqual(
        actions.commandHints(GAME_COMMAND_HINT_ACTIONS).find((hint) => hint.label === 'Shield'),
        { keys: ['Shift'], label: 'Shield' },
    )
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
    ActionMap,
    actionBindingDisplayKeys,
    formatKeyCodeForDisplay,
    withActionBindingOverrides,
    type ActionDefinition,
    type ActionInputSource,
} from '../src/engine/input/actions'
import {
    createGameActionDefinitions,
    GAME_ACTIONS,
    GAME_COMMAND_HINT_ACTIONS,
    GameAction,
} from '../src/game/actions'

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
        id: 'weapon.bowShot',
        label: 'Bow',
        bindings: [{ keys: ['KeyF'] }],
        bufferMs: 120,
        cooldownMs: 360,
        hint: { group: 'shoot', label: 'Bow', keys: ['F'], order: 20 },
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

    input.pressedAt.set('KeyF', now)
    const intent = actions.consumePressed('weapon.bowShot', 7)

    assert.equal(intent?.actionId, 'weapon.bowShot')
    assert.equal(intent?.key, 'KeyF')
    assert.equal(actions.consumePressed('weapon.bowShot', 7), null)
})

test('ActionMap drops expired buffered presses', () => {
    let now = 1000
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })

    input.pressedAt.set('KeyF', now)
    now += 250

    assert.equal(actions.hasBufferedPress('weapon.bowShot'), false)
    assert.equal(actions.consumePressed('weapon.bowShot', 1), null)
})

test('ActionMap enforces per-subject cooldowns', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(definitions, input, { now: () => now })

    input.pressedAt.set('KeyF', now)
    assert.ok(actions.consumePressed('weapon.bowShot', 1))

    now = 100
    input.pressedAt.set('KeyF', now)
    assert.equal(actions.consumePressed('weapon.bowShot', 1), null)
    assert.ok(actions.consumePressed('weapon.bowShot', 2), 'other actor has separate cooldown')

    now = 500
    input.pressedAt.set('KeyF', now)
    assert.ok(actions.consumePressed('weapon.bowShot', 1))
})

test('game actions expose the platformer command hint set in order', () => {
    let now = 0
    const input = new FakeInput(() => now)
    const actions = new ActionMap(GAME_ACTIONS, input, { now: () => now })

    assert.deepEqual(actions.commandHints(GAME_COMMAND_HINT_ACTIONS), [
        { keys: ['WASD', 'Arrows'], label: 'Move' },
        { keys: ['Mouse'], label: 'Aim' },
        { keys: ['Q', 'R'], label: 'Rotate camera' },
        { keys: ['Space'], label: 'Jump' },
        { keys: ['H'], label: 'High jump' },
        { keys: ['G'], label: 'Air push' },
        { keys: ['F'], label: 'Attack' },
        { keys: ['T'], label: 'Shield' },
        { keys: ['C'], label: 'Cast' },
        { keys: ['X'], label: 'Switch weapon' },
        { keys: ['E'], label: 'Interaction' },
        { keys: ['Tab'], label: 'Inventory' },
    ])
    assert.equal(actions.get(GameAction.BowShot).bindings?.[0]?.keys[0], 'KeyF')
    assert.equal(actions.get(GameAction.Interact).bindings?.[0]?.keys[0], 'KeyE')
    assert.equal(actions.get(GameAction.Inventory).bindings?.[0]?.keys[0], 'Tab')
})

test('action binding overrides clone definitions without mutating defaults', () => {
    const overridden = withActionBindingOverrides(definitions, {
        'weapon.bowShot': [{ keys: ['KeyB', 'KeyB', ' '], displayKeys: ['B'] }],
    })
    const bow = overridden.find((definition) => definition.id === 'weapon.bowShot')

    assert.deepEqual(bow?.bindings?.[0]?.keys, ['KeyB'])
    assert.deepEqual(actionBindingDisplayKeys(bow!), ['B'])
    assert.deepEqual(definitions[2]?.bindings?.[0]?.keys, ['KeyF'])
})

test('game action definitions accept keyboard overrides while preserving default constants', () => {
    let now = 1000
    const input = new FakeInput(() => now)
    const actions = new ActionMap(
        createGameActionDefinitions({ [GameAction.BowShot]: ['KeyB'] }),
        input,
        { now: () => now },
    )

    input.pressedAt.set('KeyF', now)
    assert.equal(actions.consumePressed(GameAction.BowShot), null)

    input.pressedAt.set('KeyB', now)
    const intent = actions.consumePressed(GameAction.BowShot)
    assert.equal(intent?.key, 'KeyB')
    assert.equal(GAME_ACTIONS.find((definition) => definition.id === GameAction.BowShot)?.bindings?.[0]?.keys[0], 'KeyF')
})

test('key codes have compact display labels for settings UI', () => {
    assert.equal(formatKeyCodeForDisplay('KeyW'), 'W')
    assert.equal(formatKeyCodeForDisplay('Digit3'), '3')
    assert.equal(formatKeyCodeForDisplay('ArrowLeft'), 'Left')
    assert.equal(formatKeyCodeForDisplay('Space'), 'Space')
})

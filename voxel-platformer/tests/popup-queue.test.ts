import test from 'node:test'
import assert from 'node:assert/strict'
import {
    createGameWorld,
    pushPopupClear,
    pushPopupMessage,
} from '../src/engine/ecs/world'

test('pushPopupMessage trims, defaults seconds, and assigns monotonic ids', () => {
    const world = createGameWorld()
    pushPopupMessage(world, { targetId: 'npc.keeper', message: '  hello  ' })
    pushPopupMessage(world, { targetId: 'npc.keeper', message: 'second', seconds: 6 })
    assert.equal(world.popupMessages.length, 2)
    const [first, second] = world.popupMessages
    assert.equal(first!.message, 'hello', 'leading/trailing whitespace trimmed')
    assert.equal(first!.seconds, 3.5, 'missing seconds defaults to 3.5')
    assert.equal(second!.seconds, 6)
    assert.ok(second!.id > first!.id, 'ids monotonically increase')
})

test('pushPopupMessage ignores empty/whitespace-only messages', () => {
    const world = createGameWorld()
    pushPopupMessage(world, { targetId: 'npc.keeper', message: '' })
    pushPopupMessage(world, { targetId: 'npc.keeper', message: '   ' })
    assert.equal(world.popupMessages.length, 0, 'noise gets dropped at the boundary')
})

test('pushPopupClear queues per-target requests with monotonic ids', () => {
    const world = createGameWorld()
    pushPopupClear(world, 'npc.keeper')
    pushPopupClear(world, 'npc.merchant')
    assert.equal(world.popupClears.length, 2)
    assert.equal(world.popupClears[0]!.targetId, 'npc.keeper')
    assert.equal(world.popupClears[1]!.targetId, 'npc.merchant')
    assert.ok(world.popupClears[1]!.id > world.popupClears[0]!.id)
})

test('pushPopupClear(null) is the sweep-all signal', () => {
    const world = createGameWorld()
    pushPopupClear(world, null)
    assert.equal(world.popupClears.length, 1)
    assert.equal(world.popupClears[0]!.targetId, null)
})

test('popup queues stay bounded so a runaway script can\'t leak memory', () => {
    const world = createGameWorld()
    // 30 pushes — both queues cap at 24 entries internally.
    for (let i = 0; i < 30; i++) {
        pushPopupMessage(world, { targetId: 'npc', message: `msg ${i}` })
        pushPopupClear(world, 'npc')
    }
    assert.equal(world.popupMessages.length, 24, 'popupMessages caps at 24')
    assert.equal(world.popupClears.length, 24, 'popupClears caps at 24')
    // Oldest entries evicted first — the newest survivors should have
    // the highest ids.
    assert.equal(world.popupMessages[0]!.message, 'msg 6', 'evicted FIFO')
    assert.equal(world.popupMessages[23]!.message, 'msg 29', 'newest preserved')
})

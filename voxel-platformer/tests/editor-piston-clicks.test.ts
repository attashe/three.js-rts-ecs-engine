import test from 'node:test'
import assert from 'node:assert/strict'
import { handlePistonClicks } from '../src/editor/systems/piston-clicks'

test('handlePistonClicks: right-click undo does not require a cursor', () => {
    let removed = 0
    let placed = 0

    handlePistonClicks([{ x: 0, y: 0, button: 2 }], {
        hasCursor: () => false,
        place: () => { placed++ },
        removeLast: () => { removed++ },
    })

    assert.equal(removed, 1)
    assert.equal(placed, 0)
})

test('handlePistonClicks: placement still requires a cursor', () => {
    let placed = 0

    handlePistonClicks([{ x: 0, y: 0, button: 0 }], {
        hasCursor: () => false,
        place: () => { placed++ },
        removeLast: () => {},
    })

    assert.equal(placed, 0)
})

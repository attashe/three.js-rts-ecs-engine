import test from 'node:test'
import assert from 'node:assert/strict'
import { createCommandStack, type Command } from '../src/editor/history'

function counter(): { value: number; cmd: (delta: number, label?: string) => Command } {
    const box = { value: 0 }
    return {
        get value() { return box.value },
        set value(v: number) { box.value = v },
        cmd(delta: number, label = 'inc'): Command {
            return {
                label,
                apply: () => { box.value += delta },
                revert: () => { box.value -= delta },
            }
        },
    } as { value: number; cmd: (delta: number, label?: string) => Command }
}

test('CommandStack.push applies and records, undo + redo round-trip the value', () => {
    const box = counter()
    const stack = createCommandStack()

    stack.push(box.cmd(3, 'add-3'))
    stack.push(box.cmd(5, 'add-5'))
    assert.equal(box.value, 8, 'two pushes applied: 0 + 3 + 5')
    assert.equal(stack.undoDepth(), 2)
    assert.equal(stack.redoDepth(), 0)

    const undone = stack.undo()
    assert.equal(undone?.label, 'add-5')
    assert.equal(box.value, 3, 'undo reverts the most recent')
    assert.equal(stack.undoDepth(), 1)
    assert.equal(stack.redoDepth(), 1)

    stack.undo()
    assert.equal(box.value, 0, 'second undo strips the first push back to zero')

    stack.redo()
    stack.redo()
    assert.equal(box.value, 8, 'redo replays in original order')
    assert.equal(stack.redoDepth(), 0)
})

test('CommandStack.pushApplied records without invoking apply()', () => {
    const box = counter()
    const stack = createCommandStack()

    // Simulate something that already happened — value changed without
    // the stack's apply path. Stack should record but not re-apply.
    box.value = 10
    stack.pushApplied({
        label: 'external',
        apply: () => { box.value += 10 },
        revert: () => { box.value -= 10 },
    })
    assert.equal(box.value, 10, 'pushApplied does NOT call apply()')

    stack.undo()
    assert.equal(box.value, 0, 'undo still runs revert()')
    stack.redo()
    assert.equal(box.value, 10, 'redo runs apply()')
})

test('CommandStack: a new push after undo clears the redo stack', () => {
    const box = counter()
    const stack = createCommandStack()
    stack.push(box.cmd(2))
    stack.push(box.cmd(3))
    stack.undo() // redo stack now has the +3
    assert.equal(stack.redoDepth(), 1)

    stack.push(box.cmd(7, 'new-branch'))
    assert.equal(stack.redoDepth(), 0, 'new push clears redo')
    assert.equal(box.value, 2 + 7, 'value reflects only the surviving timeline')
    assert.equal(stack.redo(), null, 'no redo available')
})

test('CommandStack: capped at maxSize, oldest commands fall off', () => {
    const box = counter()
    const stack = createCommandStack(3)
    stack.push(box.cmd(1, 'a'))
    stack.push(box.cmd(2, 'b'))
    stack.push(box.cmd(3, 'c'))
    stack.push(box.cmd(4, 'd')) // pushes 'a' off the bottom
    assert.equal(stack.undoDepth(), 3)
    assert.equal(box.value, 10)

    // We can only undo the last three.
    assert.equal(stack.undo()?.label, 'd')
    assert.equal(stack.undo()?.label, 'c')
    assert.equal(stack.undo()?.label, 'b')
    assert.equal(stack.undo(), null, 'oldest command no longer reachable')
    assert.equal(box.value, 1, 'only the surviving 3 reverts ran')
})

test('CommandStack.clear empties both stacks', () => {
    const box = counter()
    const stack = createCommandStack()
    stack.push(box.cmd(1))
    stack.push(box.cmd(2))
    stack.undo()
    assert.equal(stack.undoDepth(), 1)
    assert.equal(stack.redoDepth(), 1)

    stack.clear()
    assert.equal(stack.undoDepth(), 0)
    assert.equal(stack.redoDepth(), 0)
    assert.equal(stack.undo(), null)
    assert.equal(stack.redo(), null)
})

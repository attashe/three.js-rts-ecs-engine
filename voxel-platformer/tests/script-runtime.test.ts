import test from 'node:test'
import assert from 'node:assert/strict'
import { createRuntime } from '../src/engine/script/runtime'

test('emit fires matching subscriptions and ignores others', () => {
    const rt = createRuntime()
    const fired: string[] = []
    rt.on('hello', undefined, () => { fired.push('hello') })
    rt.on('world', undefined, () => { fired.push('world') })
    rt.emit('hello')
    assert.deepEqual(fired, ['hello'])
    rt.emit('world', { any: 1 })
    assert.deepEqual(fired, ['hello', 'world'])
})

test('filter object matches only when all keys agree', () => {
    const rt = createRuntime()
    const fired: number[] = []
    rt.on('zone-enter', { zoneId: 'gate.east' }, () => { fired.push(1) })
    rt.on('zone-enter', { zoneId: 'gate.west' }, () => { fired.push(2) })
    rt.emit('zone-enter', { zoneId: 'gate.east', entityId: 7 })
    rt.emit('zone-enter', { zoneId: 'gate.west' })
    assert.deepEqual(fired, [1, 2])
})

test('filter rejects events whose data lacks the requested key', () => {
    const rt = createRuntime()
    let calls = 0
    rt.on('thing', { id: 'a' }, () => { calls++ })
    rt.emit('thing')               // no data at all
    rt.emit('thing', { id: 'b' })  // wrong id
    rt.emit('thing', { id: 'a' })
    assert.equal(calls, 1)
})

test('once: true removes the subscription after first firing', () => {
    const rt = createRuntime()
    let calls = 0
    rt.on('quest.complete', undefined, () => { calls++ }, { once: true })
    rt.emit('quest.complete')
    rt.emit('quest.complete')
    rt.emit('quest.complete')
    assert.equal(calls, 1)
})

test('disposer returned by on() removes the subscription', () => {
    const rt = createRuntime()
    let calls = 0
    const dispose = rt.on('tick', undefined, () => { calls++ })
    rt.emit('tick')
    assert.equal(calls, 1)
    dispose()
    rt.emit('tick')
    rt.emit('tick')
    assert.equal(calls, 1)
})

test('once() Promise resolves with the event payload', async () => {
    const rt = createRuntime()
    const p = rt.once<{ value: number }>('signal', { name: 'go' })
    rt.emit('signal', { name: 'no', value: -1 }) // filter mismatch
    rt.emit('signal', { name: 'go', value: 42 })
    const event = await p
    assert.equal(event.value, 42)
})

test('wait(seconds) resolves after sim-time advances past the deadline', async () => {
    const rt = createRuntime()
    let resolved = false
    const p = rt.wait(0.5).then(() => { resolved = true })
    rt.advance(0.2)
    await flushMicrotasks()
    assert.equal(resolved, false, 'wait should not resolve at 0.2s')
    rt.advance(0.4)
    await flushMicrotasks()
    assert.equal(resolved, true, 'wait should resolve once total 0.6s > 0.5s')
    await p
})

test('wait(0) resolves on the next advance regardless of dt', async () => {
    const rt = createRuntime()
    let resolved = false
    rt.wait(0).then(() => { resolved = true })
    rt.advance(0.0001)
    await flushMicrotasks()
    assert.equal(resolved, true)
})

test('multiple waits resolve when their deadlines pass, independently', async () => {
    const rt = createRuntime()
    const order: number[] = []
    rt.wait(1.0).then(() => order.push(1))
    rt.wait(0.5).then(() => order.push(0))
    rt.wait(0.25).then(() => order.push(-1))

    rt.advance(0.3)
    await flushMicrotasks()
    assert.deepEqual(order, [-1])

    rt.advance(0.3)
    await flushMicrotasks()
    assert.deepEqual(order, [-1, 0])

    rt.advance(0.6)
    await flushMicrotasks()
    assert.deepEqual(order, [-1, 0, 1])
})

test('reset cancels in-flight waits + drops all subscriptions', async () => {
    const rt = createRuntime()
    let woke = false
    rt.wait(1.0).then(() => { woke = true })
    let fired = 0
    rt.on('e', undefined, () => { fired++ })
    rt.advance(0.1)
    rt.reset()
    assert.equal(rt.now, 0, 'sim-time reset to zero')
    assert.equal(rt.tick, 0, 'sim-tick reset to zero')
    rt.emit('e')
    rt.advance(2.0)
    await flushMicrotasks()
    assert.equal(fired, 0, 'old subscriptions gone after reset')
    assert.equal(woke, false, 'old waits cancelled after reset')
})

test('timer subscription fires every periodSeconds and respects oneshot', () => {
    const rt = createRuntime()
    let calls = 0
    rt.on('timer', { periodSeconds: 0.5 }, () => { calls++ })
    rt.advance(0.4)
    assert.equal(calls, 0, 'not due yet')
    rt.advance(0.2)
    assert.equal(calls, 1, 'fires at 0.6s')
    rt.advance(0.5)
    assert.equal(calls, 2)
    rt.advance(1.5)
    assert.equal(calls, 5, 'fires every period; 1.5/0.5 = 3 more')

    let oneshotCalls = 0
    rt.on('timer', { periodSeconds: 0.2, oneshot: true }, () => { oneshotCalls++ })
    rt.advance(1.0)
    assert.equal(oneshotCalls, 1)
    rt.advance(1.0)
    assert.equal(oneshotCalls, 1, 'oneshot stays at one fire')
})

test('seeded RNG is deterministic across two runtime instances with same seed', () => {
    const a = createRuntime(0xc0ffee)
    const b = createRuntime(0xc0ffee)
    const aSeq = [a.random(0, 100), a.random(0, 100), a.random(0, 100)]
    const bSeq = [b.random(0, 100), b.random(0, 100), b.random(0, 100)]
    assert.deepEqual(aSeq, bSeq)
})

test('handler that throws does not break subsequent dispatches', () => {
    const rt = createRuntime()
    const captured: unknown[] = []
    rt.onError((_where, err) => captured.push(err))
    rt.on('boom', undefined, () => { throw new Error('handler-broke') })
    let postCalls = 0
    rt.on('boom', undefined, () => { postCalls++ })
    rt.emit('boom')
    rt.emit('boom')
    assert.equal(postCalls, 2)
    assert.equal(captured.length, 2)
})

test('async handler rejection is forwarded to onError', async () => {
    const rt = createRuntime()
    const captured: unknown[] = []
    rt.onError((_where, err) => captured.push(err))
    rt.on('boom', undefined, async () => { throw new Error('async-broke') })
    rt.emit('boom')
    await flushMicrotasks()
    await flushMicrotasks()
    assert.equal(captured.length, 1)
})

test('emit inside a handler dispatches to existing subs but not to once-removed ones', () => {
    const rt = createRuntime()
    const order: string[] = []
    rt.on('first', undefined, () => {
        order.push('first')
        rt.emit('second')
    }, { once: true })
    rt.on('second', undefined, () => { order.push('second') })
    rt.emit('first')
    rt.emit('first')   // first is gone after one fire
    assert.deepEqual(order, ['first', 'second'])
})

function flushMicrotasks(): Promise<void> {
    return new Promise<void>((resolve) => setImmediate(resolve))
}

import test from 'node:test'
import assert from 'node:assert/strict'
import {
    clearAllPlaytestScriptErrors,
    clearPlaytestScriptError,
    readPlaytestScriptErrors,
    recordPlaytestScriptError,
} from '../src/editor/playtest-error-bridge'

/** Minimal sessionStorage stand-in. Node has no sessionStorage; the
 *  bridge module takes an injectable storage so tests don't have to
 *  reach for jsdom. */
function fakeStorage() {
    const store = new Map<string, string>()
    return {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v) },
        removeItem: (k: string) => { store.delete(k) },
        peek: () => Object.fromEntries(store),
    }
}

test('record + read round-trips a single error', () => {
    const storage = fakeStorage()
    recordPlaytestScriptError(
        { id: 'demo', name: 'demo.js' },
        'runtime',
        'handler:zone-enter',
        new Error('boom'),
        storage,
    )
    const errors = readPlaytestScriptErrors(storage)
    assert.equal(errors.size, 1)
    const e = errors.get('demo')!
    assert.equal(e.scriptId, 'demo')
    assert.equal(e.scriptName, 'demo.js')
    assert.equal(e.phase, 'runtime')
    assert.equal(e.where, 'handler:zone-enter')
    assert.equal(e.message, 'boom')
    assert.ok(e.occurredAt > 0)
})

test('recording a new error for the same id overwrites the previous one', () => {
    const storage = fakeStorage()
    recordPlaytestScriptError({ id: 'demo', name: 'demo.js' }, 'runtime', 'first', new Error('first'), storage)
    recordPlaytestScriptError({ id: 'demo', name: 'demo.js' }, 'parse', 'compile.parse', new Error('second'), storage)
    const errors = readPlaytestScriptErrors(storage)
    assert.equal(errors.size, 1)
    assert.equal(errors.get('demo')!.phase, 'parse')
    assert.equal(errors.get('demo')!.message, 'second')
})

test('clearPlaytestScriptError drops one id but leaves the rest', () => {
    const storage = fakeStorage()
    recordPlaytestScriptError({ id: 'a', name: 'a.js' }, 'runtime', 'h', new Error('A'), storage)
    recordPlaytestScriptError({ id: 'b', name: 'b.js' }, 'runtime', 'h', new Error('B'), storage)
    clearPlaytestScriptError('a', storage)
    const errors = readPlaytestScriptErrors(storage)
    assert.equal(errors.size, 1)
    assert.equal(errors.has('a'), false)
    assert.equal(errors.has('b'), true)
})

test('clearPlaytestScriptError removes the storage key entirely when the last entry is dropped', () => {
    const storage = fakeStorage()
    recordPlaytestScriptError({ id: 'only', name: 'only.js' }, 'runtime', 'h', new Error('x'), storage)
    clearPlaytestScriptError('only', storage)
    assert.deepEqual(storage.peek(), {})
})

test('clearAllPlaytestScriptErrors wipes every recorded error', () => {
    const storage = fakeStorage()
    recordPlaytestScriptError({ id: 'a', name: 'a.js' }, 'runtime', 'h', new Error('A'), storage)
    recordPlaytestScriptError({ id: 'b', name: 'b.js' }, 'parse', 'compile.parse', new Error('B'), storage)
    clearAllPlaytestScriptErrors(storage)
    assert.deepEqual(storage.peek(), {})
})

test('reader tolerates malformed payloads without throwing', () => {
    const storage = fakeStorage()
    storage.setItem('vp:playtest-script-errors', '{not valid json')
    assert.equal(readPlaytestScriptErrors(storage).size, 0)

    storage.setItem('vp:playtest-script-errors', JSON.stringify({
        'good': { scriptId: 'good', scriptName: 'g.js', phase: 'runtime', where: '', message: 'ok', occurredAt: 0 },
        'broken': 'not an object',
        'missing-message': { scriptId: 'm', scriptName: 'm.js', phase: 'parse', where: '', occurredAt: 0 },
    }))
    const errors = readPlaytestScriptErrors(storage)
    assert.equal(errors.size, 1)
    assert.ok(errors.has('good'))
})

test('functions are noops when no storage is provided', () => {
    // Passing null mirrors the production "no sessionStorage available"
    // path. Nothing should throw.
    recordPlaytestScriptError({ id: 'x', name: 'x.js' }, 'runtime', 'h', new Error('x'), null)
    clearPlaytestScriptError('x', null)
    clearAllPlaytestScriptErrors(null)
    assert.equal(readPlaytestScriptErrors(null).size, 0)
})

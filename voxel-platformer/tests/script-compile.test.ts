import test from 'node:test'
import assert from 'node:assert/strict'
import { compileScript } from '../src/engine/script/compile'
import type { ScriptContext, ScriptEntry } from '../src/engine/script/types'

function emptyContext(): ScriptContext {
    return {} as ScriptContext
}

test('compileScript attaches entry.name to runtime stack traces via //# sourceURL', async () => {
    const entry: ScriptEntry = {
        id: 'broken-1',
        name: 'broken.js',
        source: 'throw new Error("boom")',
    }
    let caught: unknown
    const result = compileScript(entry, emptyContext(), (_e, err) => { caught = err })
    assert.equal(result.ok, true)
    if (!result.ok) return
    await result.pending.catch(() => {})
    assert.ok(caught instanceof Error, 'runtime error should be forwarded')
    assert.match((caught as Error).stack ?? '', /broken\.js/, 'stack frame should mention the entry name')
})

test('compileScript falls back to entry.id when name has only newlines', async () => {
    const entry: ScriptEntry = {
        id: 'fallback-id',
        name: '\n\r\n',
        source: 'throw new Error("boom")',
    }
    let caught: unknown
    const result = compileScript(entry, emptyContext(), (_e, err) => { caught = err })
    assert.equal(result.ok, true)
    if (!result.ok) return
    await result.pending.catch(() => {})
    assert.match((caught as Error).stack ?? '', /fallback-id/, 'stack should fall back to entry.id')
})

test('compileScript sanitises newlines so a malformed name cannot escape the sourceURL pragma', async () => {
    const entry: ScriptEntry = {
        id: 'safe',
        name: 'evil\n//# sourceMappingURL=http://attacker/x.map\nstill-evil.js',
        source: 'throw new Error("boom")',
    }
    let caught: unknown
    const result = compileScript(entry, emptyContext(), (_e, err) => { caught = err })
    assert.equal(result.ok, true)
    if (!result.ok) return
    await result.pending.catch(() => {})
    const stack = (caught as Error).stack ?? ''
    assert.doesNotMatch(stack, /sourceMappingURL/, 'newlines in entry.name must not pass into the wrapper')
})

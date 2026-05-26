import test from 'node:test'
import assert from 'node:assert/strict'
import {
    __resetRenderTexturesCache,
    getRenderTextures,
    setRenderTextures,
    subscribeRenderTextures,
} from '../src/engine/render/render-settings'

// node:test has no DOM, so `localStorage` is undefined here. The
// render-settings module handles that case by falling back to defaults
// + in-memory caching — these tests exercise that path so we don't
// regress to crashing in private-mode browsers either.

test('getRenderTextures defaults to true when storage is absent', () => {
    __resetRenderTexturesCache()
    assert.equal(getRenderTextures(), true)
})

test('setRenderTextures updates the cached value and survives subsequent reads', () => {
    __resetRenderTexturesCache()
    setRenderTextures(false)
    assert.equal(getRenderTextures(), false)
    setRenderTextures(true)
    assert.equal(getRenderTextures(), true)
})

test('subscribers fire only when the value actually changes', () => {
    __resetRenderTexturesCache()
    setRenderTextures(true)
    let calls = 0
    const last: boolean[] = []
    const unsubscribe = subscribeRenderTextures((enabled) => {
        calls++
        last.push(enabled)
    })

    setRenderTextures(true)   // no change → no callback
    setRenderTextures(false)  // change → 1
    setRenderTextures(false)  // no change → no callback
    setRenderTextures(true)   // change → 2

    assert.equal(calls, 2)
    assert.deepEqual(last, [false, true])

    unsubscribe()
    setRenderTextures(false)
    assert.equal(calls, 2, 'callbacks should stop firing after unsubscribe')
})

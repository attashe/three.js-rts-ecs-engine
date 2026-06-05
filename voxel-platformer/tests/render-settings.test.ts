import test from 'node:test'
import assert from 'node:assert/strict'
import {
    __resetDebugInfoCache,
    __resetPlayerTorchShadowCache,
    __resetRenderTexturesCache,
    __resetTorchSystemCache,
    getDebugInfoEnabled,
    getPlayerTorchShadow,
    getRenderTextures,
    getTorchSystem,
    setDebugInfoEnabled,
    setPlayerTorchShadow,
    setRenderTextures,
    setTorchSystem,
    subscribeDebugInfo,
    subscribePlayerTorchShadow,
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

test('getTorchSystem defaults to classic — the production InstancedMesh + PointLight pool path', () => {
    __resetTorchSystemCache()
    assert.equal(getTorchSystem(), 'classic')
})

test('setTorchSystem round-trips through the cache', () => {
    __resetTorchSystemCache()
    setTorchSystem('experimental')
    assert.equal(getTorchSystem(), 'experimental')
    setTorchSystem('classic')
    assert.equal(getTorchSystem(), 'classic')
})

test('getPlayerTorchShadow defaults to true (shadows on)', () => {
    __resetPlayerTorchShadowCache()
    assert.equal(getPlayerTorchShadow(), true)
})

test('setPlayerTorchShadow round-trips + notifies live subscribers only on change', () => {
    __resetPlayerTorchShadowCache()
    setPlayerTorchShadow(true)
    const seen: boolean[] = []
    const unsubscribe = subscribePlayerTorchShadow((v) => seen.push(v))

    setPlayerTorchShadow(true)   // no change → no callback
    setPlayerTorchShadow(false)  // change → 1
    setPlayerTorchShadow(false)  // no change → no callback
    setPlayerTorchShadow(true)   // change → 2

    assert.deepEqual(seen, [false, true])
    assert.equal(getPlayerTorchShadow(), true)

    unsubscribe()
    setPlayerTorchShadow(false)
    assert.equal(seen.length, 2, 'unsubscribed listener should stop firing')
})

test('debug info defaults on and notifies subscribers when changed', () => {
    __resetDebugInfoCache()
    assert.equal(getDebugInfoEnabled(), true)

    const seen: boolean[] = []
    const unsubscribe = subscribeDebugInfo((enabled) => seen.push(enabled))
    setDebugInfoEnabled(true)
    setDebugInfoEnabled(false)
    setDebugInfoEnabled(false)
    setDebugInfoEnabled(true)

    assert.deepEqual(seen, [false, true])
    assert.equal(getDebugInfoEnabled(), true)
    unsubscribe()
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

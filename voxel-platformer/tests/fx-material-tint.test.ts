import test from 'node:test'
import assert from 'node:assert/strict'
import { Color, MeshBasicMaterial } from 'three'
import { tintMaterial } from '../src/engine/fx/materials/material-tint'

test('tintMaterial caches a Color and reuses it on identical input', () => {
    const m = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
    tintMaterial(m, '#336699', 0.5)
    const cached = (m.userData as { _tintCache?: Color })._tintCache
    assert.ok(cached, 'cache populated on first call')
    assert.equal(m.opacity, 0.5)

    // Second call with the same colour string: the cached Color
    // instance must be the *same* object — no reallocation.
    tintMaterial(m, '#336699', 0.25)
    const cachedAfter = (m.userData as { _tintCache?: Color })._tintCache
    assert.strictEqual(cached, cachedAfter, 'cached Color reused')
    assert.equal(m.opacity, 0.25)
})

test('tintMaterial updates the cached Color when the colour string changes', () => {
    const m = new MeshBasicMaterial({ color: 0xffffff, transparent: true })
    tintMaterial(m, '#ff0000', 1)
    // Three may convert through sRGB so we can't assume exact RGB
    // values, but a pure red input must give r > g and r > b.
    assert.ok(m.color.r > m.color.g, 'red dominates after #ff0000')
    assert.ok(m.color.r > m.color.b, 'red dominates after #ff0000')
    tintMaterial(m, '#00ff00', 1)
    assert.ok(m.color.g > m.color.r, 'green dominates after #00ff00')
    assert.ok(m.color.g > m.color.b, 'green dominates after #00ff00')
})

test('tintMaterial accepts an array of materials and tints every slot', () => {
    const a = new MeshBasicMaterial({ color: 0xffffff, transparent: true })
    const b = new MeshBasicMaterial({ color: 0xffffff, transparent: true })
    tintMaterial([a, b], '#00ffff', 0.4)
    assert.equal(a.opacity, 0.4)
    assert.equal(b.opacity, 0.4)
    // Cyan: green + blue dominate red on both materials.
    assert.ok(a.color.g > a.color.r)
    assert.ok(b.color.b > b.color.r)
})

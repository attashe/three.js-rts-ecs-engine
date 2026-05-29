import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBackdropLayerGeometry, type BackdropLayer } from '../src/engine/render/backdrop-scenery'

const LAYER: BackdropLayer = {
    seed: 7,
    distance: 160,
    segments: 48,
    baseY: 6,
    height: 40,
    skirt: 30,
    ruggedness: 0.6,
    colorLow: [0.2, 0.25, 0.35],
    colorHigh: [0.7, 0.75, 0.85],
}

function positions(layer: BackdropLayer): Float32Array {
    return buildBackdropLayerGeometry(layer).getAttribute('position').array as Float32Array
}

test('backdrop geometry is deterministic for a given seed', () => {
    assert.deepEqual(positions(LAYER), positions({ ...LAYER }))
})

test('a different seed yields a different silhouette', () => {
    assert.notDeepEqual(positions(LAYER), positions({ ...LAYER, seed: 8 }))
})

test('geometry has the expected vertex count and finite, in-band positions', () => {
    const geo = buildBackdropLayerGeometry(LAYER)
    const pos = geo.getAttribute('position').array as Float32Array
    // Non-indexed: segments quads × 2 tris × 3 verts.
    assert.equal(pos.length, LAYER.segments! * 6 * 3)

    const bottomY = LAYER.baseY - LAYER.skirt!
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))
        // On the ring radius (±1 for fp), and within [bottom, base+height].
        assert.ok(Math.abs(Math.hypot(x, z) - LAYER.distance) < 1)
        assert.ok(y >= bottomY - 1e-3 && y <= LAYER.baseY + LAYER.height + 1e-3)
    }
})

test('vertex colours stay within [0,1]', () => {
    const colors = buildBackdropLayerGeometry(LAYER).getAttribute('color').array as Float32Array
    for (const c of colors) assert.ok(c >= 0 && c <= 1)
})

test('a full ring closes its seam (first and last columns coincide)', () => {
    const geo = buildBackdropLayerGeometry({ ...LAYER, arcDeg: 360, segments: 32 })
    const pos = geo.getAttribute('position').array as Float32Array
    // First vertex of the first quad (column 0 bottom) vs the second bottom
    // vertex of the last quad (column `segments` bottom) should match.
    const firstX = pos[0]!, firstZ = pos[2]!
    const last = pos.length
    // Last quad layout is [aBottom, bBottom, aTop, aTop, bBottom, bTop]; the
    // column-`segments` bottom vertex (b-bottom of tri 2) is the 5th of 6, i.e.
    // last-6..last-4. A full revolution makes it coincide with column 0 bottom.
    const lastBottomX = pos[last - 6]!
    const lastBottomZ = pos[last - 4]!
    assert.ok(Math.abs(firstX - lastBottomX) < 1e-3)
    assert.ok(Math.abs(firstZ - lastBottomZ) < 1e-3)
})

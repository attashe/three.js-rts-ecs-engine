import test from 'node:test'
import assert from 'node:assert/strict'
import { BRUSHES, brushFootprint, getBrushDef, type BrushKind } from '../src/editor/brush'

const ORIGIN = { x: 0, y: 0, z: 0 }

test('every brush def is reachable from BRUSHES and from getBrushDef', () => {
    for (const def of BRUSHES) {
        assert.equal(getBrushDef(def.kind).kind, def.kind)
    }
    assert.throws(() => getBrushDef('imaginary' as BrushKind), /Unknown brush kind/)
})

test('brushFootprint: single brush paints exactly the centre cell', () => {
    const cells = brushFootprint('single', { x: 3, y: 5, z: -2 })
    assert.equal(cells.length, 1)
    assert.deepEqual(cells[0], { x: 3, y: 5, z: -2 })
})

test('brushFootprint: cube3 covers a 3×3×3 region centred on the cursor', () => {
    const cells = brushFootprint('cube3', ORIGIN)
    assert.equal(cells.length, 27)
    // Spot-check the corners + the centre.
    assert.ok(cells.some((c) => c.x === -1 && c.y === -1 && c.z === -1), 'min corner present')
    assert.ok(cells.some((c) => c.x === 1 && c.y === 1 && c.z === 1), 'max corner present')
    assert.ok(cells.some((c) => c.x === 0 && c.y === 0 && c.z === 0), 'centre present')
})

test('brushFootprint: cube5 covers a 5×5×5 region (125 cells)', () => {
    const cells = brushFootprint('cube5', ORIGIN)
    assert.equal(cells.length, 125)
    assert.ok(cells.some((c) => c.x === -2 && c.y === -2 && c.z === -2), 'min corner present')
    assert.ok(cells.some((c) => c.x === 2 && c.y === 2 && c.z === 2), 'max corner present')
})

test('brushFootprint: disk3 is a flat 3×3 patch at the cursor Y (no vertical spread)', () => {
    const cells = brushFootprint('disk3', { x: 0, y: 7, z: 0 })
    assert.equal(cells.length, 9)
    for (const c of cells) assert.equal(c.y, 7, `every disk cell must share the cursor Y`)
    assert.ok(cells.some((c) => c.x === -1 && c.z === -1), 'NW corner present')
    assert.ok(cells.some((c) => c.x === 1 && c.z === 1), 'SE corner present')
})

test('brushFootprint: disk5 is a flat 5×5 patch (25 cells)', () => {
    const cells = brushFootprint('disk5', { x: 4, y: 9, z: 4 })
    assert.equal(cells.length, 25)
    for (const c of cells) assert.equal(c.y, 9)
})

test('brushFootprint: centre offset propagates correctly to every cell', () => {
    const cells = brushFootprint('cube3', { x: 10, y: 20, z: 30 })
    for (const c of cells) {
        assert.ok(c.x >= 9 && c.x <= 11)
        assert.ok(c.y >= 19 && c.y <= 21)
        assert.ok(c.z >= 29 && c.z <= 31)
    }
})

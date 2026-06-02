import test from 'node:test'
import assert from 'node:assert/strict'
import { BRUSHES, brushDragFootprint, brushFootprint, getBrushDef, isDragBrush, type BrushKind } from '../src/editor/brush'

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

test('brushFootprint: column rises from the cursor with adjustable height', () => {
    const cells = brushFootprint('column', { x: 2, y: 5, z: -1 }, { columnHeight: 4 })
    assert.deepEqual(cells, [
        { x: 2, y: 5, z: -1 },
        { x: 2, y: 6, z: -1 },
        { x: 2, y: 7, z: -1 },
        { x: 2, y: 8, z: -1 },
    ])
})

test('brushFootprint: wallX paints a 1×N line along X', () => {
    const cells = brushFootprint('wallX', { x: 10, y: 2, z: 4 }, { wallLength: 5 })
    assert.equal(cells.length, 5)
    assert.deepEqual(cells.map((c) => c.x), [8, 9, 10, 11, 12])
    assert.ok(cells.every((c) => c.y === 2 && c.z === 4))
})

test('brushFootprint: wallZ paints a 1×N line along Z and keeps exact even lengths', () => {
    const cells = brushFootprint('wallZ', { x: 1, y: 3, z: 8 }, { wallLength: 4 })
    assert.equal(cells.length, 4)
    assert.deepEqual(cells.map((c) => c.z), [7, 8, 9, 10])
    assert.ok(cells.every((c) => c.x === 1 && c.y === 3))
})

test('brushFootprint: pattern dimensions clamp to safe integer ranges', () => {
    assert.equal(brushFootprint('column', ORIGIN, { columnHeight: 0 }).length, 1)
    assert.equal(brushFootprint('wallX', ORIGIN, { wallLength: 999 }).length, 64)
    assert.equal(brushFootprint('wallZ', ORIGIN, { wallLength: 2.8 }).length, 2)
})

test('brushFootprint: centre offset propagates correctly to every cell', () => {
    const cells = brushFootprint('cube3', { x: 10, y: 20, z: 30 })
    for (const c of cells) {
        assert.ok(c.x >= 9 && c.x <= 11)
        assert.ok(c.y >= 19 && c.y <= 21)
        assert.ok(c.z >= 29 && c.z <= 31)
    }
})

test('brushDragFootprint: box fills inclusive bounds in either drag direction', () => {
    const cells = brushDragFootprint('box', { x: 3, y: 2, z: 1 }, { x: 1, y: 2, z: 3 })
    assert.equal(cells.length, 9)
    assert.ok(cells.some((c) => c.x === 1 && c.y === 2 && c.z === 1), 'min corner present')
    assert.ok(cells.some((c) => c.x === 3 && c.y === 2 && c.z === 3), 'max corner present')
    assert.ok(cells.every((c) => c.y === 2), 'flat drag at same Y stays rectangular')
})

test('isDragBrush only marks box brush as drag-defined', () => {
    assert.equal(isDragBrush('box'), true)
    assert.equal(isDragBrush('column'), false)
    assert.equal(isDragBrush('wallX'), false)
    assert.equal(isDragBrush('wallZ'), false)
    assert.equal(isDragBrush('single'), false)
})

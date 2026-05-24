import test from 'node:test'
import assert from 'node:assert/strict'
import { clonePalette, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { appendMaterial, colorToHex, hexToColor, MAX_EDITOR_PALETTE_ENTRIES } from '../src/editor/palette-edit'

test('palette editor color helpers round-trip CSS hex values', () => {
    assert.equal(colorToHex(hexToColor('#336699')), '#336699')
    assert.equal(colorToHex([2, -1, 0.5]), '#ff0080')
    assert.deepEqual(hexToColor('not-a-color'), [1, 1, 1])
})

test('appendMaterial duplicates material data without aliasing source entry', () => {
    const palette = clonePalette(DEFAULT_PALETTE)
    const source = palette.entries[12]!
    const index = appendMaterial(palette, source)

    assert.equal(index, DEFAULT_PALETTE.entries.length)
    assert.equal(palette.entries[index]?.name, 'water copy')
    assert.deepEqual(palette.entries[index]?.movement, source.movement)

    palette.entries[index]!.color[0] = 1
    palette.entries[index]!.movement!.speedMultiplier = 0.9

    assert.notEqual(source.color[0], 1)
    assert.notEqual(source.movement?.speedMultiplier, 0.9)
})

test('appendMaterial refuses entries beyond the editor palette limit', () => {
    const palette = clonePalette(DEFAULT_PALETTE)
    while (palette.entries.length < MAX_EDITOR_PALETTE_ENTRIES) {
        assert.notEqual(appendMaterial(palette), -1)
    }

    assert.equal(appendMaterial(palette), -1)
})

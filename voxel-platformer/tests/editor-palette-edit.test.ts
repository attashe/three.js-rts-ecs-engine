import test from 'node:test'
import assert from 'node:assert/strict'
import {
    AIR,
    BLOCK,
    clonePalette,
    DEFAULT_PALETTE,
    voxelEmissive,
    voxelLightSpec,
} from '../src/engine/voxel/palette'
import { appendMaterial, colorToHex, hexToColor, MAX_EDITOR_PALETTE_ENTRIES } from '../src/editor/palette-edit'
import { colorToSwatchCss } from '../src/editor/ui/common'

test('palette editor color helpers round-trip CSS hex values', () => {
    assert.equal(colorToHex(hexToColor('#336699')), '#336699')
    assert.equal(colorToHex([2, -1, 0.5]), '#ff0080')
    assert.deepEqual(hexToColor('not-a-color'), [1, 1, 1])
})

test('palette swatches stay visible for prop materials with zero world opacity', () => {
    assert.equal(colorToSwatchCss(DEFAULT_PALETTE.entries[BLOCK.torch]!), 'rgba(255, 148, 41, 1)')
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

test('clonePalette deep-copies emissive + lightColor tuples', () => {
    const palette = clonePalette(DEFAULT_PALETTE)
    const glow = palette.entries[BLOCK.glow]!
    assert.deepEqual(glow.emissive, [1, 0.78, 0.4])
    assert.deepEqual(glow.lightColor, [1, 0.78, 0.4])

    glow.emissive![0] = 0
    glow.lightColor![1] = 0
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.glow]!.emissive![0], 1)
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.glow]!.lightColor![1], 0.78)
})

test('voxelEmissive pre-multiplies intensity and returns zero for non-emissive blocks', () => {
    const dirt = voxelEmissive(DEFAULT_PALETTE, BLOCK.dirt)
    assert.deepEqual(dirt, [0, 0, 0])

    const air = voxelEmissive(DEFAULT_PALETTE, AIR)
    assert.deepEqual(air, [0, 0, 0])

    const glow = voxelEmissive(DEFAULT_PALETTE, BLOCK.glow)
    assert.ok(glow[0] > 0 && glow[1] > 0 && glow[2] > 0, 'glow block emits')
    // intensity 0.85 × emissive tuple should match the spec
    assert.ok(Math.abs(glow[0] - 1 * 0.85) < 1e-6)
    assert.ok(Math.abs(glow[1] - 0.78 * 0.85) < 1e-6)
    assert.ok(Math.abs(glow[2] - 0.4 * 0.85) < 1e-6)
})

test('voxelLightSpec returns spec for lamp blocks and null for ordinary blocks', () => {
    assert.equal(voxelLightSpec(DEFAULT_PALETTE, AIR), null)
    assert.equal(voxelLightSpec(DEFAULT_PALETTE, BLOCK.stone), null)
    const lamp = voxelLightSpec(DEFAULT_PALETTE, BLOCK.glow)
    assert.ok(lamp)
    assert.equal(lamp!.intensity, 6)
    assert.equal(lamp!.distance, 10)
    assert.equal(lamp!.castShadow, false)
    assert.deepEqual(lamp!.color, [1, 0.78, 0.4])
})

test('voxelLightSpec falls back to emissive colour when lightColor omitted', () => {
    const palette = clonePalette(DEFAULT_PALETTE)
    const glow = palette.entries[BLOCK.glow]!
    delete glow.lightColor
    const spec = voxelLightSpec(palette, BLOCK.glow)
    assert.ok(spec)
    assert.deepEqual(spec!.color, [1, 0.78, 0.4]) // matches emissive
})

test('voxelLightSpec returns null when intensity is zero or non-finite', () => {
    const palette = clonePalette(DEFAULT_PALETTE)
    const glow = palette.entries[BLOCK.glow]!
    glow.lightIntensity = 0
    assert.equal(voxelLightSpec(palette, BLOCK.glow), null)
    glow.lightIntensity = Number.NaN
    assert.equal(voxelLightSpec(palette, BLOCK.glow), null)
})

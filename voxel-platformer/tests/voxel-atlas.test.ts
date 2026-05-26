import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildVoxelAtlas } from '../src/engine/voxel/atlas-builder'
import {
    ATLAS_SIZE,
    TILE_INDEX,
    TILE_NAMES,
    TILE_SIZE,
    TILE_SLOT_COUNT,
    TILES_PER_ROW,
} from '../src/engine/voxel/atlas-manifest'

test('atlas manifest constants are internally consistent', () => {
    assert.equal(ATLAS_SIZE, TILE_SIZE * TILES_PER_ROW)
    assert.equal(TILE_SLOT_COUNT, TILES_PER_ROW * TILES_PER_ROW)
    assert.equal(TILE_INDEX.blank, 0,
        'tile 0 must be blank — palette entries without textureKey fall through to slot 0')
    for (const [i, name] of TILE_NAMES.entries()) {
        assert.equal(TILE_INDEX[name], i, `${name} should map to slot ${i}`)
    }
})

test('buildVoxelAtlas yields the expected RGBA buffer size + alpha=255 throughout', () => {
    const result = buildVoxelAtlas()
    assert.equal(result.width, ATLAS_SIZE)
    assert.equal(result.height, ATLAS_SIZE)
    assert.equal(result.rgba.length, ATLAS_SIZE * ATLAS_SIZE * 4)
    // Spot-check alpha — every pixel must be fully opaque, otherwise
    // the chunk material would render the texture as transparent on
    // top of the lit colour.
    for (let i = 3; i < result.rgba.length; i += 4) {
        if (result.rgba[i] !== 255) {
            assert.fail(`pixel index ${i / 4} has alpha ${result.rgba[i]}, expected 255`)
        }
    }
})

test('buildVoxelAtlas is deterministic across runs (LCG-seeded painters)', () => {
    const a = buildVoxelAtlas()
    const b = buildVoxelAtlas()
    const hashA = createHash('sha256').update(a.rgba).digest('hex')
    const hashB = createHash('sha256').update(b.rgba).digest('hex')
    assert.equal(hashA, hashB,
        'two builds of the atlas must produce byte-identical pixels — ' +
        'tile painters must use only the seeded LCG, not Math.random()')
})

test('blank tile is uniform 1.0 — used as the fallback for plain-colour blocks', () => {
    const result = buildVoxelAtlas()
    const slot = TILE_INDEX.blank
    const col = slot % TILES_PER_ROW
    const row = Math.floor(slot / TILES_PER_ROW)
    const originX = col * TILE_SIZE
    const originY = row * TILE_SIZE
    for (let y = 0; y < TILE_SIZE; y++) {
        for (let x = 0; x < TILE_SIZE; x++) {
            const idx = ((originY + y) * ATLAS_SIZE + (originX + x)) * 4
            assert.equal(result.rgba[idx], 255, `blank tile pixel (${x},${y}) red must be 255`)
            assert.equal(result.rgba[idx + 1], 255, 'green must be 255')
            assert.equal(result.rgba[idx + 2], 255, 'blue must be 255')
        }
    }
    assert.equal(result.tileAverages[slot], 1, 'blank average must be 1.0')
})

test('every authored tile averages close to 1.0 — keeps textures-off look identical to textures-on tone', () => {
    const result = buildVoxelAtlas()
    for (const [i, name] of TILE_NAMES.entries()) {
        const avg = result.tileAverages[i]!
        assert.ok(avg >= 0.80, `tile "${name}" average ${avg.toFixed(3)} is too dark`)
        assert.ok(avg <= 1.00, `tile "${name}" average ${avg.toFixed(3)} > 1`)
    }
})

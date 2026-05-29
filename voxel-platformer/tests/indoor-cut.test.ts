import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { findCeilingY } from '../src/game/indoor-cut-system'

function chunks(): ChunkManager {
    return new ChunkManager(DEFAULT_PALETTE)
}

test('findCeilingY returns the first occluding block above the scan origin', () => {
    const c = chunks()
    c.setVoxel(0, 10, 0, BLOCK.roof)
    assert.equal(findCeilingY(c, 0, 0, 0, 16), 10)
})

test('findCeilingY ignores air — open sky returns null', () => {
    const c = chunks()
    assert.equal(findCeilingY(c, 0, 0, 0, 16), null)
})

test('findCeilingY ignores tree foliage — standing under a canopy is not indoors', () => {
    const c = chunks()
    for (const leaf of [BLOCK.leaf, BLOCK.leafDark, BLOCK.leafLight, BLOCK.deepLeaf]) {
        const cc = chunks()
        cc.setVoxel(0, 8, 0, leaf)
        assert.equal(findCeilingY(cc, 0, 0, 0, 16), null, `leaf ${leaf} should not count as a ceiling`)
    }
    // A real roof above the canopy is still detected past the leaves.
    c.setVoxel(0, 8, 0, BLOCK.leaf)
    c.setVoxel(0, 12, 0, BLOCK.roof)
    assert.equal(findCeilingY(c, 0, 0, 0, 16), 12)
})

test('findCeilingY does not see a ceiling beyond the scan height', () => {
    const c = chunks()
    c.setVoxel(0, 50, 0, BLOCK.stone)
    assert.equal(findCeilingY(c, 0, 0, 0, 16), null)
})

test('findCeilingY scans strictly above fromY and only the queried column', () => {
    const c = chunks()
    c.setVoxel(0, 5, 0, BLOCK.stone) // at fromY — must be ignored (strictly above)
    c.setVoxel(1, 9, 0, BLOCK.stone) // adjacent column — must be ignored
    c.setVoxel(0, 12, 0, BLOCK.stone)
    assert.equal(findCeilingY(c, 0, 0, 5, 16), 12)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { greedyMesh } from '../src/engine/voxel/greedy-mesher'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { TILE_INDEX } from '../src/engine/voxel/atlas-manifest'

/** Build a sampler that returns `value` at one cell and AIR everywhere else. */
function singleCellSampler(value: number, cx = 0, cy = 0, cz = 0) {
    return (x: number, y: number, z: number): number => (
        x === cx && y === cy && z === cz ? value : 0
    )
}

/** Sampler returning `value` across a w×h×depth rectangle starting at (0,0,0). */
function rectSampler(value: number, w: number, h: number, depth: number) {
    return (x: number, y: number, z: number): number => (
        x >= 0 && x < w && y >= 0 && y < h && z >= 0 && z < depth ? value : 0
    )
}

test('greedyMesh emits voxelUV in [0,1] and tileIndex matches palette key for a 1×1×1 voxel', () => {
    const data = greedyMesh(singleCellSampler(BLOCK.grass), 4, DEFAULT_PALETTE)
    // Single cube has 6 faces × 4 verts = 24 vertices.
    assert.equal(data.vertexCount, 24)
    assert.equal(data.uvs.length, 24 * 2)
    assert.equal(data.tileIndices.length, 24)

    // Every UV component should be either 0 or 1 (each corner of a
    // unit-quad sits at one of the four corners of its tile).
    for (const u of data.uvs) {
        assert.ok(u === 0 || u === 1, `UV value ${u} must be 0 or 1 for a unit voxel`)
    }
    // Every vertex of a grass cube must reference the grass tile slot.
    for (const idx of data.tileIndices) {
        assert.equal(idx, TILE_INDEX.grass)
    }
})

test('greedyMesh UV span matches merged quad size — a 3×3×1 grass slab produces UVs up to (3, 3)', () => {
    const data = greedyMesh(rectSampler(BLOCK.grass, 3, 1, 3), 4, DEFAULT_PALETTE)
    // Top + bottom faces are 3×3 merged quads; side faces are 3×1.
    assert.ok(data.vertexCount > 0)

    // Find the maximum UV value emitted. For a 3×3 top quad it should be 3.
    let maxU = 0
    let maxV = 0
    for (let i = 0; i < data.uvs.length; i += 2) {
        maxU = Math.max(maxU, data.uvs[i]!)
        maxV = Math.max(maxV, data.uvs[i + 1]!)
    }
    assert.equal(maxU, 3, 'merged 3-wide quad should emit UV.u up to 3')
    assert.equal(maxV, 3, 'merged 3-deep quad should emit UV.v up to 3')
})

test('plain-colour blocks (no textureKey) fall through to tile slot 0 = blank', () => {
    // BLOCK.glow has no textureKey on the default palette.
    const data = greedyMesh(singleCellSampler(BLOCK.glow), 4, DEFAULT_PALETTE)
    assert.ok(data.vertexCount > 0)
    for (const idx of data.tileIndices) {
        assert.equal(idx, TILE_INDEX.blank,
            'blocks without textureKey must use the blank tile (slot 0)')
    }
})

test('greedyMesh emits the same number of UV / tileIndex entries as positions/normals', () => {
    const data = greedyMesh(rectSampler(BLOCK.brick, 2, 1, 2), 4, DEFAULT_PALETTE)
    const expectedVerts = data.positions.length / 3
    assert.equal(data.uvs.length, expectedVerts * 2)
    assert.equal(data.tileIndices.length, expectedVerts)
    assert.equal(data.normals.length, expectedVerts * 3)
    assert.equal(data.colors.length, expectedVerts * 4)
})

test('editing textureKey on a palette entry flips the emitted tile index', () => {
    // Clone DEFAULT_PALETTE so we can mutate without affecting other
    // tests. The clone is shallow on `entries`, deep enough for our
    // textureKey poke since each entry is its own object.
    const palette = { entries: DEFAULT_PALETTE.entries.map((e) => ({ ...e })) }

    // Start: BLOCK.glow has no textureKey, so it should fall through
    // to slot 0 (blank).
    const before = greedyMesh(singleCellSampler(BLOCK.glow), 4, palette)
    for (const idx of before.tileIndices) {
        assert.equal(idx, 0, 'baseline: glow falls through to blank')
    }

    // Author flips it to "brick" via the material editor → new mesh
    // pass picks up the change. Mirrors the runtime flow:
    // entry.textureKey = ... → markAllDirty → renderer re-runs
    // greedyMesh against the freshly-mutated palette.
    palette.entries[BLOCK.glow]!.textureKey = 'brick'
    const after = greedyMesh(singleCellSampler(BLOCK.glow), 4, palette)
    for (const idx of after.tileIndices) {
        assert.notEqual(idx, 0, 'after textureKey change: should NOT be blank')
    }
})

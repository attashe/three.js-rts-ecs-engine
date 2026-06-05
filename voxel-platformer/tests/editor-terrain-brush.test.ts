import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import {
    buildRampEdits,
    buildTerrainStrokeEdits,
    falloffWeight,
    findTerrainSurface,
    terrainBrushColumns,
} from '../src/editor/terrain-brush'

test('terrainBrushColumns: circle footprint is bounded by radius with weighted center', () => {
    const columns = terrainBrushColumns({ x: 10, z: 20 }, { shape: 'circle', radius: 2, falloff: 'linear' })
    assert.ok(columns.some((c) => c.x === 10 && c.z === 20 && c.weight === 1), 'center included at full strength')
    assert.ok(columns.every((c) => Math.hypot(c.x - 10, c.z - 20) <= 2), 'all columns stay inside circle')
    assert.ok(columns.some((c) => c.weight > 0 && c.weight < 1), 'linear falloff produces partial weights')
})

test('terrainBrushColumns: square footprint covers an inclusive square', () => {
    const columns = terrainBrushColumns({ x: 0, z: 0 }, { shape: 'square', radius: 2, falloff: 'hard' })
    assert.equal(columns.length, 25)
    assert.ok(columns.some((c) => c.x === -2 && c.z === -2), 'min corner present')
    assert.ok(columns.some((c) => c.x === 2 && c.z === 2), 'max corner present')
    assert.ok(columns.every((c) => c.weight === 1), 'hard falloff has uniform weight')
})

test('falloffWeight: smooth falloff is monotonic and softer than hard edges', () => {
    const center = falloffWeight(0, 4, 'smooth')
    const mid = falloffWeight(2, 4, 'smooth')
    const edge = falloffWeight(4, 4, 'smooth')
    assert.equal(center, 1)
    assert.ok(mid > edge)
    assert.ok(edge > 0)
    assert.equal(falloffWeight(4, 4, 'hard'), 1)
})

test('findTerrainSurface ignores non-walkable liquids and returns the solid bed', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 2, 0, BLOCK.stone)
    chunks.setVoxel(0, 3, 0, BLOCK.water)
    assert.deepEqual(findTerrainSurface(chunks, chunks.palette, 0, 0, 0, 8), { y: 2, block: BLOCK.stone })
})

test('buildTerrainStrokeEdits: sculpt raise replaces buried top with fill and adds new top', () => {
    const chunks = seededGround()
    const edits = buildTerrainStrokeEdits(chunks, chunks.palette, 'sculpt', { x: 1, y: 4, z: 1 }, {
        shape: 'circle',
        radius: 0,
        falloff: 'hard',
        strength: 2,
        targetHeight: 4,
        minY: 0,
        maxY: 12,
        fillBlock: BLOCK.dirt,
        repaintTop: false,
        activeBlock: BLOCK.sand,
    })
    chunks.applyBulk(edits)
    assert.equal(chunks.getVoxel(1, 4, 1), BLOCK.dirt)
    assert.equal(chunks.getVoxel(1, 5, 1), BLOCK.dirt)
    assert.equal(chunks.getVoxel(1, 6, 1), BLOCK.grass)
})

test('buildTerrainStrokeEdits: sculpt lower clears top voxels and exposes existing soil', () => {
    const chunks = seededGround()
    chunks.setVoxel(1, 5, 1, BLOCK.dirt)
    chunks.setVoxel(1, 6, 1, BLOCK.grass)
    const edits = buildTerrainStrokeEdits(chunks, chunks.palette, 'sculpt', { x: 1, y: 6, z: 1 }, {
        shape: 'circle',
        radius: 0,
        falloff: 'hard',
        strength: 2,
        targetHeight: 4,
        minY: 0,
        maxY: 12,
        fillBlock: BLOCK.dirt,
        repaintTop: false,
        activeBlock: BLOCK.sand,
    }, -1)
    chunks.applyBulk(edits)
    assert.equal(chunks.getVoxel(1, 6, 1), BLOCK.air)
    assert.equal(chunks.getVoxel(1, 5, 1), BLOCK.air)
    assert.equal(chunks.getVoxel(1, 4, 1), BLOCK.grass)
})

test('buildTerrainStrokeEdits: flatten moves columns toward target height', () => {
    const chunks = seededGround()
    chunks.setVoxel(0, 5, 0, BLOCK.dirt)
    chunks.setVoxel(0, 6, 0, BLOCK.grass)
    const edits = buildTerrainStrokeEdits(chunks, chunks.palette, 'flatten', { x: 0, y: 6, z: 0 }, {
        shape: 'square',
        radius: 0,
        falloff: 'hard',
        strength: 4,
        targetHeight: 4,
        minY: 0,
        maxY: 12,
        fillBlock: BLOCK.dirt,
        repaintTop: true,
        activeBlock: BLOCK.sand,
    })
    chunks.applyBulk(edits)
    assert.equal(chunks.getVoxel(0, 6, 0), BLOCK.air)
    assert.equal(chunks.getVoxel(0, 5, 0), BLOCK.air)
    assert.equal(chunks.getVoxel(0, 4, 0), BLOCK.sand)
})

test('buildTerrainStrokeEdits: smooth pulls an outlier toward its neighbors', () => {
    const chunks = seededGround()
    chunks.setVoxel(1, 5, 1, BLOCK.dirt)
    chunks.setVoxel(1, 6, 1, BLOCK.dirt)
    chunks.setVoxel(1, 7, 1, BLOCK.dirt)
    chunks.setVoxel(1, 8, 1, BLOCK.grass)
    const edits = buildTerrainStrokeEdits(chunks, chunks.palette, 'smooth', { x: 1, y: 8, z: 1 }, {
        shape: 'circle',
        radius: 0,
        falloff: 'hard',
        strength: 1,
        targetHeight: 4,
        minY: 0,
        maxY: 12,
        fillBlock: BLOCK.dirt,
        repaintTop: true,
        activeBlock: BLOCK.grass,
    })
    chunks.applyBulk(edits)
    assert.ok(findTerrainSurface(chunks, chunks.palette, 1, 1, 0, 12)!.y < 8)
})

test('buildTerrainStrokeEdits: paint-surface changes only the top terrain voxel', () => {
    const chunks = seededGround()
    const edits = buildTerrainStrokeEdits(chunks, chunks.palette, 'paint-surface', { x: 2, y: 4, z: 2 }, {
        shape: 'circle',
        radius: 1,
        falloff: 'hard',
        strength: 1,
        targetHeight: 4,
        minY: 0,
        maxY: 12,
        fillBlock: BLOCK.dirt,
        repaintTop: true,
        activeBlock: BLOCK.sand,
    })
    chunks.applyBulk(edits)
    assert.equal(chunks.getVoxel(2, 4, 2), BLOCK.sand)
    assert.equal(chunks.getVoxel(2, 3, 2), BLOCK.dirt)
})

test('buildRampEdits creates an interpolated continuous strip', () => {
    const chunks = seededGround()
    const edits = buildRampEdits(chunks, chunks.palette, { x: 0, y: 4, z: 1 }, { x: 4, y: 8, z: 1 }, {
        width: 1,
        minY: 0,
        maxY: 12,
        fillBlock: BLOCK.dirt,
        repaintTop: true,
        activeBlock: BLOCK.stone,
    })
    chunks.applyBulk(edits)
    assert.equal(findTerrainSurface(chunks, chunks.palette, 0, 1, 0, 12)!.y, 4)
    assert.equal(findTerrainSurface(chunks, chunks.palette, 2, 1, 0, 12)!.y, 6)
    assert.equal(findTerrainSurface(chunks, chunks.palette, 4, 1, 0, 12)!.y, 8)
    assert.equal(chunks.getVoxel(4, 8, 1), BLOCK.stone)
})

function seededGround(): ChunkManager {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x < 5; x++) {
        for (let z = 0; z < 5; z++) {
            for (let y = 0; y < 4; y++) chunks.setVoxel(x, y, z, BLOCK.dirt)
            chunks.setVoxel(x, 4, z, BLOCK.grass)
        }
    }
    return chunks
}

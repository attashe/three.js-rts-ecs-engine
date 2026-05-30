import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import {
    DEFAULT_PREFAB_ID,
    STRUCTURE_PREFABS,
    generateStructureAsset,
    measureStructurePlacement,
    structurePlacementEdits,
    structurePropPlacements,
    placeStructureAsset,
    prefabSource,
    proceduralSource,
    rotatedSize,
    type StructureRotation,
    type StructureTransform,
} from '../src/procedural-structures'

function signature(edits: { x: number; y: number; z: number; value: number }[]): string {
    return edits.map((e) => `${e.x},${e.y},${e.z}:${e.value}`).sort().join('|')
}

test('procedural asset is deterministic and normalised to a (0,0,0) min corner', () => {
    const source = proceduralSource('house', 7)
    const a = generateStructureAsset(source, { palette: DEFAULT_PALETTE })
    const b = generateStructureAsset(source, { palette: DEFAULT_PALETTE })

    assert.equal(signature(a.voxels.map((v) => ({ ...v, value: v.block }))), signature(b.voxels.map((v) => ({ ...v, value: v.block }))))
    assert.equal(a.bounds.minX, 0)
    assert.equal(a.bounds.minY, 0)
    assert.equal(a.bounds.minZ, 0)
    assert.equal(a.size.width, a.bounds.width)
    assert.ok(a.stats.voxelCount > 0)
})

test('procedural wall asset uses sample length but stays normalised for editor readouts', () => {
    const asset = generateStructureAsset(proceduralSource('wall', 12, {
        wall: { length: 18, height: 5, thickness: 3, gate: 'center' },
    }), { palette: DEFAULT_PALETTE })

    assert.equal(asset.bounds.minX, 0)
    assert.equal(asset.bounds.minY, 0)
    assert.equal(asset.bounds.minZ, 0)
    assert.equal(asset.size.width, 18)
    assert.equal(asset.size.depth, 3)
    assert.ok(asset.voxels.some((v) => v.tag === 'wall-crenel'))
    assert.ok(asset.voxels.some((v) => v.tag === 'wall-gate-lintel'))
})

test('structuralOnly drops decorative voxels but keeps the structure', () => {
    const source = proceduralSource('tree', 24, { tree: { style: 'oak', fruitChance: 0.35 } })
    const full = generateStructureAsset(source)
    const lean = generateStructureAsset(source, { structuralOnly: true })
    assert.ok(lean.stats.voxelCount > 0)
    assert.ok(lean.stats.voxelCount <= full.stats.voxelCount)
})

test('every prefab generates voxels and resolves a label', () => {
    for (const prefab of STRUCTURE_PREFABS) {
        const asset = generateStructureAsset(prefabSource(prefab.id), { palette: DEFAULT_PALETTE })
        assert.ok(asset.stats.voxelCount > 0, `${prefab.id} should generate voxels`)
        assert.equal(asset.label, prefab.label)
        assert.ok(asset.size.width > 0 && asset.size.height > 0 && asset.size.depth > 0)
    }
})

test('station and forge prefabs bundle deterministic prop placements', () => {
    for (const id of ['train-station', 'forge'] as const) {
        const asset = generateStructureAsset(prefabSource(id), { palette: DEFAULT_PALETTE })
        assert.ok(asset.decorationProps.length > 0, `${id} should include mesh props`)
        assert.ok(asset.voxels.some((v) => v.block === BLOCK.fence), `${id} should use adaptive fence blocks`)
        const props = structurePropPlacements(asset, { origin: { x: 30, y: 4, z: 40 }, rotation: 0, anchor: 'bottom-center' }, `test:${id}`)
        assert.equal(props.length, asset.decorationProps.length)
        assert.equal(new Set(props.map((p) => p.id)).size, props.length)
        assert.ok(props.every((p) => p.id.startsWith(`test:${id}:`)))
    }

    const station = generateStructureAsset(prefabSource('train-station'), { palette: DEFAULT_PALETTE })
    assert.ok(station.voxels.some((v) => v.block === BLOCK.rail), 'station should include a rail line')

    const forge = generateStructureAsset(prefabSource('forge'), { palette: DEFAULT_PALETTE })
    assert.ok(forge.voxels.some((v) => v.tag === 'forge-fire'), 'forge should include an active hearth')
})

test('portal gate prefab has a stable footprint and an emissive keystone', () => {
    const asset = generateStructureAsset(prefabSource(DEFAULT_PREFAB_ID))
    assert.equal(asset.footprint.width, 9) // pillars ±3 + base steps ±4 ⇒ 9 wide
    assert.equal(asset.footprint.depth, 2)
    assert.ok(asset.voxels.some((v) => v.tag === 'portal-keystone'))
    assert.ok(asset.voxels.some((v) => v.tag === 'portal-field'))
})

test('90/270 rotations swap footprint width and depth; 180 keeps them', () => {
    const asset = generateStructureAsset(prefabSource('banner-arch'))
    assert.notEqual(asset.size.width, asset.size.depth) // 7 x 1, so swaps are observable
    assert.deepEqual(rotatedSize(asset, 0), asset.size)
    assert.deepEqual(rotatedSize(asset, 180), asset.size)
    const r90 = rotatedSize(asset, 90)
    assert.equal(r90.width, asset.size.depth)
    assert.equal(r90.depth, asset.size.width)
})

test('rotation preserves voxel count and stays inside the rotated bounds', () => {
    const asset = generateStructureAsset(prefabSource('well'))
    for (const rotation of [0, 90, 180, 270] as StructureRotation[]) {
        const transform: StructureTransform = { origin: { x: 0, y: 0, z: 0 }, rotation, anchor: 'min-corner' }
        const edits = structurePlacementEdits(asset, transform)
        assert.equal(edits.length, asset.voxels.length)
        const size = rotatedSize(asset, rotation)
        for (const e of edits) {
            assert.ok(e.x >= 0 && e.x < size.width, `x ${e.x} out of [0,${size.width}) at rot ${rotation}`)
            assert.ok(e.z >= 0 && e.z < size.depth, `z ${e.z} out of [0,${size.depth}) at rot ${rotation}`)
        }
    }
})

test('measureStructurePlacement matches the actual stamped extent', () => {
    const asset = generateStructureAsset(proceduralSource('tower', 9, { tower: { style: 'round' } }))
    for (const rotation of [0, 90, 180, 270] as StructureRotation[]) {
        const transform: StructureTransform = { origin: { x: 40, y: 12, z: -8 }, rotation, anchor: 'bottom-center' }
        const measured = measureStructurePlacement(asset, transform)
        const edits = structurePlacementEdits(asset, transform)
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
        for (const e of edits) {
            minX = Math.min(minX, e.x); maxX = Math.max(maxX, e.x)
            minY = Math.min(minY, e.y); maxY = Math.max(maxY, e.y)
            minZ = Math.min(minZ, e.z); maxZ = Math.max(maxZ, e.z)
        }
        assert.deepEqual(
            { minX, minY, minZ, maxX, maxY, maxZ },
            { minX: measured.bounds.minX, minY: measured.bounds.minY, minZ: measured.bounds.minZ, maxX: measured.bounds.maxX, maxY: measured.bounds.maxY, maxZ: measured.bounds.maxZ },
        )
    }
})

test('bottom-center anchor rests the structure base on origin.y and centres XZ', () => {
    const asset = generateStructureAsset(prefabSource('campfire'))
    const transform: StructureTransform = { origin: { x: 5, y: 3, z: 5 }, rotation: 0, anchor: 'bottom-center' }
    const measured = measureStructurePlacement(asset, transform)
    assert.equal(measured.bounds.minY, 3) // base sits on the origin row
    assert.equal((measured.bounds.minX + measured.bounds.maxX) >> 1, 5)
    assert.equal((measured.bounds.minZ + measured.bounds.maxZ) >> 1, 5)
})

test('placeStructureAsset stamps the cells and yields invertible undo edits', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const asset = generateStructureAsset(prefabSource('well'))
    const transform: StructureTransform = { origin: { x: 10, y: 1, z: 10 }, rotation: 90, anchor: 'bottom-center' }

    const result = placeStructureAsset(chunks, asset, transform)
    assert.ok(result.changedVoxels > 0)
    for (const e of result.after) assert.equal(chunks.getVoxel(e.x, e.y, e.z), e.value)

    // Undo: re-apply the before edits and confirm the cells are cleared.
    chunks.applyBulk(result.before)
    for (const e of result.after) assert.equal(chunks.getVoxel(e.x, e.y, e.z), 0)
})

test('structuralOnly recovers ground plantings as flower/mushroom props, not cubes', () => {
    const source = proceduralSource('tree', 7)

    // Full asset keeps the flat decoration voxels and exposes no props.
    const full = generateStructureAsset(source, { palette: DEFAULT_PALETTE })
    assert.equal(full.decorationProps.length, 0)
    assert.ok(full.voxels.some((v) => v.block === BLOCK.flower || v.block === BLOCK.mushroom))

    // structuralOnly drops those voxels and re-emits them as prop placements.
    const structural = generateStructureAsset(source, { palette: DEFAULT_PALETTE, structuralOnly: true })
    assert.equal(structural.voxels.some((v) => v.block === BLOCK.flower || v.block === BLOCK.mushroom), false)
    assert.ok(structural.decorationProps.length > 0)
    for (const p of structural.decorationProps) {
        // Ground plantings can scatter beyond the trunk's structural footprint,
        // so local coords may be negative — they stay in the asset's frame.
        assert.match(p.kind, /^(flower|mushroom)(-[23])?$/)
        assert.ok(p.scale >= 0.85 && p.scale <= 1.15)
    }

    // Deterministic — same source yields the same plantings.
    const again = generateStructureAsset(source, { palette: DEFAULT_PALETTE, structuralOnly: true })
    assert.deepEqual(structural.decorationProps, again.decorationProps)
})

test('structurePropPlacements lands plantings on cell centres and applies the transform', () => {
    const asset = generateStructureAsset(proceduralSource('tree', 7), { palette: DEFAULT_PALETTE, structuralOnly: true })
    const transform: StructureTransform = { origin: { x: 200, y: 6, z: 60 }, rotation: 90, anchor: 'bottom-center' }
    const props = structurePropPlacements(asset, transform, 'town:plot-3')

    assert.equal(props.length, asset.decorationProps.length)
    const ids = new Set(props.map((p) => p.id))
    assert.equal(ids.size, props.length, 'prop ids are unique and stable')
    for (const p of props) {
        assert.ok(p.id.startsWith('town:plot-3:'))
        assert.equal(p.position.x % 1, 0.5, 'x sits on the cell centre')
        assert.equal(p.position.z % 1, 0.5, 'z sits on the cell centre')
        assert.equal(p.gridAligned, false)
    }

    // An asset whose decoration is still voxels (full stamp) yields no props.
    const full = generateStructureAsset(proceduralSource('tree', 7), { palette: DEFAULT_PALETTE })
    assert.equal(structurePropPlacements(full, transform, 'x').length, 0)
})

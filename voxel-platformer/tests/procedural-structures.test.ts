import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE, clonePalette, paletteTileIndex } from '../src/engine/voxel/palette'
import {
    generateStructureScene,
    normalizeStructureOptions,
    type StructureVoxel,
} from '../src/procedural-structures/generator'

function signature(voxels: StructureVoxel[]): string {
    return voxels
        .map((v) => `${v.x},${v.y},${v.z}:${v.block}:${v.tag}`)
        .sort()
        .join('|')
}

test('procedural structures are deterministic for identical options', () => {
    const opts = normalizeStructureOptions({
        kind: 'mixed',
        seed: 42,
        variants: 4,
        terrainSize: 64,
    })

    const a = generateStructureScene(opts, DEFAULT_PALETTE)
    const b = generateStructureScene(opts, DEFAULT_PALETTE)

    assert.equal(signature(a.voxels), signature(b.voxels))
    assert.deepEqual(a.bounds, b.bounds)
    assert.deepEqual(a.materialCounts, b.materialCounts)
})

test('changing seed changes generated detail while keeping bounded dimensions', () => {
    const base = {
        kind: 'house' as const,
        variants: 2,
        terrainSize: 56,
        house: { style: 'mixed' as const, roofStyle: 'mixed' as const },
    }
    const a = generateStructureScene({ ...base, seed: 100 }, DEFAULT_PALETTE)
    const b = generateStructureScene({ ...base, seed: 101 }, DEFAULT_PALETTE)

    assert.notEqual(signature(a.voxels), signature(b.voxels))
    assert.ok(a.bounds.width <= 80)
    assert.ok(a.bounds.depth <= 80)
    assert.ok(a.bounds.height <= 40)
})

test('one-floor gable house does not emit extra floor bands', () => {
    const result = generateStructureScene({
        kind: 'house',
        seed: 7,
        variants: 1,
        showTerrain: false,
        cleanLoose: true,
        house: {
            style: 'timber',
            roofStyle: 'gable',
            floors: 1,
            width: 20,
            depth: 16,
            floorHeight: 6,
            sideWing: false,
            porch: false,
            chimney: false,
        },
    }, DEFAULT_PALETTE)

    assert.equal(result.voxels.some((v) => v.tag === 'house-floor-band'), false)
    assert.ok(result.voxels.some((v) => v.tag === 'roof-ridge'))
    assert.ok(result.voxels.filter((v) => v.tag === 'gable-end-panel').length > 10)
    assert.ok(result.bounds.height <= 18)
})

test('house door path is continuous instead of separated sleepers', () => {
    const result = generateStructureScene({
        kind: 'house',
        seed: 11,
        variants: 1,
        showTerrain: false,
        cleanLoose: true,
        house: {
            style: 'cottage',
            roofStyle: 'gable',
            floors: 1,
            width: 20,
            depth: 16,
            floorHeight: 6,
            sideWing: false,
            porch: true,
            chimney: false,
        },
    }, DEFAULT_PALETTE)

    const path = result.voxels.filter((v) => v.tag === 'door-path')
    assert.ok(path.length > 0)
    const byZ = new Map<number, StructureVoxel[]>()
    for (const v of path) byZ.set(v.z, [...(byZ.get(v.z) ?? []), v])
    const rows = [...byZ.keys()].sort((a, b) => a - b)

    for (let i = 1; i < rows.length; i++) assert.equal(rows[i]! - rows[i - 1]!, 1)
    for (const row of byZ.values()) assert.ok(row.length >= 3)
})

test('porch steps connect road height to porch height without overshooting entry', () => {
    const result = generateStructureScene({
        kind: 'house',
        seed: 11,
        variants: 1,
        showTerrain: false,
        cleanLoose: true,
        house: {
            style: 'cottage',
            roofStyle: 'gable',
            floors: 1,
            width: 20,
            depth: 16,
            floorHeight: 6,
            sideWing: false,
            porch: true,
            chimney: false,
        },
    }, DEFAULT_PALETTE)

    const porch = result.voxels.filter((v) => v.tag === 'porch-floor')
    assert.ok(porch.length > 0)
    const porchY = porch[0]!.y
    const porchFrontZ = Math.min(...porch.map((v) => v.z))
    const lower = result.voxels.filter((v) => v.tag === 'porch-step-lower')
    const upper = result.voxels.filter((v) => v.tag === 'porch-step-upper')
    const road = result.voxels.filter((v) => v.tag === 'door-path' && v.z === porchFrontZ - 3)

    assert.ok(lower.length >= 5)
    assert.ok(upper.length >= 7)
    assert.ok(road.length >= 3)
    assert.equal(Math.max(...lower.map((v) => v.y)), porchY - 1)
    assert.equal(Math.max(...upper.map((v) => v.y)), porchY)
    assert.equal(new Set(lower.map((v) => v.z)).size, 1)
    assert.equal(new Set(upper.map((v) => v.z)).size, 1)
    assert.equal(lower[0]!.z, porchFrontZ - 2)
    assert.equal(upper[0]!.z, porchFrontZ - 1)
    assert.equal(result.voxels.some((v) => v.tag === 'porch-steps' && v.y > porchY), false)
})

test('porch deck, posts, and awning share the same centered footprint', () => {
    const result = generateStructureScene({
        kind: 'house',
        seed: 11,
        variants: 1,
        showTerrain: false,
        cleanLoose: true,
        house: {
            style: 'cottage',
            roofStyle: 'gable',
            floors: 1,
            width: 20,
            depth: 16,
            floorHeight: 6,
            sideWing: false,
            porch: true,
            chimney: false,
        },
    }, DEFAULT_PALETTE)

    const floor = result.voxels.filter((v) => v.tag === 'porch-floor')
    const posts = result.voxels.filter((v) => v.tag === 'porch-post')
    const awning = result.voxels.filter((v) => v.tag === 'porch-awning')
    assert.ok(floor.length > 0)
    assert.ok(posts.length > 0)
    assert.ok(awning.length > 0)

    const floorXs = floor.map((v) => v.x)
    const floorZs = floor.map((v) => v.z)
    const minX = Math.min(...floorXs)
    const maxX = Math.max(...floorXs)
    const minZ = Math.min(...floorZs)
    const maxZ = Math.max(...floorZs)
    const centerX = Math.round((minX + maxX) / 2)

    assert.equal(maxX - minX + 1, 7)
    assert.equal(maxZ - minZ + 1, 3)
    assert.equal(result.voxels.some((v) => v.tag === 'porch-step-upper' && v.x === centerX && v.z === minZ - 1), true)
    for (const x of [minX, maxX]) {
        for (const z of [minZ, maxZ]) assert.equal(posts.some((v) => v.x === x && v.z === z), true)
    }
    assert.equal(Math.min(...awning.map((v) => v.x)), minX - 1)
    assert.equal(Math.max(...awning.map((v) => v.x)), maxX + 1)
    assert.equal(Math.min(...awning.map((v) => v.z)), minZ)
    assert.equal(Math.max(...awning.map((v) => v.z)), maxZ)
})

test('shed roof closes side panels under the raised roof plane', () => {
    const result = generateStructureScene({
        kind: 'house',
        seed: 15,
        variants: 1,
        showTerrain: false,
        cleanLoose: true,
        house: {
            style: 'timber',
            roofStyle: 'shed',
            floors: 1,
            width: 20,
            depth: 16,
            floorHeight: 6,
            sideWing: false,
            porch: false,
            chimney: false,
        },
    }, DEFAULT_PALETTE)

    assert.ok(result.voxels.some((v) => v.tag === 'shed-roof'))
    assert.ok(result.voxels.filter((v) => v.tag === 'shed-roof-side-panel').length > 8)
    assert.ok(result.voxels.filter((v) => v.tag === 'shed-roof-high-panel').length > 4)
})

test('tower styles generate valid coordinates and expected marker details', () => {
    for (const style of ['round', 'square', 'lighthouse', 'ruined'] as const) {
        const result = generateStructureScene({
            kind: 'tower',
            seed: 9,
            variants: 1,
            showTerrain: false,
            tower: { style, radius: 8, height: 28, wallThickness: 2, spire: true },
        }, DEFAULT_PALETTE)

        assert.ok(result.voxels.length > 0, `${style} should generate voxels`)
        for (const v of result.voxels) {
            assert.equal(Number.isFinite(v.x), true)
            assert.equal(Number.isFinite(v.y), true)
            assert.equal(Number.isFinite(v.z), true)
        }
        if (style === 'lighthouse') assert.ok(result.voxels.some((v) => v.tag === 'lighthouse-fire'))
        if (style === 'lighthouse') assert.ok(result.voxels.some((v) => v.tag === 'tower-roof-lighthouse'))
        if (style === 'round') assert.ok(result.voxels.some((v) => v.tag === 'tower-roof-cone'))
        if (style === 'square') assert.ok(result.voxels.some((v) => v.tag === 'tower-roof-pyramid'))
        if (style === 'ruined') assert.ok(result.voxels.some((v) => v.tag === 'ruin-rubble-base'))
        if (style === 'ruined') assert.ok(result.voxels.some((v) => v.tag === 'tower-roof-ruin'))
    }
})

test('tower interior floors are clean decks with stairwell openings', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 21,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { style: 'round', radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0 },
    }, DEFAULT_PALETTE)

    assert.equal(result.voxels.some((v) => v.tag === 'tower-floor-slats'), false)
    assert.ok(result.voxels.some((v) => v.tag === 'tower-stairwell-rim'))
    const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))
    const firstFloorY = 6
    const floor = new Set(result.voxels
        .filter((v) => (
            v.tag === 'tower-floor-deck'
            || v.tag === 'tower-floor-rim'
            || v.tag === 'tower-spiral-step'
            || v.tag === 'tower-stair-landing'
            || v.tag === 'tower-stairwell-rim'
        ) && v.y === firstFloorY)
        .map((v) => `${v.x},${v.z}`))
    assert.ok(floor.size > 70)

    assert.equal(cells.has('-2,6,0'), false, 'first floor should have an open stairwell hole')
    assert.ok(floor.has('-4,0'), 'first floor should frame the stairwell opening')
    assert.ok(result.voxels.some((v) => v.tag === 'tower-floor-deck' && v.y === 24), 'upper tower floor should not be omitted near the crown')
})

test('tower interior includes a continuous spiral stair from entry to crown', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 22,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { style: 'round', radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0 },
    }, DEFAULT_PALETTE)

    const steps = result.voxels.filter((v) => v.tag === 'tower-spiral-step')
    assert.ok(steps.length > 40)
    const stepYs = new Set(steps.map((v) => v.y))
    for (let y = 1; y <= 27; y++) assert.equal(stepYs.has(y), true, `missing spiral step at y=${y}`)
    assert.ok(result.voxels.some((v) => v.tag === 'tower-stair-landing' && v.y === 6))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-stair-landing' && v.y === 12))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-stair-landing' && v.y === 24))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-top-landing' && v.y === 27))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-spiral-pillar'))
    for (const step of steps) assert.ok(step.x * step.x + step.z * step.z < 36, `spiral step outside interior at ${step.x},${step.y},${step.z}`)
    for (const step of steps) assert.ok(Math.max(Math.abs(step.x), Math.abs(step.z)) <= 3, `spiral step too wide at ${step.x},${step.y},${step.z}`)
})

test('tower roof sits on a crown deck without a vertical gap above crenels', () => {
    for (const [style, roofTag] of [['round', 'tower-roof-cone'], ['square', 'tower-roof-pyramid']] as const) {
        const result = generateStructureScene({
            kind: 'tower',
            seed: 33,
            variants: 1,
            variation: 0,
            showTerrain: false,
            tower: { style, radius: 8, height: 28, wallThickness: 2, spire: true, taper: 0 },
        }, DEFAULT_PALETTE)
        const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))
        const roofBase = result.voxels.filter((v) => v.tag === roofTag && v.y === 30)

        assert.ok(result.voxels.some((v) => v.tag === 'tower-crown-deck' && v.y === 29), `${style} tower should have crown deck`)
        assert.ok(roofBase.length > 0, `${style} tower should have roof base`)
        for (const v of roofBase) {
            assert.equal(cells.has(`${v.x},${v.y - 1},${v.z}`), true, `${style} roof base unsupported at ${v.x},${v.y},${v.z}`)
        }
    }
})

test('tower crown stays open when no spire is generated', () => {
    for (const style of ['round', 'square'] as const) {
        const result = generateStructureScene({
            kind: 'tower',
            seed: 35,
            variants: 1,
            variation: 0,
            showTerrain: false,
            tower: { style, radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0 },
        }, DEFAULT_PALETTE)
        const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))

        assert.equal(result.voxels.some((v) => v.tag === 'tower-crown-deck'), false, `${style} tower should not close the roofless crown`)
        assert.equal(cells.has('0,29,0'), false, `${style} tower crown should be open above the final floor`)
        assert.ok(result.voxels.some((v) => v.tag === 'tower-crown-ring'))
        assert.ok(result.voxels.some((v) => v.tag === 'tower-crown-corbel'))
        assert.ok(result.voxels.some((v) => v.tag === 'crenel'))
        for (const v of result.voxels.filter((voxel) => voxel.tag === 'tower-crown-ring')) {
            assert.equal(cells.has(`${v.x},${v.y - 1},${v.z}`), true, `${style} crown ring should be tied into the wall at ${v.x},${v.y},${v.z}`)
        }
    }
})

test('tower crown follows the tapered top radius without a horizontal gap', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 36,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { style: 'round', radius: 10, height: 36, wallThickness: 2, spire: false, taper: 0.1 },
    }, DEFAULT_PALETTE)

    const topWallRadius = 9
    const maxExpectedCrownRadiusSq = (topWallRadius + 1) * (topWallRadius + 1)
    for (const v of result.voxels.filter((voxel) => voxel.tag === 'tower-crown-ring' || voxel.tag === 'tower-crown-corbel')) {
        assert.ok(v.x * v.x + v.z * v.z <= maxExpectedCrownRadiusSq, `tapered crown overhangs the top wall at ${v.x},${v.y},${v.z}`)
    }
})

test('tower windows are carved as open holes on each side', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 34,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { style: 'round', radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0, windowEvery: 8 },
    }, DEFAULT_PALETTE)
    const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))

    assert.ok(result.voxels.some((v) => v.tag === 'tower-window-trim'))
    assert.equal(result.voxels.some((v) => v.tag === 'arrow-slit'), false)
    for (const [dx, dz] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
        const x = dx * 8
        const z = dz * 8
        for (let y = 16; y <= 18; y++) {
            for (let d = 0; d <= 2; d++) {
                assert.equal(cells.has(`${x - dx * d},${y},${z - dz * d}`), false, `blocked tower window at ${x - dx * d},${y},${z - dz * d}`)
            }
        }
    }
})

test('tower entry is an open passage with unblocked approach', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 31,
        variants: 1,
        variation: 0,
        showTerrain: true,
        terrainSize: 32,
        tower: { style: 'round', radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0 },
    }, DEFAULT_PALETTE)
    const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))

    assert.equal(result.voxels.some((v) => v.tag === 'tower-door'), false)
    assert.ok(result.voxels.some((v) => v.tag === 'tower-entry-threshold'))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-entry-lower-step'))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-entry-upper-step'))

    for (let z = -9; z <= -5; z++) {
        for (let x = -1; x <= 1; x++) {
            for (let y = 2; y <= 6; y++) {
                assert.equal(cells.has(`${x},${y},${z}`), false, `blocked tower entry at ${x},${y},${z}`)
            }
        }
    }
    assert.equal(result.voxels.some((v) => v.tag === 'tower-buttress' && Math.abs(v.x) <= 2 && v.z <= -9), false)
})

test('tower exterior uses stairs and side landing instead of the old ladder', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 37,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { style: 'round', radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0 },
    }, DEFAULT_PALETTE)
    const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))

    assert.equal(result.voxels.some((v) => v.tag === 'external-ladder-rail' || v.tag === 'ladder-rung'), false)
    assert.ok(result.voxels.some((v) => v.tag === 'tower-outer-stair'))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-outer-landing'))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-outer-door-arch'))
    assert.equal(cells.has('8,7,0'), false, 'outer stair side doorway should be open')
    assert.equal(cells.has('10,7,0'), false, 'outer stair landing should have clear headroom')
})

test('tower shell starts on the build plane instead of floating above terrain', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 17,
        variants: 1,
        showTerrain: true,
        terrainSize: 32,
        tower: { style: 'round', radius: 7, height: 24, wallThickness: 2, spire: false },
    }, DEFAULT_PALETTE)

    assert.ok(result.voxels.some((v) => v.tag === 'terrain' && v.y === 0))
    assert.ok(result.voxels.some((v) => v.tag.startsWith('tower-wall') && v.y === 1))
})

test('tree cleanup leaves no isolated decorative leaf voxels', () => {
    const result = generateStructureScene({
        kind: 'tree',
        seed: 24,
        variants: 1,
        showTerrain: true,
        cleanLoose: true,
        tree: { style: 'oak', leafNoise: 1, fruitChance: 0.35 },
    }, DEFAULT_PALETTE)
    const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))
    const leafBlocks = new Set<number>([BLOCK.leaf, BLOCK.leafDark, BLOCK.leafLight, BLOCK.deepLeaf])

    for (const v of result.voxels) {
        if (!leafBlocks.has(v.block)) continue
        const neighbors = [
            `${v.x + 1},${v.y},${v.z}`,
            `${v.x - 1},${v.y},${v.z}`,
            `${v.x},${v.y + 1},${v.z}`,
            `${v.x},${v.y - 1},${v.z}`,
            `${v.x},${v.y},${v.z + 1}`,
            `${v.x},${v.y},${v.z - 1}`,
        ]
        assert.ok(neighbors.some((k) => cells.has(k)), `isolated leaf at ${v.x},${v.y},${v.z}`)
    }
})

test('structure palette entries append after existing stable block ids', () => {
    assert.equal(BLOCK.lava, 16)
    assert.equal(BLOCK.woodDark, 17)
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.woodDark]?.name, 'dark wood')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.fire]?.name, 'fire')
    assert.ok(paletteTileIndex(DEFAULT_PALETTE, BLOCK.roof) > 0)
    assert.ok(paletteTileIndex(DEFAULT_PALETTE, BLOCK.glass) > 0)
    assert.ok(paletteTileIndex(DEFAULT_PALETTE, BLOCK.metal) > 0)
})

test('old palettes receive missing structure materials without overwriting custom tail entries', () => {
    const oldPalette = clonePalette(DEFAULT_PALETTE)
    oldPalette.entries.length = BLOCK.woodDark
    oldPalette.entries.push({
        name: 'custom after lava',
        color: [0.1, 0.2, 0.3],
        solid: true,
    })

    const chunks = new ChunkManager(oldPalette)

    assert.equal(chunks.palette.entries[BLOCK.woodDark]?.name, 'custom after lava')
    assert.ok(chunks.palette.entries.some((entry) => entry.name === 'dark wood'))
    assert.ok(chunks.palette.entries.some((entry) => entry.name === 'fire'))
})

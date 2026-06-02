import test from 'node:test'
import assert from 'node:assert/strict'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE, clonePalette, isCollidable, paletteTileIndex, stepHeightForBlock, voxelHeightForBlock, voxelLightSpec } from '../src/engine/voxel/palette'
import {
    generateStructureScene,
    generateWallSegment,
    normalizeStructureOptions,
    towerWallSocket,
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
        kind: 'house',
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

test('small-folk house profile generates compact player-scale architecture', () => {
    const troll = generateStructureScene({
        kind: 'house',
        seed: 18,
        variants: 1,
        variation: 0,
        showTerrain: false,
        house: {
            scale: 'troll',
            style: 'cottage',
            roofStyle: 'gable',
            sideWing: false,
            porch: false,
            chimney: false,
        },
    }, DEFAULT_PALETTE)
    const folk = generateStructureScene({
        kind: 'house',
        seed: 18,
        variants: 1,
        variation: 0,
        showTerrain: false,
        house: {
            scale: 'folk',
            style: 'cottage',
            roofStyle: 'gable',
            sideWing: false,
            porch: true,
            chimney: false,
        },
    }, DEFAULT_PALETTE)

    assert.ok(folk.bounds.width < troll.bounds.width)
    assert.ok(folk.bounds.depth < troll.bounds.depth)
    assert.ok(folk.bounds.height < troll.bounds.height)
    assert.ok(folk.bounds.width <= 14)
    assert.ok(folk.bounds.depth <= 12)

    const door = folk.voxels.filter((v) => v.tag === 'house-door')
    assert.ok(door.length > 0)
    assert.equal(Math.max(...door.map((v) => v.y)) - Math.min(...door.map((v) => v.y)) + 1, 3)
    assert.equal(new Set(door.map((v) => v.x)).size, 2)

    assert.equal(folk.voxels.some((v) => v.tag.startsWith('porch-') || v.tag === 'door-path' || v.tag === 'garden-bed'), false)
    assert.equal(folk.voxels.some((v) => v.tag === 'house-plinth'), false)

    const glass = folk.voxels.filter((v) => v.tag === 'window-glass')
    assert.ok(glass.length >= 12)
    assert.ok(new Set(glass.map((v) => v.y)).size >= 2)
})

test('procedural landmark buildings generate distinct readable silhouettes', () => {
    const cases = [
        { kind: 'market' as const, tags: ['market-striped-canopy', 'market-counter', 'market-goods'] },
        { kind: 'stable' as const, tags: ['stable-thatch-roof', 'stable-stall-divider', 'stable-fence-rail'] },
        { kind: 'church' as const, tags: ['church-tower-wall', 'church-nave-roof', 'church-cross'] },
        { kind: 'temple' as const, tags: ['temple-column', 'temple-frieze-painted', 'temple-pediment-painted'] },
    ]

    for (const c of cases) {
        const result = generateStructureScene({
            kind: c.kind,
            seed: 91,
            variants: 1,
            detail: 0.85,
            variation: 0,
            showTerrain: false,
            cleanLoose: true,
            landmark: { scale: 'troll' },
        }, DEFAULT_PALETTE)

        assert.ok(result.voxels.length > 250, `${c.kind} should emit a substantial landmark`)
        assert.ok(result.bounds.width > 8, `${c.kind} should have meaningful width`)
        assert.ok(result.bounds.depth > 8, `${c.kind} should have meaningful depth`)
        assert.ok(result.bounds.height > 6, `${c.kind} should have meaningful height`)
        for (const tag of c.tags) assert.ok(result.voxels.some((v) => v.tag === tag), `${c.kind} missing ${tag}`)
    }
})

test('greek temple stays troll-scale and mixes marble with painted accents', () => {
    const troll = generateStructureScene({
        kind: 'temple',
        seed: 51,
        variants: 1,
        detail: 0.9,
        variation: 0,
        showTerrain: false,
        cleanLoose: true,
        landmark: { scale: 'troll' },
    }, DEFAULT_PALETTE)
    const folkRequest = generateStructureScene({
        kind: 'temple',
        seed: 51,
        variants: 1,
        detail: 0.9,
        variation: 0,
        showTerrain: false,
        cleanLoose: true,
        landmark: { scale: 'folk' },
    }, DEFAULT_PALETTE)

    assert.deepEqual(folkRequest.bounds, troll.bounds, 'temple ignores small-folk scale and remains troll-sized')
    assert.ok(troll.bounds.width >= 45)
    assert.ok(troll.bounds.depth >= 60)
    assert.ok(troll.bounds.height >= 22)
    assert.ok(troll.voxels.filter((v) => v.tag === 'temple-column').length > 260)
    assert.ok(troll.voxels.some((v) => v.tag === 'temple-cella-wall'))
    assert.ok(troll.voxels.some((v) => v.tag === 'temple-painted-roof'))
    assert.ok(troll.voxels.some((v) => v.tag === 'temple-altar-fire'))
    assert.ok((troll.materialCounts[BLOCK.plaster] ?? 0) > 900, 'marble/plaster should dominate the temple')
    assert.ok((troll.materialCounts[BLOCK.banner] ?? 0) > 80, 'painted red accents should be present')
    assert.ok((troll.materialCounts[BLOCK.roof] ?? 0) > 100, 'painted terracotta roof should be present')
})

test('small-folk landmark buildings stay smaller than troll-town variants', () => {
    for (const kind of ['market', 'stable', 'church'] as const) {
        const troll = generateStructureScene({
            kind,
            seed: 19,
            variants: 1,
            variation: 0,
            showTerrain: false,
            landmark: { scale: 'troll' },
        }, DEFAULT_PALETTE)
        const folk = generateStructureScene({
            kind,
            seed: 19,
            variants: 1,
            variation: 0,
            showTerrain: false,
            landmark: { scale: 'folk' },
        }, DEFAULT_PALETTE)

        assert.ok(folk.bounds.width < troll.bounds.width, `${kind} folk width should be smaller`)
        assert.ok(folk.bounds.depth < troll.bounds.depth, `${kind} folk depth should be smaller`)
        assert.ok(folk.bounds.height < troll.bounds.height, `${kind} folk height should be smaller`)
    }
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

test('small-folk tower profile uses compact floors and tighter spiral scale', () => {
    const troll = generateStructureScene({
        kind: 'tower',
        seed: 23,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { scale: 'troll', style: 'round', spire: false, taper: 0 },
    }, DEFAULT_PALETTE)
    const folk = generateStructureScene({
        kind: 'tower',
        seed: 23,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { scale: 'folk', style: 'round', spire: false, taper: 0 },
    }, DEFAULT_PALETTE)

    assert.ok(folk.bounds.width < troll.bounds.width)
    assert.ok(folk.bounds.height < troll.bounds.height)
    assert.ok(folk.bounds.width <= 13)
    assert.ok(folk.bounds.height <= 22)
    assert.ok(folk.voxels.some((v) => v.tag === 'tower-entry-threshold'))
    assert.ok(folk.voxels.some((v) => v.tag === 'tower-window-trim'))

    const treadYs = new Set(folk.voxels
        .filter((v) => v.tag === 'tower-spiral-step' || v.tag === 'tower-stair-landing' || v.tag === 'tower-top-landing')
        .map((v) => v.y))
    for (let y = 1; y <= 17; y++) assert.equal(treadYs.has(y), true, `missing small tower tread at y=${y}`)
    for (const step of folk.voxels.filter((v) => v.tag === 'tower-spiral-step')) {
        assert.ok(Math.max(Math.abs(step.x), Math.abs(step.z)) <= 2, `small spiral step too wide at ${step.x},${step.y},${step.z}`)
    }
})

test('lighthouse crown carries a working light beacon', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 9,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { style: 'lighthouse', radius: 8, height: 28, wallThickness: 2, spire: true },
    }, DEFAULT_PALETTE)

    const lamp = result.voxels.filter((v) => v.tag === 'lighthouse-lamp')
    assert.ok(lamp.length >= 2, 'lighthouse should have a glow lamp core')
    for (const v of lamp) {
        assert.equal(v.block, BLOCK.glow)
        assert.ok(voxelLightSpec(DEFAULT_PALETTE, v.block), 'lamp block must emit a point light')
    }
    // The flame still sits above the lamp, under the roof.
    const fire = result.voxels.filter((v) => v.tag === 'lighthouse-fire')
    assert.ok(fire.length > 0 && voxelLightSpec(DEFAULT_PALETTE, fire[0]!.block))
    const topLamp = Math.max(...lamp.map((v) => v.y))
    assert.ok(fire.every((v) => v.y > topLamp), 'flame crowns the lamp')
    // Glass gallery + metal frame around the light.
    assert.ok(result.voxels.some((v) => v.tag === 'lantern-glass'))
    assert.ok(result.voxels.some((v) => v.tag === 'lantern-sill' || v.tag === 'lantern-ring'))
})

test('tower interior has a stone ground floor and one clean deck per storey', () => {
    const result = generateStructureScene({
        kind: 'tower',
        seed: 21,
        variants: 1,
        variation: 0,
        showTerrain: false,
        tower: { style: 'round', radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0 },
    }, DEFAULT_PALETTE)
    const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))

    // A real ground floor so the player can walk from the entry to the stair.
    const ground = result.voxels.filter((v) => v.tag === 'tower-floor-ground')
    assert.ok(ground.length > 70)
    assert.equal(new Set(ground.map((v) => v.y)).size, 1, 'ground floor is a single slab at the base')

    // One timber deck per storey, including the top storey near the crown.
    for (const storeyY of [6, 12, 18, 24]) {
        const deck = result.voxels.filter((v) => v.tag === 'tower-floor-deck' && v.y === storeyY)
        assert.ok(deck.length > 30, `storey deck missing at y=${storeyY}`)
    }
    assert.ok(result.voxels.some((v) => v.tag === 'tower-floor-rim'))

    // Each storey deck is punched through where the spiral passes: the cell
    // directly above the tread that tucks under the deck must be open.
    const steps = result.voxels.filter((v) => v.tag === 'tower-spiral-step')
    const stepAt = new Map(steps.map((v) => [`${v.x},${v.y},${v.z}`, v]))
    let punched = 0
    for (const storeyY of [6, 12, 18, 24]) {
        for (const v of steps) {
            if (v.y !== storeyY - 1) continue
            if (stepAt.has(`${v.x},${storeyY},${v.z}`)) continue // it became a landing, not a hole
            if (!cells.has(`${v.x},${storeyY},${v.z}`)) punched++
        }
    }
    assert.ok(punched >= 4, 'stairwell should be open through every storey deck')
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

    // Every rung of the climb is present: a spiral step or a storey/top landing
    // at every level from the first step to the crown.
    const treadYs = new Set(result.voxels
        .filter((v) => v.tag === 'tower-spiral-step' || v.tag === 'tower-stair-landing' || v.tag === 'tower-top-landing')
        .map((v) => v.y))
    for (let y = 1; y <= 27; y++) assert.equal(treadYs.has(y), true, `missing tread at y=${y}`)

    assert.ok(result.voxels.some((v) => v.tag === 'tower-stair-landing' && v.y === 6))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-stair-landing' && v.y === 12))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-stair-landing' && v.y === 24))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-top-landing' && v.y === 27))
    assert.ok(result.voxels.some((v) => v.tag === 'tower-spiral-pillar'))

    const steps = result.voxels.filter((v) => v.tag === 'tower-spiral-step')
    for (const step of steps) assert.ok(Math.max(Math.abs(step.x), Math.abs(step.z)) <= 3, `spiral step too wide at ${step.x},${step.y},${step.z}`)
})

test('tower spiral is climbable end-to-end with the player 1-voxel step-up', () => {
    // Reachability proof: model the player as feet-on-a-solid-block with two
    // clear cells of body above, walking the 4-neighbourhood with the engine's
    // free 1-voxel step-up (and any drop). The crown must be reachable from the
    // ground floor — this is the regression guard for the old, unclimbable spiral.
    for (const style of ['round', 'square', 'lighthouse'] as const) {
        const result = generateStructureScene({
            kind: 'tower',
            seed: 22,
            variants: 1,
            variation: 0,
            showTerrain: false,
            tower: { style, radius: 8, height: 28, wallThickness: 2, spire: false, taper: 0 },
        }, DEFAULT_PALETTE)

        const solid = new Set(result.voxels
            .filter((v) => isCollidable(DEFAULT_PALETTE, v.block))
            .map((v) => `${v.x},${v.y},${v.z}`))
        const S = (x: number, y: number, z: number): boolean => solid.has(`${x},${y},${z}`)
        const air = (x: number, y: number, z: number): boolean => !S(x, y, z)
        const stance = (x: number, y: number, z: number): boolean => S(x, y - 1, z) && air(x, y, z) && air(x, y + 1, z)

        const seen = new Set<string>()
        const queue: Array<[number, number, number]> = []
        const add = (x: number, y: number, z: number): void => {
            if (!stance(x, y, z)) return
            const k = `${x},${y},${z}`
            if (seen.has(k)) return
            seen.add(k)
            queue.push([x, y, z])
        }
        for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) add(x, 1, z)

        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
        for (let head = 0; head < queue.length; head++) {
            const [x, y, z] = queue[head]!
            for (const [dx, dz] of dirs) {
                const nx = x + dx
                const nz = z + dz
                if (air(x, y + 1, z)) add(nx, y + 1, nz) // step up one
                add(nx, y, nz) // walk level
                for (let yy = y - 1; yy >= 0; yy--) { if (S(nx, yy - 1, nz)) { add(nx, yy, nz); break } } // drop
            }
        }

        let top = -Infinity
        for (const k of seen) top = Math.max(top, Number(k.split(',')[1]))
        assert.ok(top >= 27, `${style} tower crown unreachable — climb stalled at y=${top}`)
    }
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

test('wall generator creates a continuous gated curtain between endpoints', () => {
    const result = generateWallSegment({
        path: [{ x: 0, y: 2, z: 0 }, { x: 14, y: 2, z: 0 }],
        seed: 41,
        params: {
            scale: 'troll',
            style: 'curtain',
            height: 6,
            thickness: 3,
            foundationDepth: 1,
            battlements: true,
            walkway: true,
            gate: 'center',
        },
    }, DEFAULT_PALETTE)
    const cells = new Set(result.voxels.map((v) => `${v.x},${v.y},${v.z}`))

    assert.ok(result.voxels.some((v) => v.tag === 'wall-foundation'))
    assert.ok(result.voxels.some((v) => v.tag === 'wall-crenel'))
    assert.ok(result.voxels.some((v) => v.tag === 'wall-gate-lintel'))
    assert.equal(result.bounds.minY, 2, 'wall footprint starts at the requested editing level')
    assert.equal(result.bounds.width, 15)
    assert.equal(result.bounds.depth, 3)
    for (let x = 0; x <= 14; x++) {
        if (x >= 6 && x <= 8) continue
        assert.equal(cells.has(`${x},2,0`), true, `wall body missing at x=${x}`)
    }
    for (let x = 6; x <= 8; x++) {
        for (let y = 2; y <= 5; y++) {
            assert.equal(cells.has(`${x},${y},0`), false, `gate opening blocked at x=${x}, y=${y}`)
        }
    }
})

test('wall generator supports free point-to-point diagonal spans deterministically', () => {
    const input = {
        path: [{ x: -3, y: 1, z: 4 }, { x: 6, y: 1, z: 10 }],
        seed: 77,
        params: { style: 'stone' as const, height: 5, thickness: 2, battlements: false },
    }
    const a = generateWallSegment(input, DEFAULT_PALETTE)
    const b = generateWallSegment(input, DEFAULT_PALETTE)

    assert.equal(signature(a.voxels), signature(b.voxels))
    assert.ok(a.voxels.some((v) => v.x === -3 && v.z === 4))
    assert.ok(a.voxels.some((v) => v.x === 6 && v.z === 10))
    assert.ok(a.bounds.width >= 10)
    assert.ok(a.bounds.depth >= 7)
})

test('tower wall socket snaps to the tower side facing the target point', () => {
    assert.deepEqual(towerWallSocket({
        center: { x: 10, y: 5, z: 10 },
        radius: 4,
        toward: { x: 30, z: 12 },
    }), { x: 14, y: 5, z: 10 })
    assert.deepEqual(towerWallSocket({
        center: { x: 10, y: 5, z: 10 },
        radius: 4,
        toward: { x: 8, z: -20 },
    }), { x: 10, y: 5, z: 6 })
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
    const leafBlocks = new Set<number>([
        BLOCK.leaf,
        BLOCK.leafDark,
        BLOCK.leafLight,
        BLOCK.deepLeaf,
        BLOCK.autumnLeaf,
        BLOCK.autumnLeafDark,
        BLOCK.autumnLeafLight,
    ])

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

test('autumn tree season uses autumn leaf materials', () => {
    const summer = generateStructureScene({
        kind: 'tree',
        seed: 31,
        variants: 1,
        showTerrain: false,
        tree: { style: 'oak', season: 'summer' },
    }, DEFAULT_PALETTE)
    const autumn = generateStructureScene({
        kind: 'tree',
        seed: 31,
        variants: 1,
        showTerrain: false,
        tree: { style: 'oak', season: 'autumn' },
    }, DEFAULT_PALETTE)

    assert.equal(summer.voxels.some((v) => v.block === BLOCK.autumnLeaf || v.block === BLOCK.autumnLeafLight || v.block === BLOCK.autumnLeafDark), false)
    assert.equal(autumn.voxels.some((v) => v.block === BLOCK.autumnLeaf || v.block === BLOCK.autumnLeafLight || v.block === BLOCK.autumnLeafDark), true)
})

test('structure palette entries append after existing stable block ids', () => {
    assert.equal(BLOCK.lava, 16)
    assert.equal(BLOCK.woodDark, 17)
    assert.equal(BLOCK.rail, 41)
    assert.equal(BLOCK.autumnLeaf, 42)
    assert.equal(BLOCK.fence, 45)
    assert.equal(BLOCK.stairs, 46)
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.woodDark]?.name, 'dark wood')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.fire]?.name, 'fire')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.autumnLeaf]?.name, 'autumn leaf')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.fence]?.name, 'fence')
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.stairs]?.name, 'stairs')
    assert.equal(voxelHeightForBlock(DEFAULT_PALETTE, BLOCK.stairs), 0.5)
    assert.equal(stepHeightForBlock(DEFAULT_PALETTE, BLOCK.stairs), 0.5)
    assert.ok(paletteTileIndex(DEFAULT_PALETTE, BLOCK.roof) > 0)
    assert.ok(paletteTileIndex(DEFAULT_PALETTE, BLOCK.glass) > 0)
    assert.ok(paletteTileIndex(DEFAULT_PALETTE, BLOCK.metal) > 0)
    assert.ok(paletteTileIndex(DEFAULT_PALETTE, BLOCK.stairs) > 0)
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
    assert.ok(chunks.palette.entries.some((entry) => entry.name === 'stairs' && entry.height === 0.5 && entry.stepHeight === 0.5))
})

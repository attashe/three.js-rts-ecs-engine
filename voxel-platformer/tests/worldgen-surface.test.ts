import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK } from '../src/engine/voxel/palette'
import { deserializeLevel, serializeLevel } from '../src/engine/voxel/level-serializer'
import { compileSurfaceWorld, compileWorldSpec, normalizeWorldSpec } from '../src/game/worldgen'
import type { WorldSpec } from '../src/game/worldgen'
import type { LevelMeta } from '../src/game/level'

const SURFACE_VALLEY_SPEC: WorldSpec = {
    version: 1,
    world: {
        id: 'moss_gate_valley',
        name: 'Moss Gate Valley',
        type: 'surface',
        seed: 'demo/world-001',
        size: [64, 32, 64],
    },
    terrain: {
        base_height: 8,
        noise: { amplitude: 4, scale: 18, octaves: 3 },
        features: [
            {
                id: 'north_cliff',
                type: 'cliff_band',
                from: [4, 17],
                to: [60, 15],
                height: 9,
                width: 6,
                face: 'south',
                material: 'stone',
            },
            {
                id: 'pilgrim_road',
                type: 'road_spline',
                points: [[6, 52], [19, 45], [32, 38], [45, 31], [55, 24]],
                width: 2,
                shoulder: 2,
                material: 'path',
            },
        ],
    },
    anchors: [
        {
            id: 'spawn',
            place_at_xz: [6, 52],
            auto_y: true,
            reserve: [3, 4, 3],
        },
        {
            id: 'portal_plaza',
            place_at_xz: [55, 24],
            auto_y: true,
            reserve: [13, 8, 13],
            terrain_patch: { type: 'flatten_disc', radius: 7, material: 'platform' },
        },
    ],
    structures: [
        {
            id: 'blue_portal',
            asset: 'fixed.portal.blue_stone',
            place_at: 'portal_plaza',
            required: true,
        },
        {
            id: 'hermit_house',
            asset: 'proc.house.hermit_cottage',
            place_at_xz: [29, 37],
            auto_y: {
                strategy: 'surface_max',
                terraform: 'flatten_footprint',
                material: 'platform',
                max_terrain_delta: 4,
            },
            required: true,
        },
    ],
    scatter: [
        {
            id: 'old_pines',
            asset: 'proc.tree.pine',
            count: 42,
            mask: {
                min_distance_to_road: 5,
                avoid_reserved: true,
            },
            deterministic_grid: {
                cell: 6,
                jitter: 2,
            },
        },
    ],
    validation: {
        require_paths: [
            { from: 'spawn', to: 'blue_portal', actor: 'player_basic' },
            { from: 'spawn', to: 'hermit_house', actor: 'player_basic' },
        ],
    },
}

test('surface valley compiles with anchors, structures, scatter, and path validation', () => {
    const normalized = normalizeWorldSpec(SURFACE_VALLEY_SPEC)
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return

    const result = compileSurfaceWorld(normalized.spec)
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors))
    assert.equal(result.meta.name, 'Moss Gate Valley')
    assert.equal(result.meta.size, 64)
    assert.ok(result.chunks.chunkCount() > 0)
    assert.ok(result.report.worldHash)
    assert.deepEqual(result.meta.spawn, result.report.resolvedAnchors.spawn)
    assert.ok(result.report.resolvedAnchors.portal_plaza)
    assert.ok(result.report.resolvedObjects.blue_portal)
    assert.ok(result.report.resolvedObjects.hermit_house)
    assert.ok(result.report.placements.some((placement) => placement.id === 'blue_portal' && placement.kind === 'structure'))
    assert.ok(result.report.placements.some((placement) => placement.id === 'hermit_house' && placement.kind === 'structure'))
    const scatter = result.report.placements.find((placement) => placement.id === 'old_pines' && placement.kind === 'scatter_summary')
    assert.equal(scatter?.requested, 42)
    assert.equal(scatter?.placed, 42)
    assert.equal(result.report.validation.length, 2)
    assert.ok(result.report.validation.every((entry) => entry.ok))
    assert.equal(result.meta.zones.length, 1)
    assert.equal(result.meta.zones[0]?.active, false)
})

test('surface compilation is deterministic across chunks, metadata, and reports', () => {
    const normalized = normalizeWorldSpec(SURFACE_VALLEY_SPEC)
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return

    const a = compileSurfaceWorld(normalized.spec)
    const b = compileSurfaceWorld(normalized.spec)
    const aBuffer = serializeLevel(a.chunks, a.meta)
    const bBuffer = serializeLevel(b.chunks, b.meta)

    assert.equal(a.report.status, 'ok')
    assert.equal(b.report.status, 'ok')
    assert.equal(a.report.specHash, b.report.specHash)
    assert.equal(a.report.worldHash, b.report.worldHash)
    assert.deepEqual(a.report.resolvedAnchors, b.report.resolvedAnchors)
    assert.deepEqual(a.report.resolvedObjects, b.report.resolvedObjects)
    assert.deepEqual(a.report.validation, b.report.validation)
    assert.ok(Buffer.from(aBuffer).equals(Buffer.from(bBuffer)))

    const restored = deserializeLevel<LevelMeta>(aBuffer)
    assert.equal(restored.metadata.name, a.meta.name)
    assert.deepEqual(restored.metadata.spawn, a.meta.spawn)
    assert.ok(restored.chunks.chunkCount() > 0)
})

test('surface compiler builds rectangular (non-square) worlds', () => {
    const spec = {
        version: 1 as const,
        world: { id: 'rect_vale', name: 'Rect Vale', type: 'surface' as const, seed: 'rect-vale', size: [48, 32, 80] as [number, number, number] },
        terrain: { base_height: 6 },
        anchors: [
            { id: 'spawn', place_at_xz: [6, 6] as [number, number] },
            { id: 'far', place_at_xz: [40, 72] as [number, number] },
        ],
        validation: { require_paths: [{ id: 'spawn_to_far', from: 'spawn', to: 'far' }] },
    }

    const result = compileWorldSpec(spec)
    assert.notEqual(result.report.status, 'failed', JSON.stringify(result.report.errors))
    assert.equal(result.meta.sizeX, 48)
    assert.equal(result.meta.sizeZ, 80)
    assert.equal(result.meta.size, 80) // scalar = max(sizeX, sizeZ)
    assert.ok(result.chunks.chunkCount() > 0)
    assert.ok(result.report.resolvedAnchors.spawn, 'spawn anchor resolves')
    assert.ok(result.report.resolvedAnchors.far, 'far anchor resolves inside the long Z axis')
    assert.equal(result.report.validation[0]?.ok, true, 'path validates across the rectangle')

    // Deterministic for the same spec.
    assert.equal(compileWorldSpec(spec).report.worldHash, result.report.worldHash)
})

test('surface compiler reports unsupported feature types', () => {
    const unsupportedFeature = normalizeWorldSpec({
        ...SURFACE_VALLEY_SPEC,
        terrain: {
            features: [{ id: 'fog-ring', type: 'fog_ring' }],
        },
        structures: [],
        scatter: [],
        validation: undefined,
    })
    assert.equal(unsupportedFeature.ok, true)
    if (unsupportedFeature.ok) {
        const result = compileSurfaceWorld(unsupportedFeature.spec)
        assert.equal(result.report.status, 'failed')
        assert.ok(result.report.errors.some((error) => error.code === 'unsupported_feature'))
    }
})

test('surface features alter terrain deterministically', () => {
    const spec: WorldSpec = {
        version: 1,
        world: {
            id: 'feature.surface',
            name: 'Feature Surface',
            type: 'surface',
            seed: 'feature-seed',
            size: [40, 32, 40],
        },
        terrain: {
            base_height: 6,
            features: [
                { id: 'peak', type: 'mountain_peak', center: [20, 20], radius: 10, height: 8, material: 'stone' },
                { id: 'disc', type: 'flatten_disc', center: [8, 8], radius: 4, height: 7, material: 'platform' },
                { id: 'road', type: 'road_spline', points: [[2, 30], [34, 30]], width: 1, shoulder: 1, material: 'path' },
            ],
        },
        anchors: [{ id: 'spawn', place_at_xz: [2, 2], auto_y: true }],
    }
    const normalized = normalizeWorldSpec(spec)
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return

    const result = compileSurfaceWorld(normalized.spec)
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors))
    assert.ok(topYAt(result, 20, 20) > topYAt(result, 2, 2), 'mountain peak should raise the center')
    assert.equal(topYAt(result, 8, 8), 7, 'flatten disc should set the target height')
    assert.equal(topBlockAt(result, 18, 30), BLOCK.sand, 'road material should use path alias')
})

test('missing validation references and optional placement skips are reported clearly', () => {
    const missingReference = normalizeWorldSpec({
        ...SURFACE_VALLEY_SPEC,
        structures: [],
        scatter: [],
        validation: { require_paths: [{ from: 'spawn', to: 'missing_object' }] },
    })
    assert.equal(missingReference.ok, true)
    if (missingReference.ok) {
        const result = compileSurfaceWorld(missingReference.spec)
        assert.equal(result.report.status, 'failed')
        assert.ok(result.report.errors.some((error) => error.code === 'missing_reference'))
        assert.equal(result.report.validation[0]?.ok, false)
    }

    const optionalStructure = normalizeWorldSpec({
        ...SURFACE_VALLEY_SPEC,
        structures: [
            {
                id: 'optional_unknown',
                asset: 'proc.unknown',
                place_at_xz: [20, 20],
                required: false,
            },
        ],
        scatter: [],
        validation: undefined,
    })
    assert.equal(optionalStructure.ok, true)
    if (optionalStructure.ok) {
        const result = compileSurfaceWorld(optionalStructure.spec)
        assert.equal(result.report.status, 'warning')
        assert.ok(result.report.warnings.some((warning) => warning.code === 'unsupported_structure_asset'))
    }
})

test('phase 4 registry resolves general prefabs, procedural structures, and recovered props', () => {
    const spec: WorldSpec = {
        version: 1,
        world: {
            id: 'phase4.registry',
            name: 'Phase 4 Registry',
            type: 'surface',
            seed: 'phase4-registry',
            size: [80, 40, 80],
        },
        terrain: { base_height: 6 },
        anchors: [{ id: 'spawn', place_at_xz: [6, 6], reserve: [3, 4, 3] }],
        structures: [
            {
                id: 'dwarf_market',
                asset: 'prefab.dwarf-product-market',
                place_at_xz: [18, 18],
                rotation: 90,
                auto_y: { strategy: 'surface_max', terraform: 'flatten_footprint', material: 'platform' },
                required: true,
            },
            {
                id: 'lookout_tower',
                asset: 'proc.tower.round',
                place_at_xz: [52, 18],
                auto_y: { strategy: 'surface_max', terraform: 'flatten_footprint', material: 'platform' },
                params: { tower: { radius: 3, height: 9, spire: false } },
                required: true,
            },
        ],
    }
    const normalized = normalizeWorldSpec(spec)
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return

    const result = compileSurfaceWorld(normalized.spec)
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors))
    const market = result.report.placements.find((placement) => placement.id === 'dwarf_market' && placement.kind === 'structure')
    assert.equal(market?.assetKind, 'shop')
    assert.equal(market?.sourceKind, 'prefab')
    assert.ok(Number(market?.propCount) > 0)
    assert.ok(result.meta.props.some((prop) => prop.id.startsWith('worldgen:dwarf_market:') && prop.kind === 'market-meat'))

    const tower = result.report.placements.find((placement) => placement.id === 'lookout_tower' && placement.kind === 'structure')
    assert.equal(tower?.assetKind, 'tower')
    assert.equal(tower?.sourceKind, 'procedural')
    assert.ok(result.report.resolvedObjects.lookout_tower)
})

test('phase 4 structure groups place rotated child structures with stable object ids', () => {
    const spec: WorldSpec = {
        version: 1,
        world: {
            id: 'phase4.group',
            name: 'Phase 4 Group',
            type: 'surface',
            seed: 'phase4-group',
            size: [64, 32, 64],
        },
        terrain: { base_height: 6 },
        anchors: [{ id: 'spawn', place_at_xz: [6, 6], reserve: [3, 4, 3] }],
        structures: [
            {
                id: 'village_core',
                type: 'group',
                place_at_xz: [34, 34],
                rotation: 90,
                auto_y: { strategy: 'surface_max', terraform: 'flatten_footprint', material: 'platform' },
                items: [
                    { id: 'well', asset: 'prefab.well', offset_xz: [0, 0] },
                    { id: 'camp', asset: 'prefab.campfire', offset_xz: [8, 0], rotation: 270 },
                ],
            },
        ],
    }
    const normalized = normalizeWorldSpec(spec)
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return

    const result = compileSurfaceWorld(normalized.spec)
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors))
    assert.ok(result.report.resolvedObjects.village_core)
    assert.ok(result.report.resolvedObjects['village_core.well'])
    assert.ok(result.report.resolvedObjects['village_core.camp'])
    const group = result.report.placements.find((placement) => placement.id === 'village_core' && placement.kind === 'structure_group')
    assert.equal(group?.childCount, 2)
    assert.equal(group?.placed, 2)
    const camp = result.report.placements.find((placement) => placement.id === 'village_core.camp' && placement.kind === 'structure')
    assert.equal(camp?.z, 26)
})

test('phase 4 weighted scatter supports rotations and skip reason reporting', () => {
    const spec: WorldSpec = {
        version: 1,
        world: {
            id: 'phase4.scatter',
            name: 'Phase 4 Scatter',
            type: 'surface',
            seed: 'phase4-scatter',
            size: [48, 32, 48],
        },
        terrain: {
            base_height: 6,
            features: [
                { id: 'road', type: 'road_spline', points: [[4, 20], [44, 20]], width: 1, shoulder: 1, material: 'path' },
            ],
        },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4], reserve: [7, 4, 7] }],
        scatter: [
            {
                id: 'mixed_scatter',
                count: 6,
                assets: [
                    { asset: 'prefab.compact-pine', weight: 2 },
                    { asset: 'prefab.campfire', weight: 1 },
                ],
                rotations: [0, 90, 180, 270],
                mask: { avoid_reserved: true },
                deterministic_grid: { cell: 8, jitter: 0 },
            },
            {
                id: 'too_high',
                asset: 'prefab.compact-pine',
                count: 3,
                mask: { elevation_gte: 99 },
                deterministic_grid: { cell: 8, jitter: 0 },
            },
        ],
    }
    const normalized = normalizeWorldSpec(spec)
    assert.equal(normalized.ok, true)
    if (!normalized.ok) return

    const result = compileSurfaceWorld(normalized.spec)
    assert.equal(result.report.status, 'warning')
    const mixed = result.report.placements.find((placement) => placement.id === 'mixed_scatter' && placement.kind === 'scatter_summary')
    assert.equal(mixed?.requested, 6)
    assert.equal(mixed?.placed, 6)
    assert.ok(Number(mixed?.candidates) > 0)
    const placed = result.report.placements.filter((placement) => typeof placement.id === 'string' && placement.id.startsWith('mixed_scatter_'))
    assert.equal(placed.length, 6)
    assert.ok(placed.every((placement) => [0, 90, 180, 270].includes(Number(placement.rotation))))
    assert.ok(placed.every((placement) => placement.assetId === 'prefab.compact-pine' || placement.assetId === 'prefab.campfire'))

    const high = result.report.placements.find((placement) => placement.id === 'too_high' && placement.kind === 'scatter_summary')
    assert.equal(high?.placed, 0)
    assert.ok(Number((high?.skippedByReason as Record<string, unknown> | undefined)?.elevation) > 0)
    assert.ok(result.report.warnings.some((warning) => warning.code === 'placement_failed' && warning.message.includes('too_high')))
})

function topYAt(result: ReturnType<typeof compileSurfaceWorld>, x: number, z: number): number {
    for (let y = result.report.metrics.size?.[1] ?? 64; y >= 0; y -= 1) {
        if (result.chunks.getVoxel(x, y, z) !== BLOCK.air) return y
    }
    return -1
}

function topBlockAt(result: ReturnType<typeof compileSurfaceWorld>, x: number, z: number): number {
    const y = topYAt(result, x, z)
    return y >= 0 ? result.chunks.getVoxel(x, y, z) : BLOCK.air
}

function diagnosticSummary(errors: readonly { code: string; message: string }[]): string {
    return errors.map((error) => `${error.code}: ${error.message}`).join('\n')
}

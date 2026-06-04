import test from 'node:test'
import assert from 'node:assert/strict'
import { compileWorldSpec } from '../src/game/worldgen'
import type { WorldSpec } from '../src/game/worldgen'

const CONTENT_SURFACE_SPEC: WorldSpec = {
    version: 1,
    world: {
        id: 'content_surface',
        name: 'Content Surface',
        type: 'surface',
        seed: 'content-surface-seed',
        size: [40, 32, 40],
        defaultGroundY: 6,
    },
    terrain: { base_height: 6 },
    anchors: [
        { id: 'spawn', place_at_xz: [5, 5], reserve: [3, 3, 3] },
    ],
    content: {
        props: [
            { id: 'road_sign_prop', kind: 'road-sign', place_at: 'spawn', offset_xz: [2, 0], yaw: 0.5, scale: 1.2 },
        ],
        zones: [
            { id: 'road_sign_zone', type: 'interact', label: 'Road Sign', place_at: 'road_sign_prop', half_xz: [1, 1], prompt: 'Read', radius: 2.5 },
            { id: 'exit_portal', type: 'portal', place_at_xz: [20, 20], targetLevelId: 'next-level', targetArrivalId: 'arrival.edge', active: false },
        ],
        npcs: [
            {
                id: 'gate_guard',
                template: 'guard',
                name: 'Gate Guard',
                place_at: 'spawn',
                offset_xz: [4, 0],
                behaviour: { mode: 'guard', hostileToPlayer: true, perceptionRadius: 6 },
            },
        ],
        scripts: [
            { id: 'intro_script', name: 'intro.js', source: "on('level-start', () => log('ready'))" },
        ],
    },
    validation: {
        require_paths: [
            { id: 'spawn_to_sign', from: 'spawn', to: 'road_sign_prop', actor: 'player_basic' },
        ],
    },
}

test('compileWorldSpec dispatches surface specs and compiles MVP content into LevelMeta', () => {
    const result = compileWorldSpec(CONTENT_SURFACE_SPEC)

    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors))
    assert.ok(result.report.worldHash)
    assert.equal(result.meta.name, 'Content Surface')
    assert.equal(result.meta.props.length, 1)
    assert.equal(result.meta.props[0]?.id, 'road_sign_prop')
    assert.equal(result.meta.props[0]?.kind, 'road-sign')
    assert.equal(result.meta.zones.length, 2)
    assert.equal(result.meta.npcs.length, 1)
    assert.equal(result.meta.scripts.length, 1)
    assert.equal(result.report.metrics.npcCount, 1)
    assert.equal(result.report.metrics.zoneCount, 2)
    assert.equal(result.report.metrics.scriptCount, 1)
    assert.equal(result.report.metrics.regionSizeChunks, 8)
    assert.equal(result.report.metrics.regionCount, 1)
    assert.equal(result.report.metrics.regions.length, 1)
    assert.deepEqual(result.report.metrics.chunkBounds?.min, { x: 0, y: 0, z: 0 })
    assert.deepEqual(result.report.metrics.chunkBounds?.max, { x: 1, y: 0, z: 1 })
    assert.ok(result.report.resolvedObjects.road_sign_prop)
    assert.ok(result.report.resolvedObjects.road_sign_zone)
    assert.ok(result.report.resolvedObjects.gate_guard)
    assert.equal(result.report.validation[0]?.ok, true)

    const interact = result.meta.zones.find((zone) => zone.id === 'road_sign_zone')
    assert.equal(interact?.kind, 'interact')
    assert.equal(interact?.interaction?.prompt, 'Read')
    const portal = result.meta.zones.find((zone) => zone.id === 'exit_portal')
    assert.equal(portal?.kind, 'portal')
    assert.equal(portal?.active, false)
    assert.equal(portal?.portal?.targetLevelId, 'next-level')
    assert.equal(portal?.portal?.targetArrivalId, 'arrival.edge')
    const guard = result.meta.npcs[0]
    assert.equal(guard?.model, 'shield-warrior')
    assert.ok(guard?.scriptSource.includes("npc.setHostile(NPC_ID, 'player', true)"))
    assert.equal(result.meta.scripts[0]?.name, 'intro.js')
})

test('compileWorldSpec reports unsupported hybrid world types explicitly', () => {
    const result = compileWorldSpec({
        version: 1,
        world: {
            id: 'hybrid_soon',
            name: 'Hybrid Soon',
            type: 'hybrid',
            seed: 'hybrid-soon',
            size: [32, 32, 32],
        },
    })

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) => error.code === 'unsupported_world_type'))
    assert.equal(result.meta.name, 'Hybrid Soon')
})

test('compileWorldSpec reports resident-budget warnings for large generated footprints', () => {
    const result = compileWorldSpec({
        version: 1,
        world: {
            id: 'large_region_report',
            name: 'Large Region Report',
            type: 'surface',
            seed: 'large-region-report',
            size: [320, 24, 320],
            defaultGroundY: 5,
        },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [8, 304] }],
    })

    assert.equal(result.report.status, 'warning', diagnosticSummary(result.report.errors))
    assert.equal(result.report.metrics.chunkCount, 100)
    assert.equal(result.report.metrics.regionCount, 4)
    assert.equal(result.report.metrics.regions.length, 4)
    assert.ok(result.report.metrics.writtenVoxels > 0)
    assert.ok(result.report.warnings.some((warning) => warning.code === 'resident_world_budget'))

    const again = compileWorldSpec({
        version: 1,
        world: {
            id: 'large_region_report',
            name: 'Large Region Report',
            type: 'surface',
            seed: 'large-region-report',
            size: [320, 24, 320],
            defaultGroundY: 5,
        },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [8, 304] }],
    })
    assert.deepEqual(result.report.metrics.chunkBounds, again.report.metrics.chunkBounds)
    assert.deepEqual(result.report.metrics.regions, again.report.metrics.regions)
})

test('compileWorldSpec rejects incomplete portal content without emitting a broken zone', () => {
    const result = compileWorldSpec({
        ...CONTENT_SURFACE_SPEC,
        content: {
            zones: [
                { id: 'bad_portal', type: 'portal', place_at: 'spawn' },
            ],
        },
        validation: undefined,
    })

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) => error.path === '$.content.zones[0].targetLevelId'))
    assert.equal(result.meta.zones.some((zone) => zone.id === 'bad_portal'), false)
})

test('compileWorldSpec returns normalization failures with an inert fallback level', () => {
    const result = compileWorldSpec({
        version: 1,
        world: {
            id: '',
            name: 'Bad Spec',
            type: 'surface',
            seed: 'bad',
            size: [32, 32, 32],
        },
    } as WorldSpec)

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) => error.code === 'missing_world_field'))
    assert.equal(result.meta.name, 'Invalid WorldSpec')
    assert.equal(result.meta.size, 1)
})

test('compileWorldSpec rejects an unknown zone kind and emits no zone', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'zk', name: 'ZoneKind', type: 'surface', seed: 'zk-seed', size: [32, 32, 32] },
        anchors: [{ id: 'spawn', place_at_xz: [8, 8] }],
        content: { zones: [{ id: 'weird_zone', type: 'forcefield', place_at: 'spawn' }] },
    })

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) =>
        error.path === '$.content.zones[0].type' && /unknown zone kind/.test(error.message)))
    assert.equal(result.meta.zones.some((zone) => zone.id === 'weird_zone'), false)
})

test('compileWorldSpec warns and skips an optional zone with an unknown kind', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'zk2', name: 'ZoneKind2', type: 'surface', seed: 'zk2-seed', size: [32, 32, 32] },
        anchors: [{ id: 'spawn', place_at_xz: [8, 8] }],
        content: { zones: [{ id: 'weird_zone', type: 'forcefield', place_at: 'spawn', required: false }] },
    })

    assert.notEqual(result.report.status, 'failed')
    assert.ok(result.report.warnings.some((warning) => warning.path === '$.content.zones[0].type'))
    assert.equal(result.meta.zones.length, 0)
})

test('compileWorldSpec warns when surface features are clamped at the world ceiling', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'tall_peak', name: 'Tall Peak', type: 'surface', seed: 'tall-peak', size: [48, 16, 48] },
        terrain: {
            base_height: 6,
            features: [{ id: 'peak', type: 'mountain_peak', center_xz: [24, 24], radius: 16, height: 24 }],
        },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
    })

    assert.notEqual(result.report.status, 'failed')
    const clamp = result.report.warnings.find((warning) => warning.code === 'surface_clamped')
    assert.ok(clamp, 'expected a surface_clamped warning')
    assert.ok((clamp?.details as { hits?: number } | undefined)?.hits ?? 0 > 0)
})

test('compileWorldSpec distinguishes forward-referenced ids from unknown ids in place_at', () => {
    const forward = compileWorldSpec({
        version: 1,
        world: { id: 'fwd', name: 'Forward', type: 'surface', seed: 'fwd-seed', size: [32, 32, 32] },
        anchors: [{ id: 'spawn', place_at_xz: [8, 8] }],
        content: {
            // A zone references an NPC that resolves later (npcs after zones).
            zones: [{ id: 'guard_zone', type: 'interact', place_at: 'late_npc' }],
            npcs: [{ id: 'late_npc', model: 'keeper', place_at: 'spawn' }],
        },
    })
    assert.equal(forward.report.status, 'failed')
    assert.ok(forward.report.errors.some((error) =>
        error.path === '$.content.zones[0].place_at' && /declared but has not resolved/.test(error.message)))

    const unknown = compileWorldSpec({
        version: 1,
        world: { id: 'unk', name: 'Unknown', type: 'surface', seed: 'unk-seed', size: [32, 32, 32] },
        anchors: [{ id: 'spawn', place_at_xz: [8, 8] }],
        content: { zones: [{ id: 'guard_zone', type: 'interact', place_at: 'nope' }] },
    })
    assert.equal(unknown.report.status, 'failed')
    assert.ok(unknown.report.errors.some((error) =>
        error.path === '$.content.zones[0].place_at' && /unknown anchor or object/.test(error.message)))
})

function diagnosticSummary(errors: readonly { code: string; message: string }[]): string {
    return errors.map((error) => `${error.code}: ${error.message}`).join('\n')
}

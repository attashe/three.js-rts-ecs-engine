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

test('compileWorldSpec reports unsupported non-surface world types explicitly', () => {
    const result = compileWorldSpec({
        version: 1,
        world: {
            id: 'underground_soon',
            name: 'Underground Soon',
            type: 'underground',
            seed: 'underground-soon',
            size: [32, 32, 32],
        },
    })

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) => error.code === 'unsupported_world_type'))
    assert.equal(result.meta.name, 'Underground Soon')
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

function diagnosticSummary(errors: readonly { code: string; message: string }[]): string {
    return errors.map((error) => `${error.code}: ${error.message}`).join('\n')
}

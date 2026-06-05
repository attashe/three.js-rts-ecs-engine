import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK } from '../src/engine/voxel/palette'
import {
    addWorldgenError,
    addWorldgenWarning,
    createWorldgenReport,
    finalizeWorldgenReport,
    hash32,
    normalizeWorldSpec,
    rand01,
    randInt,
    resolveMaterial,
    stableJson,
} from '../src/game/worldgen'
import type { WorldSpec } from '../src/game/worldgen'

const MINIMAL_SPEC: WorldSpec = {
    version: 1,
    world: {
        id: 'test.surface',
        name: 'Test Surface',
        type: 'surface',
        seed: 'worldgen/test',
        size: [32, 24, 32],
    },
}

test('valid minimal world spec normalizes with deterministic hash and ok report', () => {
    const a = normalizeWorldSpec(MINIMAL_SPEC)
    const b = normalizeWorldSpec({
        world: {
            size: [32, 24, 32],
            seed: 'worldgen/test',
            type: 'surface',
            name: 'Test Surface',
            id: 'test.surface',
        },
        version: 1,
    })

    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    if (!a.ok || !b.ok) return

    assert.equal(a.report.status, 'ok')
    assert.equal(a.report.specId, 'test.surface')
    assert.equal(a.report.specHash, b.report.specHash)
    assert.deepEqual(a.spec.world.size, [32, 24, 32])
    assert.equal(a.report.metrics.chunkCount, 0)
    assert.deepEqual(a.report.placements, [])
    assert.deepEqual(a.report.resolvedAnchors, {})
})

test('normalization trims header strings and validates optional default ground Y', () => {
    const ok = normalizeWorldSpec({
        version: 1,
        world: {
            id: ' test.surface ',
            name: ' Test Surface ',
            type: 'surface',
            seed: ' worldgen/test ',
            size: [32, 24, 32],
            defaultGroundY: 4,
        },
    })

    assert.equal(ok.ok, true)
    if (!ok.ok) return
    assert.equal(ok.spec.world.id, 'test.surface')
    assert.equal(ok.spec.world.name, 'Test Surface')
    assert.equal(ok.spec.world.seed, 'worldgen/test')
    assert.equal(ok.spec.world.defaultGroundY, 4)

    const bad = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        world: { ...MINIMAL_SPEC.world, defaultGroundY: 24 },
    })
    assert.equal(bad.ok, false)
    assert.ok(bad.report.errors.some((error) => error.code === 'invalid_world_field'))
})

test('invalid root, version, world fields, size, and ids fail clearly', () => {
    const invalidRoot = normalizeWorldSpec(null)
    assert.equal(invalidRoot.ok, false)
    assert.equal(invalidRoot.report.errors[0]?.code, 'invalid_spec')

    const invalid = normalizeWorldSpec({
        version: 2,
        world: {
            id: 'bad id',
            name: '',
            type: 'space',
            seed: '',
            size: [16, 0, 16],
        },
    })

    assert.equal(invalid.ok, false)
    assert.equal(invalid.report.status, 'failed')
    const codes = invalid.report.errors.map((error) => error.code)
    assert.ok(codes.includes('invalid_version'))
    assert.ok(codes.includes('missing_world_field'))
    assert.ok(codes.includes('invalid_world_type'))
    assert.ok(codes.includes('invalid_world_size'))
    assert.ok(codes.includes('invalid_id'))
})

test('duplicate ids across top-level generation sections are reported deterministically', () => {
    const result = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        terrain: {
            features: [{ id: 'shared.id', type: 'flatten_disc', material: 'grass' }],
        },
        anchors: [{ id: 'shared.id', place_at_xz: [4, 4] }],
        structures: [{ id: 'shared.id', asset: 'prefab.portal' }],
    })

    assert.equal(result.ok, false)
    const duplicates = result.report.errors.filter((error) => error.code === 'duplicate_id')
    assert.equal(duplicates.length, 2)
    assert.equal(duplicates[0]?.path, '$.anchors[0].id')
    assert.equal(duplicates[1]?.path, '$.structures[0].id')
})

test('id-bearing sections require object entries with ids', () => {
    const result = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        terrain: { features: [{ type: 'flatten_disc', material: 'grass' }, null] },
        carvers: { id: 'not-an-array' },
        content: {
            npcs: [{ name: 'Missing Id' }],
            shops: 'not-an-array',
        },
    })

    assert.equal(result.ok, false)
    const codes = result.report.errors.map((error) => error.code)
    assert.ok(codes.includes('missing_id'))
    assert.ok(codes.includes('invalid_section'))
    assert.ok(result.report.errors.some((error) => error.path === '$.terrain.features[0].id'))
    assert.ok(result.report.errors.some((error) => error.path === '$.terrain.features[1]'))
    assert.ok(result.report.errors.some((error) => error.path === '$.carvers'))
    assert.ok(result.report.errors.some((error) => error.path === '$.content.npcs[0].id'))
    assert.ok(result.report.errors.some((error) => error.path === '$.content.shops'))
})

test('materials resolve direct block keys and default aliases', () => {
    assert.deepEqual(resolveMaterial('grass'), {
        ok: true,
        name: 'grass',
        blockKey: 'grass',
        block: BLOCK.grass,
        source: 'direct',
    })
    assert.deepEqual(resolveMaterial('dark_limestone'), {
        ok: true,
        name: 'dark_limestone',
        blockKey: 'stone2',
        block: BLOCK.stone2,
        source: 'default-alias',
    })
    assert.deepEqual(resolveMaterial('rootbound-dirt'), {
        ok: true,
        name: 'rootbound-dirt',
        blockKey: 'dirt',
        block: BLOCK.dirt,
        source: 'default-alias',
    })
    assert.deepEqual(resolveMaterial('iron_ore'), {
        ok: true,
        name: 'iron_ore',
        blockKey: 'oreIron',
        block: BLOCK.oreIron,
        source: 'default-alias',
    })
    assert.deepEqual(resolveMaterial('oreCrystal'), {
        ok: true,
        name: 'oreCrystal',
        blockKey: 'oreCrystal',
        block: BLOCK.oreCrystal,
        source: 'direct',
    })
})

test('custom material aliases target engine block keys and unknown materials fail', () => {
    const ok = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        materials: { moon_stone: 'glow' },
        terrain: {
            features: [{ id: 'moon-plaza', type: 'flatten_disc', material: 'moon_stone' }],
        },
    })
    assert.equal(ok.ok, true)
    if (ok.ok) assert.deepEqual(ok.spec.materials, { moon_stone: 'glow' })

    const badTarget = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        materials: { moon_stone: 'notABlock' },
    })
    assert.equal(badTarget.ok, false)
    assert.ok(badTarget.report.errors.some((error) => error.code === 'invalid_material'))

    const unknown = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        terrain: {
            features: [{ id: 'bad-material', type: 'flatten_disc', material: 'moon_stone' }],
        },
    })
    assert.equal(unknown.ok, false)
    assert.ok(unknown.report.errors.some((error) => error.code === 'invalid_material' && error.path === '$.terrain.features[0].material'))

    const duplicateAlias = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        materials: { 'moon-stone': 'glow', moon_stone: 'stone' },
    })
    assert.equal(duplicateAlias.ok, false)
    assert.ok(duplicateAlias.report.errors.some((error) => error.code === 'duplicate_id' && error.path === '$.materials.moon_stone'))
})

test('stable json and keyed random helpers are deterministic', () => {
    const a = { z: 3, a: { d: 4, b: 2 }, list: [{ y: 1, x: 2 }] }
    const b = { list: [{ x: 2, y: 1 }], a: { b: 2, d: 4 }, z: 3 }

    assert.equal(stableJson(a), stableJson(b))
    assert.equal(hash32('seed', a), hash32('seed', b))
    assert.equal(rand01('seed', 'tree', 3), rand01('seed', 'tree', 3))
    assert.equal(randInt(2, 8, 'seed', 'tree', 3), randInt(2, 8, 'seed', 'tree', 3))
    assert.ok(rand01('seed') >= 0 && rand01('seed') < 1)
    assert.ok(randInt(2, 8, 'seed') >= 2 && randInt(2, 8, 'seed') <= 8)
    assert.throws(() => randInt(2.2, 2.4, 'seed'), /empty integer range/)
    assert.throws(() => randInt(Number.NaN, 2, 'seed'), /invalid range/)
})

test('$ref composition expands defs before validation with deterministic hash', () => {
    const composed = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        defs: {
            plaza: {
                type: 'flatten_disc',
                radius: 4,
                material: 'grass',
                nested: { a: 1, b: 2 },
                list: [1, 2],
            },
            guide: {
                model: 'keeper',
                place_at_xz: [8, 8],
                voice: { preset: 'elder', pitch: 1 },
            },
        },
        terrain: {
            features: [{
                id: 'shared_plaza',
                $ref: '#/defs/plaza',
                material: 'stone',
                nested: { b: 3 },
                list: [3],
            }],
        },
        content: {
            npcs: [{ id: 'guide_npc', $ref: '#/defs/guide', name: 'Guide' }],
        },
    })

    const expanded = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        terrain: {
            features: [{
                id: 'shared_plaza',
                type: 'flatten_disc',
                radius: 4,
                material: 'stone',
                nested: { a: 1, b: 3 },
                list: [3],
            }],
        },
        content: {
            npcs: [{
                id: 'guide_npc',
                model: 'keeper',
                place_at_xz: [8, 8],
                voice: { preset: 'elder', pitch: 1 },
                name: 'Guide',
            }],
        },
    })

    assert.equal(composed.ok, true, diagnosticSummary(composed.report.errors))
    assert.equal(expanded.ok, true, diagnosticSummary(expanded.report.errors))
    if (!composed.ok || !expanded.ok) return
    assert.equal(composed.report.specHash, expanded.report.specHash)
    assert.equal(composed.spec.defs, undefined)
    assert.deepEqual(composed.spec.terrain?.features?.[0], expanded.spec.terrain?.features?.[0])
    assert.deepEqual(composed.spec.content?.npcs?.[0], expanded.spec.content?.npcs?.[0])
})

test('$ref composition reports unsupported locations, bad references, and cycles', () => {
    const result = normalizeWorldSpec({
        ...MINIMAL_SPEC,
        world: { ...MINIMAL_SPEC.world, $ref: '#/defs/world' },
        defs: {
            text: 'not an object',
            cycleA: { $ref: '#/defs/cycleB', type: 'flatten_disc' },
            cycleB: { $ref: '#/defs/cycleA', radius: 3 },
        },
        terrain: {
            features: [
                { id: 'missing_ref', $ref: '#/defs/missing' },
                { id: 'bad_ref_target', $ref: '#/defs/text' },
                { id: 'bad_ref_path', $ref: '#/other/place' },
                { id: 'cycle_ref', $ref: '#/defs/cycleA' },
            ],
        },
    })

    assert.equal(result.ok, false)
    assert.ok(result.report.errors.some((error) => error.code === 'unsupported_ref' && error.path === '$.world.$ref'))
    assert.ok(result.report.errors.some((error) => error.code === 'missing_reference' && error.path === '$.terrain.features[0].$ref'))
    assert.ok(result.report.errors.some((error) => error.code === 'invalid_ref' && error.path === '$.terrain.features[1].$ref'))
    assert.ok(result.report.errors.some((error) => error.code === 'invalid_ref' && error.path === '$.terrain.features[2].$ref'))
    assert.ok(result.report.errors.some((error) => error.code === 'ref_cycle'))
})

test('report finalization derives ok, warning, and failed status', () => {
    const ok = createWorldgenReport('x', 'hash')
    assert.equal(finalizeWorldgenReport(ok).status, 'ok')

    const warning = createWorldgenReport('x', 'hash')
    addWorldgenWarning(warning, { code: 'test_warning', message: 'warning' })
    assert.equal(finalizeWorldgenReport(warning).status, 'warning')

    const failed = createWorldgenReport('x', 'hash')
    addWorldgenWarning(failed, { code: 'test_warning', message: 'warning' })
    addWorldgenError(failed, { code: 'test_error', message: 'error' })
    assert.equal(finalizeWorldgenReport(failed).status, 'failed')
})

function diagnosticSummary(errors: readonly { code: string; message: string }[]): string {
    return errors.map((entry) => `${entry.code}: ${entry.message}`).join('\n')
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { deserializeLevel } from '../src/engine/voxel/level-serializer'
import { compileWorldSpecToEditorLevel } from '../src/editor/worldgen-level-export'
import type { EditorLevelMeta } from '../src/editor/editor-state'
import {
    createProceduralEditorLevel,
} from '../src/editor/procedural-level-export'
import {
    PROCEDURAL_LEVEL_DEFINITIONS,
    WORLDGEN_PIPELINE_SAMPLE_LEVEL_ID,
    type ProceduralScriptSources,
} from '../src/game/procedural-levels'
import type { WorldgenReport } from '../src/game/worldgen'

const execFileAsync = promisify(execFile)
const SAMPLE_SPEC_PATH = resolve(process.cwd(), 'examples/worldgen/phase8-pipeline-sample.json')
const STRESS_SPEC_PATH = resolve(process.cwd(), 'examples/worldgen/phase9-region-stress.json')
const CLI_PATH = resolve(process.cwd(), '.tmp/test-build/scripts/compile-world-spec.js')

test('Phase 8 sample worldspec exports to editor-saveable metadata and a stable report', async () => {
    const exported = compileWorldSpecToEditorLevel(await readWorldSpec(SAMPLE_SPEC_PATH))

    assert.equal(exported.report.status, 'ok', diagnosticSummary(exported.report))
    assert.ok(exported.buffer)
    assert.equal(exported.report.specId, WORLDGEN_PIPELINE_SAMPLE_LEVEL_ID)
    assert.ok(exported.report.specHash)
    assert.ok(exported.report.worldHash)
    assert.equal(exported.report.metrics.regionCount, 1)
    assert.equal(exported.report.metrics.regions.length, 1)
    assert.ok(exported.report.resolvedAnchors.spawn)
    assert.ok(exported.report.resolvedObjects['sample-guide'])
    assert.ok(exported.report.placements.some((entry) => entry.kind === 'content_quest' && entry.id === 'sample-recover-cache'))
    assert.ok(exported.report.validation.every((entry) => entry.ok))
    assert.equal(exported.runtimeMeta.npcs.some((npc) => npc.id === 'sample-trader' && npc.scriptSource.includes('SHOP_sample_trader_shop')), true)

    const restored = deserializeLevel<EditorLevelMeta>(exported.buffer)
    assert.equal(restored.metadata.name, 'Worldgen Pipeline Sample')
    assert.ok(restored.metadata.npcs?.some((npc) => npc.id === 'sample-guide'))
    assert.ok(restored.metadata.scripts?.some((script) => script.id === 'worldgen:content:pickups'))
    assert.ok(restored.metadata.scripts?.some((script) => script.id === 'sample-road-sign-script'))
    assert.ok(restored.metadata.cinematics?.some((cinematic) => cinematic.id === 'sample-intro'))
    assert.equal(restored.metadata.environment?.soundId, 'music.amb.start')
    const leafZone = restored.metadata.weatherZones?.find((zone) => zone.id === 'sample-leaf-zone')
    assert.ok(leafZone)
    assert.equal(leafZone.presetId, 'leaves')
    assert.equal(leafZone.position.y > 10, true)
    assert.equal(Math.abs(leafZone.position.x - 24.5) < 0.001, true)
    assert.equal(Math.abs(leafZone.position.z - 28.5) < 0.001, true)
    assert.deepEqual(leafZone.size, { x: 18, y: 9, z: 18 })
})

test('Phase 8 sample is registered in the procedural export pipeline', () => {
    const level = createProceduralEditorLevel(WORLDGEN_PIPELINE_SAMPLE_LEVEL_ID, {} satisfies ProceduralScriptSources)
    const restored = deserializeLevel<EditorLevelMeta>(level.buffer)

    assert.equal(level.id, WORLDGEN_PIPELINE_SAMPLE_LEVEL_ID)
    assert.equal(level.file, `${WORLDGEN_PIPELINE_SAMPLE_LEVEL_ID}.vplevel`)
    assert.equal(level.runtimeMeta.name, 'Worldgen Pipeline Sample')
    assert.equal(restored.metadata.name, 'Worldgen Pipeline Sample')
    assert.ok(restored.metadata.zones?.some((zone) => zone.kind === 'portal' && zone.portal?.targetLevelId === 'demo'))
})

test('compile-world-spec CLI writes a level and report for valid specs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worldgen-cli-valid-'))
    const outPath = join(dir, 'sample.vplevel')
    const reportPath = join(dir, 'sample.report.json')

    await execFileAsync(process.execPath, [CLI_PATH, SAMPLE_SPEC_PATH, '--out', outPath, '--report', reportPath], { cwd: process.cwd() })

    const report = await readReport(reportPath)
    assert.equal(report.status, 'ok', diagnosticSummary(report))
    assert.ok(report.worldHash)
    const restored = deserializeLevel<EditorLevelMeta>(arrayBufferFrom(await readFile(outPath)))
    assert.equal(restored.metadata.name, 'Worldgen Pipeline Sample')
})

test('compile-world-spec CLI writes failed reports without exporting failed levels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worldgen-cli-failed-'))
    const specPath = join(dir, 'bad.json')
    const outPath = join(dir, 'bad.vplevel')
    const reportPath = join(dir, 'bad.report.json')
    await writeFile(specPath, JSON.stringify({
        version: 1,
        world: { id: 'bad-worldgen-spec', name: 'Bad Spec', type: 'surface', seed: 'bad', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5, features: [{ id: 'bad_feature', type: 'unsupported_feature_kind' }] },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
    }, null, 2))

    await assert.rejects(
        execFileAsync(process.execPath, [CLI_PATH, specPath, '--out', outPath, '--report', reportPath], { cwd: process.cwd() }),
    )

    const report = await readReport(reportPath)
    assert.equal(report.status, 'failed')
    assert.ok(report.errors.some((error) => error.code === 'unsupported_feature'))
    await assert.rejects(access(outPath))
})

test('compile-world-spec CLI exports warning specs and preserves warning diagnostics', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worldgen-cli-warning-'))
    const specPath = join(dir, 'warning.json')
    const outPath = join(dir, 'warning.vplevel')
    const reportPath = join(dir, 'warning.report.json')
    await writeFile(specPath, JSON.stringify({
        version: 1,
        world: { id: 'warning-worldgen-spec', name: 'Warning Spec', type: 'surface', seed: 'warning', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            zones: [{ id: 'optional-bad-zone', type: 'unknown-zone-kind', place_at: 'spawn', required: false }],
        },
    }, null, 2))

    await execFileAsync(process.execPath, [CLI_PATH, specPath, '--out', outPath, '--report', reportPath], { cwd: process.cwd() })

    const report = await readReport(reportPath)
    assert.equal(report.status, 'warning')
    assert.ok(report.warnings.some((warning) => warning.path === '$.content.zones[0].type'))
    const restored = deserializeLevel<EditorLevelMeta>(arrayBufferFrom(await readFile(outPath)))
    assert.equal(restored.metadata.name, 'Warning Spec')
})

test('Phase 9 stress worldspec compiles as an unregistered report-only fixture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worldgen-cli-stress-'))
    const reportPath = join(dir, 'stress.report.json')
    const defaultLevelPath = join(dir, 'public/levels/phase9-region-stress.vplevel')

    await execFileAsync(process.execPath, [CLI_PATH, STRESS_SPEC_PATH, '--report', reportPath, '--report-only'], { cwd: dir })

    const report = await readReport(reportPath)
    assert.equal(report.specId, 'phase9-region-stress')
    assert.equal(report.status, 'warning', diagnosticSummary(report))
    assert.equal(report.metrics.regionSizeChunks, 8)
    assert.equal(report.metrics.regionCount, 4)
    assert.ok(report.metrics.chunkCount > 96)
    assert.ok(report.metrics.regions.length > 1)
    assert.ok(report.metrics.regions.every((region) => region.chunkCount > 0))
    assert.ok(report.validation.every((entry) => entry.ok))
    assert.ok(report.warnings.some((warning) => warning.code === 'resident_world_budget'))
    assert.equal(PROCEDURAL_LEVEL_DEFINITIONS.some((definition) => definition.id === 'phase9-region-stress'), false)
    await assert.rejects(access(defaultLevelPath))
})

test('compile-world-spec CLI rejects report-only when an output level is requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'worldgen-cli-report-only-conflict-'))
    const outPath = join(dir, 'sample.vplevel')
    const reportPath = join(dir, 'sample.report.json')

    await assert.rejects(
        execFileAsync(process.execPath, [CLI_PATH, SAMPLE_SPEC_PATH, '--out', outPath, '--report', reportPath, '--report-only'], { cwd: process.cwd() }),
    )
    await assert.rejects(access(outPath))
    await assert.rejects(access(reportPath))
})

async function readWorldSpec(path: string): Promise<unknown> {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function readReport(path: string): Promise<WorldgenReport> {
    return JSON.parse(await readFile(path, 'utf8')) as WorldgenReport
}

function diagnosticSummary(report: WorldgenReport): string {
    return [...report.errors, ...report.warnings]
        .map((entry) => `${entry.code}${entry.path ? ` ${entry.path}` : ''}: ${entry.message}`)
        .join('\n')
}

function arrayBufferFrom(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { deserializeLevel } from '../src/engine/voxel/level-serializer'
import { createProceduralEditorLevel } from '../src/editor/procedural-level-export'
import type { EditorLevelMeta } from '../src/editor/editor-state'
import {
    DEMO_FROM_TOWN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    LARGE_TOWN_LEVEL_ID,
    PROCEDURAL_LEVEL_DEFINITIONS,
    PROCEDURAL_LEVEL_SCRIPT_FILES,
    TELEPORT_GARDEN_LEVEL_ID,
    TOWN_FROM_DEMO_ARRIVAL_ID,
    type ProceduralScriptSources,
} from '../src/game/procedural-levels'

const FAKE_SCRIPT_SOURCES: ProceduralScriptSources = Object.fromEntries(
    PROCEDURAL_LEVEL_SCRIPT_FILES.map((file) => [file.sourcePath, `// ${file.id}\n`]),
)

test('procedural levels export to editor-saveable .vplevel buffers', () => {
    for (const definition of PROCEDURAL_LEVEL_DEFINITIONS) {
        const level = createProceduralEditorLevel(definition.id, FAKE_SCRIPT_SOURCES)
        const restored = deserializeLevel<EditorLevelMeta>(level.buffer)

        assert.equal(level.id, definition.id)
        assert.equal(level.file, definition.file)
        assert.equal(restored.metadata.name, level.runtimeMeta.name)
        assert.equal(restored.metadata.spawn.x, level.runtimeMeta.spawn.x)
        assert.ok(restored.chunks.chunkCount() > 0, `${definition.id} should serialize visible chunks`)
    }
})

test('procedural demo export preserves scripts and travel metadata', () => {
    const demo = createProceduralEditorLevel(DEMO_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const garden = createProceduralEditorLevel(TELEPORT_GARDEN_LEVEL_ID, FAKE_SCRIPT_SOURCES)

    assert.deepEqual(
        demo.editorMeta.scripts?.map((script) => script.sourcePath),
        PROCEDURAL_LEVEL_SCRIPT_FILES.map((file) => file.sourcePath),
    )
    assert.ok(demo.editorMeta.zones?.some((zone) => zone.portal?.targetLevelId === TELEPORT_GARDEN_LEVEL_ID))
    assert.ok(garden.editorMeta.zones?.some((zone) => zone.portal?.targetLevelId === DEMO_LEVEL_ID))
})

test('demo <-> large-town portals resolve to existing arrival zones', () => {
    const demo = createProceduralEditorLevel(DEMO_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const town = createProceduralEditorLevel(LARGE_TOWN_LEVEL_ID, FAKE_SCRIPT_SOURCES)

    const toTown = demo.editorMeta.zones?.find((zone) => zone.portal?.targetLevelId === LARGE_TOWN_LEVEL_ID)
    assert.ok(toTown, 'demo should have a portal into the large town')
    assert.equal(toTown!.portal?.targetArrivalId, TOWN_FROM_DEMO_ARRIVAL_ID)
    assert.ok(
        town.editorMeta.zones?.some((zone) => zone.id === TOWN_FROM_DEMO_ARRIVAL_ID && zone.kind === 'arrival'),
        'town should expose the arrival zone the demo portal targets',
    )

    const backToDemo = town.editorMeta.zones?.find((zone) => zone.portal?.targetLevelId === DEMO_LEVEL_ID)
    assert.ok(backToDemo, 'town should have a return portal to the demo')
    assert.equal(backToDemo!.portal?.targetArrivalId, DEMO_FROM_TOWN_ARRIVAL_ID)
    assert.ok(
        demo.editorMeta.zones?.some((zone) => zone.id === DEMO_FROM_TOWN_ARRIVAL_ID && zone.kind === 'arrival'),
        'demo should expose the arrival zone the town return portal targets',
    )
})

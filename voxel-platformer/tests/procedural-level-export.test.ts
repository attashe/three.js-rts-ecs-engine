import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK } from '../src/engine/voxel/palette'
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

test('procedural demo includes an aggressive hammer troll guardian', () => {
    const demo = createProceduralEditorLevel(DEMO_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const npc = demo.runtimeMeta.npcs.find((candidate) => candidate.id === 'demo:troll-guardian')

    assert.ok(npc, 'demo should place the troll guardian')
    assert.equal(npc!.model, 'large-troll')
    assert.equal(npc!.variant, 'guardian')
    assert.equal(npc!.collisionEnabled, true)
    assert.deepEqual(npc!.equipment, { handR: 'battle-hammer', handL: null })
    assert.match(npc!.scriptSource, /npc\.setHostile\(NPC_ID, 'player', true\)/)
    assert.match(npc!.scriptSource, /npc\.setPerceptionRadius\(NPC_ID, 8\)/)
    assert.equal(demo.chunks.getVoxel(Math.floor(npc!.position.x), npc!.position.y - 1, Math.floor(npc!.position.z)), BLOCK.grass)
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

test('large town includes a long rideable rail line', () => {
    const town = createProceduralEditorLevel(LARGE_TOWN_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const cart = town.runtimeMeta.railCarts.find((candidate) => candidate.id === 'large-town:boulevard-cart')

    assert.ok(cart, 'large town should place a boulevard cart')
    assert.equal(town.chunks.getVoxel(cart!.railCell.x, cart!.railCell.y, cart!.railCell.z), BLOCK.rail)
    assert.equal(town.chunks.getVoxel(127, cart!.railCell.y, cart!.railCell.z), BLOCK.rail)
    assert.equal(town.chunks.getVoxel(128, cart!.railCell.y, cart!.railCell.z), BLOCK.grass)
    assert.equal(town.chunks.getVoxel(128, cart!.railCell.y + 1, cart!.railCell.z), BLOCK.rail)
    assert.equal(town.chunks.getVoxel(138, cart!.railCell.y + 1, cart!.railCell.z), BLOCK.rail)
    assert.equal(town.chunks.getVoxel(139, cart!.railCell.y, cart!.railCell.z), BLOCK.rail)
    assert.equal(town.chunks.getVoxel(240, cart!.railCell.y, cart!.railCell.z), BLOCK.rail)
    assert.equal(town.chunks.getVoxel(490, cart!.railCell.y, cart!.railCell.z), BLOCK.rail)
})

test('large town includes a collidable large troll NPC', () => {
    const town = createProceduralEditorLevel(LARGE_TOWN_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const npc = town.runtimeMeta.npcs.find((candidate) => candidate.id === 'large-town:large-troll-curator')

    assert.ok(npc, 'large town should place the large troll curator')
    assert.equal(npc!.model, 'large-troll')
    assert.equal(npc!.beard, 'pointed')
    assert.equal(npc!.collisionEnabled, true)
    assert.equal(npc!.colliderHeight, 3.2)
    assert.equal(npc!.colliderRadius, 0.72)
    assert.equal(town.chunks.getVoxel(Math.floor(npc!.position.x), npc!.position.y - 1, Math.floor(npc!.position.z)), BLOCK.grass)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { BLOCK } from '../src/engine/voxel/palette'
import { deserializeLevel } from '../src/engine/voxel/level-serializer'
import { createProceduralEditorLevel } from '../src/editor/procedural-level-export'
import type { EditorLevelMeta } from '../src/editor/editor-state'
import {
    ARENA_FROM_DEMO_ARRIVAL_ID,
    COMBAT_ARENA_LEVEL_ID,
    DEMO_FROM_ARENA_ARRIVAL_ID,
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

test('procedural demo has no immediate combat encounters but keeps opt-in sentry hostility', () => {
    const demo = createProceduralEditorLevel(DEMO_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const ids = demo.runtimeMeta.npcs.map((npc) => npc.id)
    const sentry = demo.runtimeMeta.npcs.find((npc) => npc.id === 'demo-sentry')

    assert.ok(!ids.includes('demo-guard'), 'demo should not place the hostile patrol guard')
    assert.ok(!ids.includes('demo-troll-guardian'), 'demo should not place the hostile hammer guardian')
    assert.ok(sentry, 'demo should keep Sentry Voss')
    assert.deepEqual(sentry!.equipment, { handR: 'sword', handL: null })
    assert.match(sentry!.scriptSource, /choiceId === 'insult'/)
    assert.match(sentry!.scriptSource, /npc\.setHostile\(NPC_ID, 'player', true\)/)
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

test('demo <-> combat arena portals resolve to existing arrival zones', () => {
    const demo = createProceduralEditorLevel(DEMO_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const arena = createProceduralEditorLevel(COMBAT_ARENA_LEVEL_ID, FAKE_SCRIPT_SOURCES)

    const toArena = demo.editorMeta.zones?.find((zone) => zone.portal?.targetLevelId === COMBAT_ARENA_LEVEL_ID)
    assert.ok(toArena, 'demo should have a portal into the combat arena')
    assert.equal(toArena!.portal?.targetArrivalId, ARENA_FROM_DEMO_ARRIVAL_ID)
    assert.ok(
        arena.editorMeta.zones?.some((zone) => zone.id === ARENA_FROM_DEMO_ARRIVAL_ID && zone.kind === 'arrival'),
        'combat arena should expose the arrival zone the demo portal targets',
    )

    const backToDemo = arena.editorMeta.zones?.find((zone) => zone.portal?.targetLevelId === DEMO_LEVEL_ID)
    assert.ok(backToDemo, 'combat arena should have a return portal to the demo')
    assert.equal(backToDemo!.portal?.targetArrivalId, DEMO_FROM_ARENA_ARRIVAL_ID)
    assert.ok(
        demo.editorMeta.zones?.some((zone) => zone.id === DEMO_FROM_ARENA_ARRIVAL_ID && zone.kind === 'arrival'),
        'demo should expose the arrival zone the arena return portal targets',
    )
})

test('combat arena includes hostile guards, target dummies, and hammer bystanders', () => {
    const arena = createProceduralEditorLevel(COMBAT_ARENA_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const byId = new Map(arena.runtimeMeta.npcs.map((npc) => [npc.id, npc]))
    const sword = byId.get('arena-sword-guard')
    const hammer = byId.get('arena-hammer-guardian')
    const smallDummy = byId.get('arena-volume-dummy-small')
    const largeDummy = byId.get('arena-volume-dummy-large')
    const bystanderA = byId.get('arena-friendly-fire-a')
    const bystanderB = byId.get('arena-friendly-fire-b')
    const bootsScript = arena.runtimeMeta.scripts.find((script) => script.id === 'combat-arena-high-jump-boots')

    assert.equal(arena.runtimeMeta.player.abilities.highJump, false)
    assert.equal(arena.runtimeMeta.player.inventory.items['heal-potion']?.quantity, 2)
    assert.ok(bootsScript, 'arena should spawn the high jump boots pickup')
    assert.match(bootsScript!.source, /pickups\.spawn\(BOOTS_ID, PICKUP_POS/)
    assert.match(bootsScript!.source, /"icon":"boots"/)
    assert.ok(sword, 'arena should place a sword guard')
    assert.deepEqual(sword!.equipment, { handR: 'sword', handL: null })
    assert.match(sword!.scriptSource, /npc\.setHostile\(NPC_ID, 'player', true\)/)
    assert.ok(hammer, 'arena should place a hammer guardian')
    assert.equal(hammer!.model, 'large-troll')
    assert.equal(hammer!.variant, 'guardian')
    assert.deepEqual(hammer!.equipment, { handR: 'battle-hammer', handL: null })
    assert.match(hammer!.scriptSource, /npc\.setPerceptionRadius\(NPC_ID, 9\)/)
    assert.ok(smallDummy && largeDummy, 'arena should include volume-check target dummies')
    assert.equal(largeDummy!.colliderRadius, 0.78)
    assert.ok(bystanderA && bystanderB, 'arena should include non-target bystanders for hammer area checks')
    assert.equal(arena.chunks.getVoxel(Math.floor(hammer!.position.x), hammer!.position.y - 1, Math.floor(hammer!.position.z)), BLOCK.stone2)
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

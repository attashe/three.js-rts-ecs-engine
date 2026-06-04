import test from 'node:test'
import assert from 'node:assert/strict'
import type { Zone } from '../src/engine/ecs/zones'
import type { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK } from '../src/engine/voxel/palette'
import { deserializeLevel } from '../src/engine/voxel/level-serializer'
import { findPath } from '../src/engine/voxel/voxel-path'
import { createProceduralEditorLevel } from '../src/editor/procedural-level-export'
import type { EditorLevelMeta } from '../src/editor/editor-state'
import {
    ARENA_FROM_DEMO_ARRIVAL_ID,
    COMBAT_ARENA_LEVEL_ID,
    DEMO_FROM_ARENA_ARRIVAL_ID,
    DEMO_FROM_TOWN_ARRIVAL_ID,
    DEMO_LEVEL_ID,
    FOREST_LIFT_FROM_EDGE_ARRIVAL_ID,
    FOREST_LIFT_VALLEY_LEVEL_ID,
    LARGE_TOWN_LEVEL_ID,
    PROCEDURAL_LEVEL_DEFINITIONS,
    PROCEDURAL_LEVEL_SCRIPT_FILES,
    TELEPORT_GARDEN_LEVEL_ID,
    TOWN_FROM_DEMO_ARRIVAL_ID,
    type ProceduralScriptSources,
} from '../src/game/procedural-levels'
import { HELD_TORCH_ITEM_ID } from '../src/game/inventory'

const FAKE_SCRIPT_SOURCES: ProceduralScriptSources = Object.fromEntries(
    PROCEDURAL_LEVEL_SCRIPT_FILES.map((file) => [file.sourcePath, `// ${file.id}\n`]),
)

function standCell(pos: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
}

function zoneCenterCell(zone: Zone): { x: number; y: number; z: number } {
    return {
        x: Math.floor((zone.min.x + zone.max.x) / 2),
        y: zone.min.y,
        z: Math.floor((zone.min.z + zone.max.z) / 2),
    }
}

function hasSurfacePath(
    chunks: ChunkManager,
    start: { x: number; y: number; z: number },
    goal: { x: number; y: number; z: number },
): boolean {
    return findPath(chunks, start, goal, { maxNodes: 16_000, maxStepUp: 1, maxDrop: 3 }) !== null
}

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

test('teleport garden places stairs around the pond border', () => {
    const garden = createProceduralEditorLevel(TELEPORT_GARDEN_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const waterY = 4
    let stairCount = 0
    let waterNeighborCount = 0
    let shoreNeighborCount = 0

    for (let z = 0; z < 20; z++) {
        for (let x = 0; x < 20; x++) {
            if (garden.chunks.getVoxel(x, waterY, z) !== BLOCK.stairs) continue
            stairCount++
            const neighbors = [
                garden.chunks.getVoxel(x + 1, waterY, z),
                garden.chunks.getVoxel(x - 1, waterY, z),
                garden.chunks.getVoxel(x, waterY, z + 1),
                garden.chunks.getVoxel(x, waterY, z - 1),
            ]
            if (neighbors.some((block) => block === BLOCK.water)) waterNeighborCount++
            if (neighbors.some((block) => block !== BLOCK.air && block !== BLOCK.water && block !== BLOCK.stairs)) {
                shoreNeighborCount++
            }
        }
    }

    assert.ok(stairCount >= 12, `expected a visible stair ring around the pond, got ${stairCount}`)
    assert.ok(waterNeighborCount > 0, 'stairs should border remaining pond water')
    assert.ok(shoreNeighborCount > 0, 'stairs should connect to shore blocks')
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
    const spearman = byId.get('arena-shield-spearman')
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
    assert.ok(spearman, 'arena should place a shield spearman')
    assert.equal(spearman!.model, 'shield-spearman')
    assert.deepEqual(spearman!.equipment, { handR: 'spear', handL: 'shield' })
    assert.match(spearman!.scriptSource, /npc\.setHostile\(NPC_ID, 'player', true\)/)
    assert.ok(smallDummy && largeDummy, 'arena should include volume-check target dummies')
    assert.equal(largeDummy!.colliderRadius, 0.78)
    assert.ok(bystanderA && bystanderB, 'arena should include non-target bystanders for hammer area checks')
    assert.equal(arena.chunks.getVoxel(Math.floor(hammer!.position.x), hammer!.position.y - 1, Math.floor(hammer!.position.z)), BLOCK.stone2)
})

test('forest lift valley generates an unarmed quest scenario with an unreachable cliff lift top', () => {
    const valley = createProceduralEditorLevel(FOREST_LIFT_VALLEY_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const meta = valley.runtimeMeta
    const propKinds = new Set(meta.props.map((prop) => prop.kind))
    const liftControlLevers = meta.props.filter((prop) => prop.kind === 'lift-control-lever')
    const bottomZone = meta.zones.find((zone) => zone.id === 'zone.forest-lift.bottom')
    const topZone = meta.zones.find((zone) => zone.id === 'zone.forest-lift.top')
    const signZone = meta.zones.find((zone) => zone.id === 'zone.forest-lift.road-sign')
    const arrival = meta.zones.find((zone) => zone.id === FOREST_LIFT_FROM_EDGE_ARRIVAL_ID)
    const cliffwright = meta.npcs.find((npc) => npc.id === 'forest-lift-cliffwright')
    const rabbits = meta.npcs.filter((npc) => npc.model === 'rabbit')
    const piston = meta.pistons.find((candidate) => candidate.id === 'piston.forest-lift')
    const script = meta.scripts.find((entry) => entry.id === 'forest-lift-valley-quest')
    const intro = meta.cinematics?.find((cinematic) => cinematic.id === 'forest-lift-arrival')

    assert.equal(meta.name, 'Forest Lift Valley')
    assert.equal(meta.size, 128)
    assert.ok(meta.spawn.x <= 8.5, 'player should start at the road near the level edge')
    assert.ok(meta.spawn.z >= 117.5, 'player should start at the road near the level edge')
    assert.deepEqual(meta.player.equipment.melee, { handR: null, handL: null })
    assert.deepEqual(meta.player.equipment.magic, { handR: null, handL: null })
    assert.equal(meta.player.abilities.bow, false)
    assert.equal(meta.player.abilities.highJump, false)
    assert.equal(meta.player.abilities.airPush, false)
    assert.equal(meta.player.abilities.torch, false)
    assert.equal(meta.player.inventory.items[HELD_TORCH_ITEM_ID], undefined)
    assert.equal(meta.player.inventory.gold, 0)
    assert.equal(meta.player.inventory.arrows, 0)
    assert.deepEqual(meta.player.inventory.items, {})

    assert.ok(arrival && arrival.kind === 'arrival', 'forest valley should expose a future travel arrival')
    assert.ok(signZone && signZone.kind === 'interact', 'road sign should be readable from the starting road')
    assert.equal(signZone!.interaction?.prompt, 'Read Sign')
    assert.ok(bottomZone && bottomZone.kind === 'interact', 'bottom lift station should be interactable')
    assert.ok(topZone && topZone.kind === 'interact', 'top lift station should be interactable')
    assert.ok(propKinds.has('road-sign'), 'starting road should include a visible warning sign')
    assert.ok(propKinds.has('lift-cabin-broken'), 'broken lift cabin should be visible before repair')
    assert.ok(propKinds.has('broken-wagon'), 'quest site should include a destroyed wagon')
    assert.ok(propKinds.has('fallen-driver'), 'quest site should include the dead driver')
    assert.ok(propKinds.has('repair-materials-crate'), 'quest site should include repair materials')
    assert.equal(liftControlLevers.length, 2, 'bottom and top lift controls should have visible lever props')
    assert.ok(
        liftControlLevers.some((prop) => Math.abs(prop.position.y - bottomZone!.min.y) < 0.1),
        'bottom lift control should have a lever at the lower station',
    )
    assert.ok(
        liftControlLevers.some((prop) => Math.abs(prop.position.y - topZone!.min.y) < 0.1),
        'top lift control should have a lever at the upper station',
    )

    assert.ok(cliffwright, 'quest giver should stand near the broken lift')
    assert.equal(cliffwright!.name, 'Brann Cliffwright')
    assert.equal(cliffwright!.model, 'keeper')
    assert.equal(cliffwright!.interactionEnabled, true)
    assert.equal(cliffwright!.invulnerable, true)
    assert.match(cliffwright!.scriptSource, /supply wagon went over/i)
    assert.match(cliffwright!.scriptSource, /Find the wreck and bring the parts back/i)
    assert.match(cliffwright!.scriptSource, /torch for safer night travels/i)
    assert.match(cliffwright!.scriptSource, /spare torch/i)
    assert.equal(rabbits.length, 2, 'forest valley should include two ambient rabbits')
    assert.deepEqual(
        rabbits.map((rabbit) => rabbit.id).sort(),
        ['forest-lift-rabbit-house', 'forest-lift-rabbit-west'],
    )
    assert.ok(rabbits.every((rabbit) => rabbit.collisionEnabled === false), 'ambient rabbits should not block the player')
    assert.ok(rabbits.every((rabbit) => /npc\.setFlee\(NPC_ID, true\)/.test(rabbit.scriptSource)))

    assert.ok(piston, 'repaired lift should be authored as a script-controlled piston')
    assert.equal(piston!.motion, 'physical')
    assert.equal(piston!.visualKind, 'lift-cabin-repaired')
    assert.equal(piston!.deployed, false)
    assert.ok(piston!.to.y - piston!.from.y >= 16, 'lift should bridge the cliff height')

    assert.ok(script, 'forest valley should include the repair quest script')
    assert.match(script!.source, /pickups\.spawn\(MATERIAL_ID, MATERIAL_POS/)
    assert.match(script!.source, /id: MATERIAL_PICKUP_ID/)
    assert.match(script!.source, /pickups\.spawn\(SWORD_ID, SWORD_POS/)
    assert.match(script!.source, /id: SWORD_PICKUP_ID/)
    assert.match(script!.source, /player\.setSettings/)
    assert.match(script!.source, /TORCH_REWARD_FLAG/)
    assert.match(script!.source, /player\.addInventoryItem\(TORCH_ID, 1, TORCH_ITEM\)/)
    assert.match(script!.source, /abilities: \{ torch: true \}/)
    assert.match(script!.source, /torch for night travel/i)
    assert.match(script!.source, /pistons\.setDeployed\(LIFT_PISTON, repaired\)/)
    assert.match(script!.source, /inventory\.has\(MATERIAL_ID/)
    assert.match(script!.source, /"icon":"sword"/)
    assert.match(script!.source, /Keep the road, traveller/)
    assert.match(script!.source, /Beware the wolves/)

    assert.ok(intro, 'forest valley should include an arrival cinematic')
    assert.equal(intro!.playOnStart, true)
    assert.equal(intro!.freezePlayer, true)
    assert.ok(
        intro!.steps.filter((step) => step.type === 'camera').length >= 3,
        'arrival cinematic should observe the road, valley, and cliff',
    )
    assert.ok(
        intro!.steps.some((step) => step.type === 'subtitle' && /pilgrimage/i.test(step.text)),
        'arrival cinematic should explain the pilgrimage premise',
    )

    assert.ok(hasSurfacePath(valley.chunks, standCell(meta.spawn), zoneCenterCell(bottomZone!)))
    assert.equal(
        hasSurfacePath(valley.chunks, standCell(meta.spawn), zoneCenterCell(topZone!)),
        false,
        'top station should be unreachable from spawn before the lift is repaired',
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

test('large town includes the fixed dwarf market row and merchants', () => {
    const town = createProceduralEditorLevel(LARGE_TOWN_LEVEL_ID, FAKE_SCRIPT_SOURCES)
    const propKinds = new Set(town.runtimeMeta.props.map((prop) => prop.kind))
    for (const kind of [
        'market-meat',
        'market-apples',
        'market-fish',
        'spear-rack',
        'arrow-barrel',
        'helmet-stand',
        'hat-display',
        'boot-rack',
        'potion-shelf',
        'alchemy-cauldron',
    ] as const) {
        assert.ok(propKinds.has(kind), `large town should place ${kind}`)
    }

    const byId = new Map(town.runtimeMeta.npcs.map((npc) => [npc.id, npc]))
    const product = byId.get('large-town:product-vendor')
    const smith = byId.get('large-town:forge-smith')
    const clothier = byId.get('large-town:clothier')
    const alchemist = byId.get('large-town:alchemist')

    assert.ok(product && smith && clothier && alchemist, 'large town should place all dwarf merchants')
    assert.equal(product!.interactionPrompt, 'Talk')
    assert.equal(smith!.equipment.handR, 'spear')
    assert.equal(alchemist!.equipment.handR, 'staff-crystal')
    assert.match(smith!.scriptSource, /resource": "spear"/)
    assert.match(smith!.scriptSource, /resource": "metal-helmet"/)
    assert.match(clothier!.scriptSource, /resource": "hat-ranger"/)
    assert.match(clothier!.scriptSource, /resource": "hat-sniper"/)
    assert.match(clothier!.scriptSource, /resource": "high-speed-boots"/)
    assert.match(product!.scriptSource, /resource": "food-apple"/)
    assert.match(product!.scriptSource, /resource": "food-pie"/)
    assert.match(alchemist!.scriptSource, /resource": "heal-potion"/)
    assert.match(alchemist!.scriptSource, /resource": "mana-potion"/)
    assert.match(alchemist!.scriptSource, /resource": "dynamite"/)
    assert.match(product!.scriptSource, /trade\.open/)
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

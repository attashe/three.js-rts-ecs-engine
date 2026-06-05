import test from 'node:test'
import assert from 'node:assert/strict'
import { createScriptEngineSystem } from '../src/engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    LogFacade,
    PickupSpawnOptions,
    PickupsFacade,
    PistonsFacade,
    PlayerFacade,
    ScriptEntry,
    TradeFacade,
    TradeRequest,
    VoxelCoord,
    ZoneFacade,
} from '../src/engine/script/types'
import { createGameWorld, pushScriptTriggerEvent, type GameWorld } from '../src/engine/ecs/world'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'
import { compileWorldSpec } from '../src/game/worldgen'
import type { WorldSpec } from '../src/game/worldgen'
import { npcInteractionZoneId, npcScriptEntries } from '../src/game/npcs/npc-types'

const RICH_CONTENT_SPEC: WorldSpec = {
    version: 1,
    world: {
        id: 'rich_content_surface',
        name: 'Rich Content Surface',
        type: 'surface',
        seed: 'rich-content-seed',
        size: [48, 32, 48],
        defaultGroundY: 6,
    },
    terrain: { base_height: 6 },
    anchors: [{ id: 'spawn', place_at_xz: [6, 6], reserve: [3, 3, 3] }],
    content: {
        zones: [
            { id: 'zone_shop', type: 'interact', place_at_xz: [16, 8], prompt: 'Trade', half_xz: [1, 1] },
        ],
        npcs: [
            { id: 'quest_giver', model: 'keeper', name: 'Archivist Nara', place_at_xz: [10, 8], interactionEnabled: true, interactionPrompt: 'Talk', scriptSource: '' },
            { id: 'shopkeeper', model: 'keeper', name: 'Quartermaster', place_at_xz: [12, 8], interactionEnabled: true, interactionPrompt: 'Trade', scriptSource: '' },
        ],
        pickups: [
            {
                id: 'field_potion',
                kind: 'heal-potion',
                place_at_xz: [8, 10],
                label: 'Field Potion',
                inventoryItem: { id: 'heal-potion', name: 'Healing Potion', category: 'consumables', icon: 'heal-potion' },
            },
        ],
        shops: [
            {
                id: 'quartermaster_shop',
                target: 'shopkeeper',
                title: 'Quartermaster Supplies',
                items: [
                    { id: 'healing', name: 'Healing Potion', resource: 'heal-potion', buyPrice: 8, sellPrice: 3, stock: 4 },
                    { id: 'arrows', name: 'Arrow Bundle', resource: 'arrows', unitSize: 5, buyPrice: 5, stock: 6 },
                ],
            },
            {
                id: 'zone_supply_shop',
                target: 'zone_shop',
                title: 'Supply Crate',
                items: [{ id: 'mana', name: 'Mana Potion', resource: 'mana-potion', buyPrice: 9, stock: 2 }],
            },
        ],
        quests: [
            {
                id: 'recover_relic',
                type: 'collect_return',
                target: 'quest_giver',
                title: 'Recover the Relic',
                pickups: [
                    {
                        id: 'lost_relic_pickup',
                        kind: 'lost-relic',
                        place_at_xz: [18, 14],
                        label: 'Lost Relic',
                        inventoryItem: { id: 'lost-relic', name: 'Lost Relic', category: 'quest', icon: 'quest-shard' },
                    },
                ],
                reward: {
                    gold: 25,
                    items: [{ id: 'held-torch', quantity: 1, options: { name: 'Hand Torch', category: 'tools', icon: 'torch' } }],
                },
                dialogue: {
                    start: 'Find the lost relic near the old marker.',
                    complete: 'That is the relic. Take this torch and some coin.',
                    done: 'The archive is safe again.',
                },
            },
        ],
        cinematics: [
            {
                id: 'rich_intro',
                name: 'Rich Intro',
                playOnStart: true,
                steps: [
                    { id: 'line', type: 'subtitle', wait: true, duration: 2, text: 'The valley road opens ahead.' },
                ],
            },
        ],
        environment: {
            soundId: 'music.background',
            volume: 0.22,
            ambientWeather: { presetId: 'clear', state: { timeOfDay: 10 } },
            soundSources: [{ id: 'brook_sound', soundId: 'amb.water', position: [9, 7, 12], radius: 10, volume: 0.3 }],
            soundZones: [{ id: 'wind_zone', soundId: 'amb.wind', position: [20, 8, 20], size: [8, 4, 8], volume: 0.25 }],
            weatherZones: [{ id: 'mist_zone', presetId: 'fog', position: [22, 8, 22], size: [8, 4, 8], addSound: false }],
        },
        travel: [
            { id: 'arrival_start', type: 'arrival', place_at: 'spawn', half_xz: [1, 1] },
            { id: 'portal_exit', type: 'portal', place_at_xz: [24, 24], targetLevelId: 'next-level', targetArrivalId: 'arrival.start' },
        ],
    },
}

test('worldgen Phase 7 rich content compiles into metadata and generated scripts', () => {
    const result = compileWorldSpec(RICH_CONTENT_SPEC)

    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))
    assert.equal(result.meta.npcs.length, 2)
    assert.equal(result.meta.scripts.some((script) => script.id === 'worldgen:content:pickups'), true)
    assert.equal(result.meta.scripts.some((script) => script.id === 'worldgen:shop:zone_supply_shop'), true)
    assert.equal(result.meta.cinematics?.[0]?.id, 'rich_intro')
    assert.equal(result.meta.environment?.soundId, 'music.background')
    assert.equal(result.meta.ambientWeather?.presetId, 'clear')
    assert.equal(result.meta.soundSources[0]?.id, 'brook_sound')
    assert.equal(result.meta.soundZones[0]?.id, 'wind_zone')
    assert.equal(result.meta.weatherZones[0]?.id, 'mist_zone')
    assert.equal(result.meta.zones.some((zone) => zone.id === 'arrival_start' && zone.kind === 'arrival'), true)
    assert.equal(result.meta.zones.some((zone) => zone.id === 'portal_exit' && zone.portal?.targetLevelId === 'next-level'), true)

    const questNpc = result.meta.npcs.find((npc) => npc.id === 'quest_giver')
    const shopNpc = result.meta.npcs.find((npc) => npc.id === 'shopkeeper')
    assert.ok(questNpc?.scriptSource.includes('handleQuest_recover_relic'))
    assert.ok(shopNpc?.scriptSource.includes('trade.open'))
    assert.ok(result.report.placements.some((placement) => placement.kind === 'content_quest' && placement.id === 'recover_relic'))
    assert.ok(result.report.placements.some((placement) => placement.kind === 'content_shop' && placement.id === 'quartermaster_shop'))
    assert.ok(result.report.placements.some((placement) => placement.kind === 'content_pickup' && placement.id === 'field_potion'))
})

test('generated rich content scripts run through the script engine', async () => {
    const result = compileWorldSpec(RICH_CONTENT_SPEC)
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))
    const scripts = [...result.meta.scripts, ...npcScriptEntries(result.meta.npcs)]
    const harness = makeHarness(scripts)

    harness.sys.init?.(harness.world)
    await flushMicrotasks()

    assert.equal(harness.sys.broken.size, 0)
    assert.ok(harness.pickupSpawns.some((pickup) => pickup.opts?.id === 'field_potion'))
    assert.ok(harness.pickupSpawns.some((pickup) => pickup.opts?.id === 'lost_relic_pickup'))

    harness.interact(npcInteractionZoneId({ id: 'shopkeeper' }))
    await harness.tick(0.1)
    assert.equal(harness.tradeRequests[0]?.id, 'quartermaster_shop')

    harness.interact('zone_shop')
    await harness.tick(0.1)
    assert.equal(harness.tradeRequests[1]?.id, 'zone_supply_shop')

    harness.interact(npcInteractionZoneId({ id: 'quest_giver' }))
    await harness.tick(0.1)
    assert.equal(harness.dialogueRequests.length, 1)
    assert.equal(harness.flag('worldgen.quest.recover_relic.state'), 'active')

    harness.addInventoryItem('lost-relic', 1)
    harness.takePickup('lost-relic', 'lost_relic_pickup')
    await harness.tick(0.1)
    assert.equal(harness.flag('worldgen.quest.recover_relic.state'), 'ready')

    harness.interact(npcInteractionZoneId({ id: 'quest_giver' }))
    await harness.tick(0.1)
    assert.equal(harness.flag('worldgen.quest.recover_relic.state'), 'done')
    assert.equal(harness.gold, 25)
    assert.equal(harness.inventoryCount('held-torch'), 1)
    assert.equal(harness.inventoryCount('lost-relic'), 0)
    assert.ok(harness.audioPlays.includes('sfx.quest.fanfare'))

    harness.interact(npcInteractionZoneId({ id: 'quest_giver' }))
    await harness.tick(0.1)
    assert.equal(harness.gold, 25, 'quest reward is granted once')
})

test('content placement references are order-independent for spatial content', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'forward_content_refs', name: 'Forward Content Refs', type: 'surface', seed: 'forward-content-refs', size: [40, 24, 40], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            zones: [
                { id: 'zone_at_later_prop', type: 'interact', place_at: 'later_prop', prompt: 'Inspect' },
                { id: 'later_zone', type: 'interact', place_at_xz: [12, 10], prompt: 'Talk' },
            ],
            npcs: [
                { id: 'npc_at_later_zone', model: 'keeper', place_at: 'later_zone', interactionEnabled: true, scriptSource: '' },
            ],
            travel: [
                { id: 'arrival_at_later_pickup', type: 'arrival', place_at: 'later_pickup' },
            ],
            pickups: [
                { id: 'later_pickup', kind: 'heal-potion', place_at: 'npc_at_later_zone' },
            ],
            props: [
                { id: 'later_prop', kind: 'road-sign', place_at_xz: [10, 10] },
            ],
            shops: [{
                id: 'forward_shop',
                target: 'zone_at_later_prop',
                items: [{ id: 'heal', name: 'Healing Potion', resource: 'heal-potion', buyPrice: 8 }],
            }],
            quests: [{
                id: 'forward_quest',
                target: 'npc_at_later_zone',
                requiredItems: [{ id: 'lost-relic', quantity: 1 }],
            }],
        },
    })

    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))
    assert.ok(result.report.resolvedObjects.later_prop)
    assert.ok(result.report.resolvedObjects.zone_at_later_prop)
    assert.ok(result.report.resolvedObjects.npc_at_later_zone)
    assert.ok(result.report.resolvedObjects.later_pickup)
    assert.ok(result.report.resolvedObjects.arrival_at_later_pickup)
    assert.ok(result.meta.scripts.some((script) => script.id === 'worldgen:shop:forward_shop'))
    assert.ok(result.meta.npcs.find((npc) => npc.id === 'npc_at_later_zone')?.scriptSource.includes('handleQuest_forward_quest'))
})

test('worldgen rail-cart content emits metadata and participates in spatial references', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'rail_cart_content', name: 'Rail Cart Content', type: 'underground', seed: 'rail-cart-content', size: [32, 16, 32] },
        volume: { initial: 'solid', default_material: 'dark_limestone' },
        carvers: [
            { id: 'rail_line', type: 'mine_tunnel_network', half_width: 1, height: 3, rails: true, floor_material: 'stone', supports_every: 0, lantern_every: 0, corridors: [[[10, 6, 10], [14, 6, 10]]] },
        ],
        structures: [
            { id: 'spawn', asset: 'marker.spawn', place: { mode: 'surface_at_xz', x: 10, z: 10, kind: 'floor', y_range: [5, 8], search_radius: 2, require_air_above: 2 }, required: true },
        ],
        content: {
            props: [
                { id: 'cart_crate', kind: 'repair-materials-crate', place_at: 'mine_cart', offset: [0.5, 0, 0] },
            ],
            rail_carts: [
                { id: 'mine_cart', railCell: [14, 6, 10], front: 'east', speed: 3.5, interactionRadius: 1.4, enabled: true },
            ],
            zones: [
                { id: 'cart_zone', type: 'interact', place_at: 'cart_crate', prompt: 'Inspect' },
            ],
        },
    })

    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))
    assert.equal(result.meta.railCarts.length, 1)
    assert.deepEqual(result.meta.railCarts[0], {
        id: 'mine_cart',
        railCell: { x: 14, y: 6, z: 10 },
        front: 'east',
        speed: 3.5,
        interactionRadius: 1.4,
        enabled: true,
    })
    assert.deepEqual(result.report.resolvedObjects.mine_cart, { x: 14.5, y: 6, z: 10.5 })
    assert.ok(result.report.resolvedObjects.cart_crate)
    assert.ok(result.report.resolvedObjects.cart_zone)
    assert.ok(result.report.placements.some((placement) => placement.kind === 'content_rail_cart' && placement.id === 'mine_cart'))
})

test('worldgen rail-cart content fails closed for invalid required carts', () => {
    const missingRail = compileWorldSpec({
        version: 1,
        world: { id: 'bad_rail_cart_content', name: 'Bad Rail Cart Content', type: 'surface', seed: 'bad-rail-cart-content', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            rail_carts: [{ id: 'missing_rail_cart', railCell: [10, 6, 10], front: 'east' }],
        },
    })

    assert.equal(missingRail.report.status, 'failed')
    assert.ok(missingRail.report.errors.some((error) => error.code === 'invalid_feature' && error.path === '$.content.rail_carts[0].railCell'))
    assert.equal(missingRail.meta.railCarts.length, 0)

    const badFacing = compileWorldSpec({
        version: 1,
        world: { id: 'bad_rail_cart_facing', name: 'Bad Rail Cart Facing', type: 'surface', seed: 'bad-rail-cart-facing', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            rail_carts: [{ id: 'bad_facing_cart', railCell: [10, 6, 10], front: 'uphill' }],
        },
    })

    assert.equal(badFacing.report.status, 'failed')
    assert.ok(badFacing.report.errors.some((error) => error.code === 'invalid_feature' && error.path === '$.content.rail_carts[0].front'))
    assert.equal(badFacing.meta.railCarts.length, 0)
})

test('content placement cycles fail closed', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'content_cycle', name: 'Content Cycle', type: 'surface', seed: 'content-cycle', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            props: [
                { id: 'cycle_a', kind: 'flower', place_at: 'cycle_b' },
                { id: 'cycle_b', kind: 'flower-2', place_at: 'cycle_a' },
            ],
        },
    })

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) => error.code === 'ref_cycle'))
    assert.equal(result.meta.props.some((prop) => prop.id === 'cycle_a' || prop.id === 'cycle_b'), false)
})

test('generated quest and shop scripts escape adversarial author strings', async () => {
    const tricky = 'Quote " backtick ` newline\n interpolation ${player.kill()}'
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'script_escape_content', name: 'Script Escape Content', type: 'surface', seed: 'script-escape-content', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            zones: [{ id: 'trade_zone', type: 'interact', place_at_xz: [9, 8], prompt: tricky }],
            npcs: [{ id: 'quest_npc_odd', model: 'keeper', name: tricky, place_at_xz: [8, 8], interactionEnabled: true, scriptSource: '' }],
            shops: [{
                id: 'odd-shop:id',
                target: 'trade_zone',
                title: tricky,
                npc: { name: tricky, avatar: 'keeper' },
                items: [{ id: 'odd-item', name: tricky, description: tricky, resource: 'heal-potion', buyPrice: 1 }],
            }],
            quests: [{
                id: 'odd.quest:id',
                target: 'quest_npc_odd',
                title: tricky,
                requiredItems: [{ id: 'lost-relic', quantity: 1 }],
                reward: { items: [{ id: 'held-torch', quantity: 1, options: { name: tricky, category: 'tools', icon: 'torch' } }] },
                dialogue: { start: tricky, complete: tricky, done: tricky },
                speaker: { name: tricky, avatar: 'keeper' },
            }],
        },
    })
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))

    const harness = makeHarness([...result.meta.scripts, ...npcScriptEntries(result.meta.npcs)])
    harness.sys.init?.(harness.world)
    await flushMicrotasks()
    assert.equal(harness.sys.broken.size, 0)

    harness.interact('trade_zone')
    await harness.tick(0.1)
    assert.equal(harness.tradeRequests[0]?.title, tricky)
    assert.equal(harness.tradeRequests[0]?.items[0]?.name, tricky)

    harness.interact(npcInteractionZoneId({ id: 'quest_npc_odd' }))
    await harness.tick(0.1)
    assert.equal(harness.dialogueRequests.length, 1)
})

test('optional rich content warnings do not emit broken generated scripts', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'optional_rich_bad', name: 'Optional Rich Bad', type: 'surface', seed: 'optional-rich-bad', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [5, 5] }],
        content: {
            shops: [{
                id: 'missing_target_shop',
                target: 'missing_zone',
                required: false,
                items: [{ id: 'heal', name: 'Healing Potion', resource: 'heal-potion', buyPrice: 8 }],
            }],
            quests: [{
                id: 'missing_target_quest',
                target: 'missing_npc',
                required: false,
                requiredItems: [{ id: 'lost-relic', quantity: 1 }],
            }],
            pickups: [{
                id: 'bad_optional_pickup',
                kind: 'lost-relic',
                place_at: 'missing_anchor',
                required: false,
            }],
        },
    })

    assert.equal(result.report.status, 'warning', diagnosticSummary(result.report.errors, result.report.warnings))
    assert.equal(result.report.errors.length, 0)
    assert.ok(result.report.warnings.some((warning) => warning.path === '$.content.shops[0].target'))
    assert.ok(result.report.warnings.some((warning) => warning.path === '$.content.quests[0].target'))
    assert.ok(result.report.warnings.some((warning) => warning.path === '$.content.pickups[0].place_at'))
    assert.equal(result.meta.scripts.some((script) => script.id.startsWith('worldgen:shop:')), false)
    assert.equal(result.meta.scripts.some((script) => script.id.startsWith('worldgen:quest:')), false)
    assert.equal(result.meta.scripts.some((script) => script.id === 'worldgen:content:pickups'), false)
})

test('rich content rejects authored script ids that collide with generated and NPC runtime scripts', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'script_collision', name: 'Script Collision', type: 'surface', seed: 'script-collision', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            npcs: [{ id: 'merchant', template: 'trader', place_at_xz: [8, 8] }],
            pickups: [{ id: 'field_potion', kind: 'heal-potion', place_at_xz: [10, 8] }],
            scripts: [
                { id: 'worldgen:content:pickups', source: `log('duplicate generated')` },
                { id: 'npc-script:merchant', source: `log('duplicate npc')` },
            ],
        },
    })

    assert.equal(result.report.status, 'failed')
    const duplicateErrors = result.report.errors.filter((error) => error.code === 'duplicate_id')
    assert.equal(duplicateErrors.length, 2, diagnosticSummary(result.report.errors))
    assert.equal(result.meta.scripts.filter((script) => script.id === 'worldgen:content:pickups').length, 1)
    assert.equal(result.meta.scripts.some((script) => script.source.includes('duplicate generated')), false)
    assert.equal(result.meta.scripts.some((script) => script.id === 'npc-script:merchant'), false)
})

test('generated NPC-bound shops replace marked template starter shops instead of stacking handlers', async () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'template_shop_replace', name: 'Template Shop Replace', type: 'surface', seed: 'template-shop-replace', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            npcs: [{ id: 'merchant', template: 'trader', name: 'Marked Trader', place_at_xz: [8, 8] }],
            shops: [{
                id: 'merchant_shop',
                target: 'merchant',
                title: 'Generated Goods',
                items: [{ id: 'mana', name: 'Mana Potion', resource: 'mana-potion', buyPrice: 9, stock: 2 }],
            }],
        },
    })
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))

    const merchant = result.meta.npcs.find((npc) => npc.id === 'merchant')
    assert.ok(merchant)
    assert.ok(merchant.scriptSource.includes('SHOP_merchant_shop'))
    assert.equal(merchant.scriptSource.includes('Arrow bundle'), false, 'starter trader shop was replaced')

    const harness = makeHarness([...result.meta.scripts, ...npcScriptEntries(result.meta.npcs)])
    harness.sys.init?.(harness.world)
    harness.interact(npcInteractionZoneId({ id: 'merchant' }))
    await harness.tick(0.1)
    assert.deepEqual(harness.tradeRequests.map((request) => request.id), ['merchant_shop'])
})

test('environment metadata place_at_xz uses the shared surface resolver', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'metadata_surface_y', name: 'Metadata Surface Y', type: 'surface', seed: 'metadata-surface-y', size: [32, 24, 32], defaultGroundY: 6 },
        terrain: { base_height: 6 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            environment: {
                soundSources: [{ id: 'wind_source', soundId: 'amb.wind', place_at_xz: [12, 12] }],
                soundZones: [{ id: 'wind_zone', soundId: 'amb.wind', place_at_xz: [14, 12] }],
                weatherZones: [{ id: 'mist_zone', presetId: 'fog', place_at_xz: [16, 12], offset_y: 3.5 }],
            },
        },
    })

    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))
    assert.equal(result.meta.soundSources[0]?.position.y, 7)
    assert.equal(result.meta.soundZones[0]?.min.y, 5)
    assert.equal(result.meta.weatherZones[0]?.position.y, 10.5)
})

test('environment metadata rejects unknown required FX zone presets', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'bad_fx_preset', name: 'Bad FX Preset', type: 'surface', seed: 'bad-fx-preset', size: [32, 24, 32], defaultGroundY: 6 },
        terrain: { base_height: 6 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            environment: {
                weatherZones: [{ id: 'bad_fx_zone', presetId: 'falling_leafs_typo', place_at_xz: [16, 12] }],
            },
        },
    })

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) => error.path === '$.content.environment.weatherZones[0].presetId'))
    assert.equal(result.meta.weatherZones.length, 0)
})

test('skipIfInInventory suppresses startup pickup spawn without marking it taken', async () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'pickup_skip_inventory', name: 'Pickup Skip Inventory', type: 'surface', seed: 'pickup-skip-inventory', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            pickups: [{
                id: 'field_potion',
                kind: 'heal-potion',
                place_at_xz: [8, 8],
                skipIfInInventory: true,
            }],
        },
    })
    assert.equal(result.report.status, 'ok', diagnosticSummary(result.report.errors, result.report.warnings))

    const harness = makeHarness(result.meta.scripts)
    harness.addInventoryItem('heal-potion', 1)
    harness.sys.init?.(harness.world)
    await flushMicrotasks()

    assert.equal(harness.pickupSpawns.length, 0)
    assert.equal(harness.flag('worldgen.pickup.field_potion.taken'), undefined)
})

test('invalid generated dialogue and cinematic payloads fail closed before scripts or metadata are emitted', () => {
    const result = compileWorldSpec({
        version: 1,
        world: { id: 'invalid_rich_payloads', name: 'Invalid Rich Payloads', type: 'surface', seed: 'invalid-rich-payloads', size: [32, 24, 32], defaultGroundY: 5 },
        terrain: { base_height: 5 },
        anchors: [{ id: 'spawn', place_at_xz: [4, 4] }],
        content: {
            npcs: [{ id: 'quest_giver', model: 'keeper', place_at_xz: [8, 8] }],
            quests: [{
                id: 'bad_quest',
                target: 'quest_giver',
                requiredItems: [{ id: 'lost-relic', quantity: 1 }],
                dialogue: {
                    start: [{ text: 'Choose carefully.', choices: [{ id: 'accept' }] }],
                },
            }],
            cinematics: [{
                id: 'bad_intro',
                steps: [{ id: 'line', type: 'subtitle', wait: true, duration: 2 }],
            }],
        },
    })

    assert.equal(result.report.status, 'failed')
    assert.ok(result.report.errors.some((error) => error.path === '$.content.quests[0].dialogue.start[0].choices[0].text'))
    assert.ok(result.report.errors.some((error) => error.path === '$.content.cinematics[0].steps[0].text'))
    assert.equal(result.meta.npcs.find((npc) => npc.id === 'quest_giver')?.scriptSource.includes('handleQuest_bad_quest'), false)
    assert.equal(result.meta.cinematics?.some((cinematic) => cinematic.id === 'bad_intro') ?? false, false)
})

interface Harness {
    sys: ReturnType<typeof createScriptEngineSystem>
    world: GameWorld
    pickupSpawns: { kind: string; pos: VoxelCoord; opts?: PickupSpawnOptions }[]
    tradeRequests: TradeRequest[]
    dialogueRequests: unknown[]
    audioPlays: string[]
    readonly gold: number
    interact(targetId: string): void
    takePickup(kind: string, pickupId?: string): void
    addInventoryItem(id: string, quantity: number): void
    inventoryCount(id: string): number
    flag(id: string): unknown
    tick(seconds: number): Promise<void>
}

function makeHarness(scripts: readonly ScriptEntry[]): Harness {
    const world = createGameWorld()
    const pickupSpawns: { kind: string; pos: VoxelCoord; opts?: PickupSpawnOptions }[] = []
    const tradeRequests: TradeRequest[] = []
    const dialogueRequests: unknown[] = []
    const audioPlays: string[] = []
    const livePickupIds = new Set<string>()
    const items: Record<string, { quantity: number }> = {}
    let gold = 0
    let arrows = 0

    const audio: AudioFacade = {
        play(id) { audioPlays.push(id); return { id } },
        stop() {},
    }
    const chunks: ChunksFacade = {
        getBlock: () => 0,
        setBlock() {},
        fillBlocks() {},
    }
    const player: PlayerFacade = {
        getPosition: () => ({ x: 8, y: 7, z: 8 }),
        getGold: () => gold,
        getArrows: () => arrows,
        getInventoryItemCount: (itemId) => items[itemId]?.quantity ?? 0,
        getInventoryItems: () => Object.entries(items).map(([id, item]) => ({ id, quantity: item.quantity, name: id, category: 'quest', icon: 'item' })),
        addInventoryItem(itemId, quantity = 1) {
            items[itemId] = { quantity: (items[itemId]?.quantity ?? 0) + quantity }
            return true
        },
        removeInventoryItem(itemId, quantity = 1) {
            const current = items[itemId]?.quantity ?? 0
            if (current < quantity) return false
            const next = current - quantity
            if (next > 0) items[itemId] = { quantity: next }
            else delete items[itemId]
            return true
        },
        getSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setAbility() {},
        setGold(amount) { gold = amount },
        setArrows(amount) { arrows = amount },
        restoreMana: () => true,
        teleport() {},
        kill() {},
        getCheckpoint: () => null,
        setCheckpoint() {},
        clearCheckpoint() {},
    }
    const pickups: PickupsFacade = {
        spawn(kind, pos, opts) {
            if (opts?.id && livePickupIds.has(opts.id)) return opts.id
            pickupSpawns.push({ kind, pos, opts })
            if (opts?.id) livePickupIds.add(opts.id)
            return opts?.id ?? `pickup-${pickupSpawns.length}`
        },
        despawn(id) { return livePickupIds.delete(id) },
        exists(id) { return livePickupIds.has(id) },
    }
    const pistons: PistonsFacade = {
        setEnabled: () => true,
        isEnabled: () => true,
        flip: () => true,
        list: () => [],
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: () => true,
        isActive: () => true,
        setActive: () => true,
    }
    const log: LogFacade = { log() {} }
    const trade: TradeFacade = {
        async open(request) {
            tradeRequests.push(request)
            return { status: 'cancelled' }
        },
    }

    const sys = createScriptEngineSystem({
        audio, chunks, player, pickups, pistons, zone, log, trade,
        ui: {
            say() {},
            async dialogue(request) {
                dialogueRequests.push(request)
                return {}
            },
        },
        getScripts: () => scripts,
        onScriptError: (entry, where, err) => {
            throw new Error(`[${entry.id}@${where}] ${err instanceof Error ? err.message : String(err)}`)
        },
    })

    return {
        sys,
        world,
        pickupSpawns,
        tradeRequests,
        dialogueRequests,
        audioPlays,
        get gold() { return gold },
        interact(targetId) {
            pushScriptTriggerEvent(world, {
                kind: 'input',
                action: 'interact',
                edge: 'pressed',
                targetId,
                zoneId: targetId,
                point: { x: 0, y: 0, z: 0 },
                entityId: 1,
            })
        },
        takePickup(kind, pickupId) {
            if (pickupId) livePickupIds.delete(pickupId)
            pushScriptTriggerEvent(world, {
                kind: 'pickup-taken',
                pickupKind: kind,
                pickupId,
                amount: 1,
                position: { x: 0, y: 0, z: 0 },
                entityId: 2,
            })
        },
        addInventoryItem(itemId, quantity) {
            items[itemId] = { quantity: (items[itemId]?.quantity ?? 0) + quantity }
        },
        inventoryCount(id) {
            return items[id]?.quantity ?? 0
        },
        flag(id) {
            return sys.flags.get(id)
        },
        async tick(seconds) {
            const slice = 0.05
            const steps = Math.max(1, Math.round(seconds / slice))
            for (let i = 0; i < steps; i += 1) {
                sys.update(world, slice)
                await flushMicrotasks()
            }
        },
    }
}

function diagnosticSummary(
    errors: readonly { code: string; message: string }[],
    warnings: readonly { code: string; message: string }[] = [],
): string {
    return [...errors, ...warnings].map((entry) => `${entry.code}: ${entry.message}`).join('\n')
}

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve))

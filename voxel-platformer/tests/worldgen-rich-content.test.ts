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

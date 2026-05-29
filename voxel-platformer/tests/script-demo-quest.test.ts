import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
    TradeResult,
    VoxelCoord,
    ZoneFacade,
} from '../src/engine/script/types'
import {
    createGameWorld,
    pushScriptTriggerEvent,
    type GameWorld,
} from '../src/engine/ecs/world'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'

const QUEST_SOURCE_PATH = resolve(process.cwd(), 'examples', 'scripts', 'demo-quest.js')
const QUEST_SOURCE = readFileSync(QUEST_SOURCE_PATH, 'utf8')

interface Harness {
    sys: ReturnType<typeof createScriptEngineSystem>
    world: GameWorld
    log: string[]
    audioPlays: string[]
    pickupSpawns: { kind: string; pos: VoxelCoord; opts?: PickupSpawnOptions }[]
    popupMessages: { targetId: string; message: string; seconds?: number }[]
    dialogueRequests: unknown[]
    tradeRequests: unknown[]
    chunkSets: { x: number; y: number; z: number; block: number }[]
    interact: (targetId: string) => void
    takePickup: (kind: string, pickupId?: string, amount?: number, position?: VoxelCoord) => void
    die: (reason?: string) => void
    tick: (seconds: number) => Promise<void>
}

function makeHarness(opts: {
    dialogueChoiceId?: string
    tradeResult?: TradeResult
} = {}): Harness {
    const world = createGameWorld()
    const log: string[] = []
    const audioPlays: string[] = []
    const pickupSpawns: { kind: string; pos: VoxelCoord; opts?: PickupSpawnOptions }[] = []
    const popupMessages: { targetId: string; message: string; seconds?: number }[] = []
    const dialogueRequests: unknown[] = []
    const tradeRequests: unknown[] = []
    const chunkSets: { x: number; y: number; z: number; block: number }[] = []
    const livePickupIds = new Set<string>()

    const audio: AudioFacade = {
        play(id) { audioPlays.push(id); return { id } },
        stop() {},
    }
    const chunks: ChunksFacade = {
        getBlock: () => 0,
        setBlock(x, y, z, block) { chunkSets.push({ x, y, z, block }) },
        fillBlocks() {},
    }
    const player: PlayerFacade = {
        getPosition: () => ({ x: 12, y: 5, z: 12 }),
        getGold: () => 0,
        getArrows: () => 0,
        getSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setSettings: () => copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        setAbility() {},
        setGold() {},
        setArrows() {},
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
            return opts?.id ?? `id-${kind}-${pickupSpawns.length}`
        },
        despawn(id) { return livePickupIds.delete(id) },
        exists(id) { return livePickupIds.has(id) },
    }
    const pistons: PistonsFacade = {
        setEnabled() { return false },
        isEnabled() { return false },
        flip() { return false },
        list() { return [] },
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: () => true,
        isActive: () => true,
        setActive: () => true,
    }
    const logFacade: LogFacade = {
        log(msg) { log.push(msg) },
    }
    const trade: TradeFacade = {
        async open(request) {
            tradeRequests.push(request)
            return opts.tradeResult ?? { status: 'cancelled' }
        },
    }

    // Capture dayCycle calls so the test can assert dusk-on-completion.
    const dayCycleCalls: { method: string; args: unknown[] }[] = []
    let cycleHour = 8
    let cycleEnabled = true

    const sys = createScriptEngineSystem({
        audio, chunks, player, pickups, pistons, trade, zone, log: logFacade,
        ui: {
            say(targetId, message, opts) {
                popupMessages.push({ targetId, message, seconds: opts?.seconds })
            },
            async dialogue(request) {
                dialogueRequests.push(request)
                const choices = request.lines.find((line) => line.choices && line.choices.length > 0)?.choices ?? []
                const preferred = opts.dialogueChoiceId
                    ? choices.findIndex((choice) => choice.id === opts.dialogueChoiceId && !choice.disabled)
                    : -1
                const firstEnabled = preferred >= 0 ? preferred : choices.findIndex((choice) => !choice.disabled)
                const index = firstEnabled >= 0 ? firstEnabled : 0
                const choice = choices[index]
                return choice
                    ? { choiceId: choice.id, choiceIndex: index, text: choice.text }
                    : {}
            },
        },
        dayCycle: {
            getHour() { return cycleHour },
            setHour(h) { cycleHour = h; dayCycleCalls.push({ method: 'setHour', args: [h] }) },
            isEnabled() { return cycleEnabled },
            setEnabled(on) { cycleEnabled = on; dayCycleCalls.push({ method: 'setEnabled', args: [on] }) },
            setSpeed(sec) { dayCycleCalls.push({ method: 'setSpeed', args: [sec] }) },
        },
        getScripts: () => [{
            id: 'demo-quest',
            name: 'demo-quest.js',
            source: QUEST_SOURCE,
        } satisfies ScriptEntry],
        onScriptError: (entry, where, err) => {
            throw new Error(`[${entry.id}@${where}] ${err instanceof Error ? err.message : String(err)}`)
        },
    })
    ;(sys as unknown as { __dayCycleCalls: typeof dayCycleCalls }).__dayCycleCalls = dayCycleCalls

    return {
        sys,
        world,
        log,
        audioPlays,
        pickupSpawns,
        popupMessages,
        dialogueRequests,
        tradeRequests,
        chunkSets,
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
        takePickup(kind, pickupId, amount = 1, position = { x: 0, y: 0, z: 0 }) {
            if (pickupId) livePickupIds.delete(pickupId)
            pushScriptTriggerEvent(world, {
                kind: 'pickup-taken',
                pickupKind: kind,
                pickupId,
                amount,
                position,
                entityId: 2,
            })
        },
        die(reason = 'fell-into-void') {
            world.deathSignal = reason as GameWorld['deathSignal']
        },
        async tick(seconds: number) {
            const slice = 0.05
            const steps = Math.max(1, Math.round(seconds / slice))
            for (let i = 0; i < steps; i++) {
                sys.update(world, slice)
                await flushMicrotasks()
            }
        },
    }
}

const flushMicrotasks = () => new Promise<void>((r) => setImmediate(r))

const KEEPER_ZONE = 'zone.demo.keeper'
const SHARDS = [
    'demo.quest.shard.stairs',
    'demo.quest.shard.wall',
    'demo.quest.shard.island',
] as const

test('demo quest: compiles cleanly and introduces Keeper Arlen on level-start', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    await flushMicrotasks()
    assert.equal(h.sys.broken.size, 0)
    assert.ok(h.log[0]?.includes('Keeper Arlen'))
    assert.equal(h.pickupSpawns.length, 0, 'quest items wait until the NPC starts the quest')
    assert.deepEqual(h.chunkSets[h.chunkSets.length - 1], { x: 9, y: 5, z: 9, block: 15 })
})

test('demo quest: talking to the keeper starts the quest and spawns three shards', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(KEEPER_ZONE)
    await h.tick(0.1)

    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), 'active')
    assert.equal(h.pickupSpawns.length, 3)
    assert.deepEqual(h.pickupSpawns.map((p) => p.opts?.id), [...SHARDS])
    assert.ok(h.pickupSpawns.every((p) => p.kind === 'sun-shard'))
    assert.deepEqual(h.pickupSpawns.find((p) => p.opts?.id === SHARDS[1])?.pos, { x: 4, y: 5, z: 7 })
    assert.ok(h.audioPlays.includes('sfx.quest.chime'))
    assert.ok(h.dialogueRequests.some((request) =>
        JSON.stringify(request).includes('plaza lantern'),
    ))
})

test('demo quest: keeper trade option opens the arrow shop', async () => {
    const h = makeHarness({
        dialogueChoiceId: 'trade',
        tradeResult: {
            status: 'bought',
            itemId: 'arrows.bundle',
            itemName: 'Arrow bundle',
            quantity: 2,
            unitSize: 5,
            spent: { gold: 6 },
            gained: { arrows: 10 },
            inventory: { gold: 4, arrows: 10 },
        },
    })
    h.sys.init?.(h.world)
    h.interact(KEEPER_ZONE)
    await h.tick(0.1)

    assert.equal(h.tradeRequests.length, 1)
    const request = h.tradeRequests[0] as { title?: string; items?: { id?: string; resource?: string; unitSize?: number }[] }
    assert.equal(request.title, "Keeper Arlen's Supplies")
    assert.equal(request.items?.[0]?.id, 'arrows.bundle')
    assert.equal(request.items?.[0]?.resource, 'arrows')
    assert.equal(request.items?.[0]?.unitSize, 5)
    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), undefined)
    assert.ok(h.popupMessages.some((msg) => msg.message.includes('10 arrow')))
})

test('demo quest: collecting all shards marks the quest ready to turn in', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(KEEPER_ZONE)
    await h.tick(0.1)

    h.takePickup('sun-shard', SHARDS[0])
    await h.tick(0.1)
    assert.equal(h.sys.flags.get(`${SHARDS[0]}.collected`), true)
    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), 'active')

    h.takePickup('sun-shard', SHARDS[1])
    h.takePickup('sun-shard', SHARDS[2])
    await h.tick(0.1)
    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), 'ready')
    assert.ok(h.log.some((l) => l.includes('Return to Keeper Arlen')))
})

test('demo quest: returning to the keeper completes the quest and rewards gold', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(KEEPER_ZONE)
    await h.tick(0.1)
    for (const shard of SHARDS) h.takePickup('sun-shard', shard)
    await h.tick(0.1)

    h.interact(KEEPER_ZONE)
    await h.tick(0.1)

    // Quest completion shifts the sky to dusk and pauses the cycle —
    // a visible demonstration of the new dayCycle.* bindings.
    const calls = (h.sys as unknown as { __dayCycleCalls: { method: string; args: unknown[] }[] }).__dayCycleCalls
    assert.ok(calls.some((c) => c.method === 'setHour' && c.args[0] === 19),
        'completion should call dayCycle.setHour(19)')
    assert.ok(calls.some((c) => c.method === 'setEnabled' && c.args[0] === false),
        'completion should pause the day cycle')

    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), 'done')
    const reward = h.pickupSpawns.find((p) => p.opts?.id === 'demo.quest.reward.gold')
    assert.equal(reward?.kind, 'coin')
    assert.equal(reward?.opts?.amount, 50)
    assert.ok(h.audioPlays.includes('sfx.quest.fanfare'))
    assert.equal(typeof h.sys.flags.get('demo.quest.completedAt'), 'number')
    assert.ok(h.chunkSets.some((edit) =>
        edit.x === 9 && edit.y === 5 && edit.z === 9 && edit.block === 14,
    ), 'turn-in should replace the dead lantern with the lit torch block')
})

test('demo quest: shard pickup before the keeper asks does not progress', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.takePickup('sun-shard', SHARDS[0])
    await h.tick(0.1)

    assert.equal(h.sys.flags.get('demo.quest.keeper.state') ?? 'unknown', 'unknown')
    assert.equal(h.sys.flags.get(`${SHARDS[0]}.collected`), undefined)
})

test('demo quest: interacting after completion gives the finished dialogue', async () => {
    const h = makeHarness()
    const flagsMut = h.sys.flags as unknown as Map<string, unknown>
    flagsMut.set('demo.quest.keeper.state', 'done')
    h.sys.init?.(h.world)
    await flushMicrotasks()
    assert.deepEqual(h.chunkSets[h.chunkSets.length - 1], { x: 9, y: 5, z: 9, block: 14 })

    h.interact(KEEPER_ZONE)
    await h.tick(0.1)
    assert.ok(h.log.some((l) => l.includes('lantern holds')))
    assert.ok(h.dialogueRequests.some((request) =>
        JSON.stringify(request).includes('lantern holds'),
    ))
})

test('demo quest: player.died during active quest shows remaining-shard hint', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(KEEPER_ZONE)
    await h.tick(0.1)
    h.takePickup('sun-shard', SHARDS[0])
    await h.tick(0.1)

    h.die('fell-into-void')
    await h.tick(0.1)
    assert.ok(h.log.some((l) => l.includes('2 Sun Shard')))
})

test('demo quest: duplicate keeper entries do not advance beyond active or double-complete', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(KEEPER_ZONE)
    h.interact(KEEPER_ZONE)
    await h.tick(0.1)

    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), 'active')
    assert.equal(h.pickupSpawns.length, 3,
        'stable pickup ids keep repeated conversations from creating duplicate live shards')
})

test('demo quest: state progression survives apply()', async () => {
    const h = makeHarness()
    h.sys.init?.(h.world)
    h.interact(KEEPER_ZONE)
    await h.tick(0.1)
    h.takePickup('sun-shard', SHARDS[0])
    await h.tick(0.1)

    h.sys.apply()
    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), 'active')
    assert.equal(h.sys.flags.get(`${SHARDS[0]}.collected`), true)

    h.takePickup('sun-shard', SHARDS[1])
    h.takePickup('sun-shard', SHARDS[2])
    await h.tick(0.1)
    assert.equal(h.sys.flags.get('demo.quest.keeper.state'), 'ready')
})

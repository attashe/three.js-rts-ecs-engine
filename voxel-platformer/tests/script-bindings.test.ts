import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScriptContext } from '../src/engine/script/bindings'
import { createRuntime } from '../src/engine/script/runtime'
import type {
    AudioFacade,
    ChunksFacade,
    FlagValue,
    LogFacade,
    PickupsFacade,
    PistonsFacade,
    PlayerFacade,
    StonesFacade,
    TradeFacade,
    TravelFacade,
    UiFacade,
    VoxelCoord,
    ZoneFacade,
} from '../src/engine/script/types'
import {
    applyPlayerSettingsPatch,
    copyPlayerSettings,
    DEFAULT_PLAYER_SETTINGS,
    type PlayerAbilityKey,
    type PlayerSettings,
    type PlayerSettingsPatch,
} from '../src/game/player-settings'

// VoxelCoord is re-exported from world.ts via types.ts; the test imports
// it through that surface so the binding facade matches the real types.

function stubs() {
    const calls: Record<string, unknown[]> = {
        audioPlay: [], audioStop: [],
        chunksSet: [], chunksFill: [], chunksGet: [],
        playerTeleport: [], playerKill: [],
        playerSettings: [], playerAbility: [], playerGold: [], playerArrows: [],
        pickupSpawn: [], pickupDespawn: [], pickupExists: [],
        pistonSetEnabled: [], pistonIsEnabled: [], pistonFlip: [], pistonList: [],
        uiSay: [],
        uiClear: [],
        uiDialogue: [],
        tradeOpen: [],
        log: [],
        zoneContains: [],
    }
    const enabledPistons = new Map<string, boolean>()
    let pistonRoster: string[] = []
    let pistonFlipBlocks = false
    const livePickups = new Set<string>()
    let playerPos: VoxelCoord | null = { x: 1, y: 2, z: 3 }
    let gold = 7
    let arrows = 3
    let playerSettings: PlayerSettings = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    let savedCheckpoint: VoxelCoord | null = null

    const audio: AudioFacade = {
        play(id, opts) { calls.audioPlay.push({ id, opts }); return { id } },
        stop(handleOrId, opts) { calls.audioStop.push({ handleOrId, opts }) },
    }
    const chunks: ChunksFacade = {
        getBlock(x, y, z) { calls.chunksGet.push({ x, y, z }); return 0 },
        setBlock(x, y, z, b) { calls.chunksSet.push({ x, y, z, b }) },
        fillBlocks(min, max, b) { calls.chunksFill.push({ min, max, b }) },
    }
    const player: PlayerFacade = {
        getPosition() { return playerPos },
        getGold() { return gold },
        getArrows() { return arrows },
        getSettings() { return copyPlayerSettings(playerSettings) },
        setSettings(patch: PlayerSettingsPatch) {
            playerSettings = applyPlayerSettingsPatch(playerSettings, patch)
            calls.playerSettings.push(patch)
            return copyPlayerSettings(playerSettings)
        },
        setAbility(ability: PlayerAbilityKey, enabled: boolean) {
            playerSettings.abilities[ability] = enabled
            calls.playerAbility.push({ ability, enabled })
        },
        setGold(amount: number) { gold = amount; calls.playerGold.push(amount) },
        setArrows(amount: number) { arrows = amount; calls.playerArrows.push(amount) },
        teleport(x, y, z) { calls.playerTeleport.push({ x, y, z }) },
        kill(reason) { calls.playerKill.push({ reason }) },
        getCheckpoint() { return savedCheckpoint ? { ...savedCheckpoint } : null },
        setCheckpoint(pos) { savedCheckpoint = { x: pos.x, y: pos.y, z: pos.z } },
        clearCheckpoint() { savedCheckpoint = null },
    }
    const pickups: PickupsFacade = {
        spawn(kind, pos, opts) {
            calls.pickupSpawn.push({ kind, pos, opts })
            const id = opts?.id ?? `id-${kind}`
            livePickups.add(id)
            return id
        },
        despawn(id) {
            calls.pickupDespawn.push({ id })
            return livePickups.delete(id)
        },
        exists(id) {
            calls.pickupExists.push({ id })
            return livePickups.has(id)
        },
    }
    const pistons: PistonsFacade = {
        setEnabled(id, enabled) {
            calls.pistonSetEnabled.push({ id, enabled })
            if (!enabledPistons.has(id) && !pistonRoster.includes(id)) return false
            enabledPistons.set(id, enabled)
            return true
        },
        isEnabled(id) {
            calls.pistonIsEnabled.push({ id })
            if (enabledPistons.has(id)) return enabledPistons.get(id) ?? false
            return pistonRoster.includes(id)
        },
        flip(id) {
            calls.pistonFlip.push({ id })
            if (!pistonRoster.includes(id) && !enabledPistons.has(id)) return false
            if (pistonFlipBlocks) return false
            return true
        },
        list() {
            calls.pistonList.push({})
            return [...pistonRoster]
        },
    }
    const ui: UiFacade = {
        say(targetId, message, opts) { calls.uiSay.push({ targetId, message, opts }) },
        clear(targetId) { calls.uiClear.push({ targetId: targetId ?? null }) },
        async dialogue(request) {
            calls.uiDialogue.push(request)
            return { choiceId: request.lines[0]?.choices?.[0]?.id, choiceIndex: 0, text: request.lines[0]?.choices?.[0]?.text }
        },
    }
    const trade: TradeFacade = {
        async open(request) {
            calls.tradeOpen.push(request)
            return {
                status: 'bought',
                itemId: request.items[0]?.id ?? 'missing',
                itemName: request.items[0]?.name ?? 'Missing',
                quantity: 2,
                unitSize: request.items[0]?.unitSize ?? 1,
                spent: { gold: 6 },
                gained: { arrows: 10 },
                inventory: { gold: 1, arrows: 13 },
            }
        },
    }
    const zone: ZoneFacade = {
        contains(zoneId, who) { calls.zoneContains.push({ zoneId, who }); return zoneId === 'inside' },
        exists: () => true,
        isActive: () => true,
        setActive: () => true,
    }
    const log: LogFacade = {
        log(message, kind) { calls.log.push({ message, kind }) },
    }
    return {
        calls,
        deps: { audio, chunks, player, pickups, pistons, ui, trade, zone, log },
        setPlayerPos(p: VoxelCoord | null) { playerPos = p },
        setGold(g: number) { gold = g },
        setArrows(a: number) { arrows = a },
        setPistonRoster(ids: string[]) { pistonRoster = [...ids] },
        setPistonFlipBlocks(blocked: boolean) { pistonFlipBlocks = blocked },
    }
}

test('log binding forwards through the facade', () => {
    const s = stubs()
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...s.deps, flags: new Map() })
    ctx.log("hello", "warn")
    assert.deepEqual(s.calls.log, [{ message: "hello", kind: "warn" }])
})

test('chunks bindings forward x/y/z and block index', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    ctx.chunks.setBlock(1, 2, 3, 4)
    ctx.chunks.fillBlocks({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, 5)
    ctx.chunks.getBlock(7, 8, 9)
    assert.deepEqual(s.calls.chunksSet, [{ x: 1, y: 2, z: 3, b: 4 }])
    assert.deepEqual(s.calls.chunksFill, [{ min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 }, b: 5 }])
    assert.deepEqual(s.calls.chunksGet, [{ x: 7, y: 8, z: 9 }])
})

test('audio bindings forward id and opts', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    const handle = ctx.audio.play('sfx.gate', { volume: 0.5, fade: 1.5, loop: true })
    ctx.audio.stop(handle, { fade: 0.5 })
    assert.deepEqual(s.calls.audioPlay, [{ id: 'sfx.gate', opts: { volume: 0.5, fade: 1.5, loop: true } }])
    assert.equal(Array.isArray(s.calls.audioStop) && s.calls.audioStop.length, 1)
})

test('travel bindings forward location changes and reload requests', () => {
    const s = stubs()
    const calls: unknown[] = []
    const travel: TravelFacade = {
        to(levelId, opts) { calls.push({ type: 'to', levelId, opts }) },
        reload(opts) { calls.push({ type: 'reload', opts }) },
    }
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, travel, flags: new Map() })
    ctx.travel.to('basement', { arrivalId: 'entry' })
    ctx.travel.reload({ arrivalId: 'checkpoint' })
    assert.deepEqual(calls, [
        { type: 'to', levelId: 'basement', opts: { arrivalId: 'entry' } },
        { type: 'reload', opts: { arrivalId: 'checkpoint' } },
    ])
})

test('player bindings: position is live, teleport/kill forward', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    assert.deepEqual(ctx.player.position, { x: 1, y: 2, z: 3 })
    assert.equal(ctx.player.alive, true)
    s.setPlayerPos({ x: 9, y: 9, z: 9 })
    assert.deepEqual(ctx.player.position, { x: 9, y: 9, z: 9 })
    s.setPlayerPos(null)
    // Sentinel position: NaN coords so AABB checks short-circuit
    // without authors having to null-guard. alive is the explicit
    // "is there a player" flag.
    const dead = ctx.player.position
    assert.ok(Number.isNaN(dead.x) && Number.isNaN(dead.y) && Number.isNaN(dead.z))
    assert.equal(ctx.player.alive, false)
    assert.equal(ctx.player.inventory.gold, 7)
    assert.equal(ctx.player.inventory.arrows, 3)
    s.setGold(42)
    s.setArrows(11)
    assert.equal(ctx.player.inventory.gold, 42)
    assert.equal(ctx.player.inventory.arrows, 11)
    ctx.player.teleport(5, 5, 5)
    ctx.player.kill('test')
    assert.deepEqual(s.calls.playerTeleport, [{ x: 5, y: 5, z: 5 }])
    assert.deepEqual(s.calls.playerKill, [{ reason: 'test' }])
})

test('player settings bindings expose live ability and parameter mutation', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })

    assert.equal(ctx.player.settings.abilities.bow, true)
    ctx.player.setAbility('bow', false)
    assert.deepEqual(s.calls.playerAbility, [{ ability: 'bow', enabled: false }])
    assert.equal(ctx.player.settings.abilities.bow, false)

    const next = ctx.player.setSettings({
        inventory: { gold: 12, arrows: 6 },
        moveSpeed: 7.5,
        torch: { intensity: 3.25, castsShadow: false },
    })
    assert.equal(next.inventory.gold, 12)
    assert.equal(next.inventory.arrows, 6)
    assert.equal(next.moveSpeed, 7.5)
    assert.equal(next.torch.intensity, 3.25)
    assert.equal(next.torch.castsShadow, false)
    ctx.player.setGold(99)
    ctx.player.setArrows(4)
    assert.deepEqual(s.calls.playerGold, [99])
    assert.deepEqual(s.calls.playerArrows, [4])
})

test('player.position sentinel makes AABB checks fail naturally', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    s.setPlayerPos(null)
    const pos = ctx.player.position
    // The geom.box helper is what scripts actually call — verify the
    // sentinel propagates through it as "false, please skip".
    const inside = ctx.geom.box({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 10 }, pos)
    assert.equal(inside, false)
})

test('time.delta is the most recent advance(dt) input', () => {
    const s = stubs()
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...s.deps, flags: new Map() })
    assert.equal(ctx.time.delta, 0, 'zero before any tick')
    runtime.advance(0.05)
    assert.ok(Math.abs(ctx.time.delta - 0.05) < 1e-9)
    runtime.advance(0.1)
    assert.ok(Math.abs(ctx.time.delta - 0.1) < 1e-9)
})

test('geom.box inclusive-min exclusive-max + distSq', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    const min = { x: 0, y: 0, z: 0 }
    const max = { x: 2, y: 2, z: 2 }
    assert.equal(ctx.geom.box(min, max, { x: 0, y: 0, z: 0 }), true,  'min corner: inclusive')
    assert.equal(ctx.geom.box(min, max, { x: 1.5, y: 1, z: 1 }), true)
    assert.equal(ctx.geom.box(min, max, { x: 2, y: 1, z: 1 }), false, 'max corner: exclusive')
    assert.equal(ctx.geom.box(min, max, { x: -1, y: 0, z: 0 }), false)
    assert.equal(ctx.geom.distSq({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 25)
    assert.equal(ctx.geom.distSq({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }), 0)
})

test('pickups.spawn forwards and returns a handle id', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    const id = ctx.pickups.spawn('coin', { x: 1, y: 1, z: 1 }, { amount: 5 })
    assert.equal(id, 'id-coin')
    assert.deepEqual(s.calls.pickupSpawn, [{ kind: 'coin', pos: { x: 1, y: 1, z: 1 }, opts: { amount: 5 } }])
})

test('ui.say forwards target, message, and display options', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    ctx.ui.say('zone.demo.keeper', 'hello there', { seconds: 4 })
    assert.deepEqual(s.calls.uiSay, [{
        targetId: 'zone.demo.keeper',
        message: 'hello there',
        opts: { seconds: 4 },
    }])
})

test('ui.clear forwards target id (per-target dismissal)', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    ctx.ui.clear('zone.demo.keeper')
    assert.deepEqual(s.calls.uiClear, [{ targetId: 'zone.demo.keeper' }])
})

test('ui.clear with no argument forwards a sweep-all request', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    ctx.ui.clear()
    assert.deepEqual(s.calls.uiClear, [{ targetId: null }])
})

test('player.setCheckpoint with an explicit position writes through the facade', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    ctx.player.setCheckpoint({ x: 4, y: 5, z: 6 })
    assert.deepEqual(ctx.player.checkpoint, { x: 4, y: 5, z: 6 })
})

test('player.setCheckpoint with no arg uses the current player position', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    s.setPlayerPos({ x: 9, y: 8, z: 7 })
    ctx.player.setCheckpoint()
    assert.deepEqual(ctx.player.checkpoint, { x: 9, y: 8, z: 7 })
})

test('player.setCheckpoint with no arg while dead is a no-op (no checkpoint, no throw)', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    s.setPlayerPos(null)
    ctx.player.setCheckpoint()
    assert.equal(ctx.player.checkpoint, null)
})

test('player.setCheckpoint rejects non-finite coordinates (NaN / Infinity)', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    ctx.player.setCheckpoint({ x: 1, y: 2, z: 3 })
    ctx.player.setCheckpoint({ x: NaN, y: 0, z: 0 })
    assert.deepEqual(ctx.player.checkpoint, { x: 1, y: 2, z: 3 }, 'invalid input must not corrupt the saved checkpoint')
})

test('player.clearCheckpoint resets checkpoint state', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    ctx.player.setCheckpoint({ x: 1, y: 2, z: 3 })
    ctx.player.clearCheckpoint()
    assert.equal(ctx.player.checkpoint, null)
})

test('pickups.despawn / pickups.exists forward to the facade and reflect live state', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    const id = ctx.pickups.spawn('coin', { x: 0, y: 0, z: 0 }, { id: 'gold.A' })
    assert.equal(id, 'gold.A')
    assert.equal(ctx.pickups.exists('gold.A'), true)
    assert.equal(ctx.pickups.despawn('gold.A'), true)
    assert.equal(ctx.pickups.exists('gold.A'), false)
    assert.equal(ctx.pickups.despawn('gold.A'), false, 'second despawn of the same id is a no-op')
    assert.equal(ctx.pickups.despawn('never.spawned'), false)
    assert.deepEqual(s.calls.pickupDespawn, [
        { id: 'gold.A' },
        { id: 'gold.A' },
        { id: 'never.spawned' },
    ])
})

test('level.spawn returns a fresh copy on every read so scripts cannot mutate level state', () => {
    const s = stubs()
    const ctx = buildScriptContext({
        runtime: createRuntime(),
        ...s.deps,
        level: {
            getSpawn: () => ({ x: 3, y: 5, z: 7 }),
            getSize: () => 24,
            getName: () => 'demo',
        },
        flags: new Map(),
    })
    assert.equal(ctx.level.name, 'demo')
    assert.equal(ctx.level.size, 24)
    const first = ctx.level.spawn
    assert.deepEqual(first, { x: 3, y: 5, z: 7 })
    first.x = 999
    assert.equal(ctx.level.spawn.x, 3, 'mutating the returned object must not leak into the next read')
})

test('level binding falls back to sentinel values when no LevelMetaFacade is wired', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    assert.deepEqual(ctx.level.spawn, { x: 0, y: 0, z: 0 })
    assert.equal(ctx.level.size, 0)
    assert.equal(ctx.level.name, 'untitled')
})

test('ui.dialogue forwards modal dialogue requests and resolves the result', async () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    const result = await ctx.ui.dialogue({
        npc: { id: 'keeper', name: 'Keeper Arlen', avatar: 'keeper' },
        player: { id: 'player', name: 'You', avatar: 'player' },
        lines: [{
            speaker: 'keeper',
            text: 'Will you help?',
            choices: [{ id: 'yes', text: 'Yes.' }],
        }],
    })
    assert.equal(s.calls.uiDialogue.length, 1)
    assert.deepEqual(result, { choiceId: 'yes', choiceIndex: 0, text: 'Yes.' })
})

test('trade.open forwards shop requests and resolves transaction results', async () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    const result = await ctx.trade.open({
        title: 'Field Supplies',
        npc: { id: 'keeper', name: 'Keeper Arlen', avatar: 'keeper' },
        items: [{
            id: 'arrows.bundle',
            name: 'Arrow bundle',
            resource: 'arrows',
            unitSize: 5,
            buyPrice: 3,
            sellPrice: 1,
        }],
    })

    assert.equal(s.calls.tradeOpen.length, 1)
    assert.deepEqual(result, {
        status: 'bought',
        itemId: 'arrows.bundle',
        itemName: 'Arrow bundle',
        quantity: 2,
        unitSize: 5,
        spent: { gold: 6 },
        gained: { arrows: 10 },
        inventory: { gold: 1, arrows: 13 },
    })
})

test('flags.get / set is backed by the injected Map and persists across reads', () => {
    const s = stubs()
    const flags = new Map<string, FlagValue>([['preset', 'value']])
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags })
    assert.equal(ctx.flags.get('preset'), 'value')
    ctx.flags.set('quest.stage', 2)
    ctx.flags.set('grove.opened', true)
    assert.equal(ctx.flags.get('quest.stage'), 2)
    assert.equal(ctx.flags.get('grove.opened'), true)
    assert.equal(flags.get('quest.stage'), 2, 'external map sees the write — proves no copying')
})

test('zone.contains defaults `who` to player and forwards to the facade', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    assert.equal(ctx.zone.contains('inside'), true)
    assert.equal(ctx.zone.contains('outside'), false)
    ctx.zone.contains('grove', { x: 5, y: 1, z: 6 })
    assert.deepEqual(s.calls.zoneContains, [
        { zoneId: 'inside', who: 'player' },
        { zoneId: 'outside', who: 'player' },
        { zoneId: 'grove', who: { x: 5, y: 1, z: 6 } },
    ])
})

test('time + random expose the underlying runtime', () => {
    const s = stubs()
    const runtime = createRuntime(0xc0ffee)
    const ctx = buildScriptContext({ runtime, ...s.deps, flags: new Map() })
    assert.equal(ctx.time.now, 0)
    assert.equal(ctx.time.tick, 0)
    runtime.advance(0.5)
    assert.ok(Math.abs(ctx.time.now - 0.5) < 1e-9)
    assert.equal(ctx.time.tick, 1)
    const v = ctx.random(10, 20)
    assert.ok(v >= 10 && v < 20)
})

test('pistons bindings forward to the facade', () => {
    const s = stubs()
    s.setPistonRoster(['piston.elevator', 'piston.trap'])
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })

    assert.deepEqual(ctx.pistons.list(), ['piston.elevator', 'piston.trap'])
    assert.equal(ctx.pistons.isEnabled('piston.elevator'), true)
    assert.equal(ctx.pistons.setEnabled('piston.elevator', false), true)
    assert.equal(ctx.pistons.isEnabled('piston.elevator'), false)
    assert.equal(ctx.pistons.flip('piston.elevator'), true)

    // Unknown id returns false on every read/write path.
    assert.equal(ctx.pistons.setEnabled('piston.ghost', true), false)
    assert.equal(ctx.pistons.isEnabled('piston.ghost'), false)
    assert.equal(ctx.pistons.flip('piston.ghost'), false)

    s.setPistonFlipBlocks(true)
    assert.equal(ctx.pistons.flip('piston.trap'), false)
})

test('stones bindings forward direct stone and spawner control calls', () => {
    const s = stubs()
    const calls: unknown[] = []
    const liveStones = new Set<string>()
    const enabledSpawners = new Map<string, boolean>([['spawner.rocks', true]])
    const stones: StonesFacade = {
        spawn(pos, opts) {
            calls.push({ method: 'spawn', pos, opts })
            const id = opts?.id ?? 'stone.generated'
            liveStones.add(id)
            return id
        },
        remove(id) {
            calls.push({ method: 'remove', id })
            return liveStones.delete(id)
        },
        exists(id) {
            calls.push({ method: 'exists', id })
            return liveStones.has(id)
        },
        setSpawnerEnabled(id, enabled) {
            calls.push({ method: 'setSpawnerEnabled', id, enabled })
            if (!enabledSpawners.has(id)) return false
            enabledSpawners.set(id, enabled)
            return true
        },
        isSpawnerEnabled(id) {
            calls.push({ method: 'isSpawnerEnabled', id })
            return enabledSpawners.get(id) ?? false
        },
        triggerSpawner(id, count) {
            calls.push({ method: 'triggerSpawner', id, count })
            return enabledSpawners.has(id) && enabledSpawners.get(id) !== false ? count ?? 1 : 0
        },
        listSpawners() {
            calls.push({ method: 'listSpawners' })
            return [...enabledSpawners.keys()]
        },
    }
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, stones, flags: new Map() })

    assert.equal(ctx.stones.spawn({ x: 1, y: 2, z: 3 }, {
        id: 'stone.A',
        tier: 'rock',
        size: 0.4,
        velocity: { x: 0, y: -1, z: 0 },
    }), 'stone.A')
    assert.equal(ctx.stones.exists('stone.A'), true)
    assert.deepEqual(ctx.stones.listSpawners(), ['spawner.rocks'])
    assert.equal(ctx.stones.isSpawnerEnabled('spawner.rocks'), true)
    assert.equal(ctx.stones.setSpawnerEnabled('spawner.rocks', false), true)
    assert.equal(ctx.stones.triggerSpawner('spawner.rocks', 3), 0)
    assert.equal(ctx.stones.remove('stone.A'), true)
    assert.equal(ctx.stones.exists('stone.A'), false)

    assert.deepEqual(calls[0], {
        method: 'spawn',
        pos: { x: 1, y: 2, z: 3 },
        opts: { id: 'stone.A', tier: 'rock', size: 0.4, velocity: { x: 0, y: -1, z: 0 } },
    })
})

test('on(...) handles both filter-and-handler and handler-only forms', async () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })

    const fired: string[] = []
    // filtered: only fires for zoneId === 'grove'
    ctx.on('zone-enter', { zoneId: 'grove' }, () => { fired.push('grove') })
    // handler-only: any 'quest.complete' fires
    ctx.on('quest.complete', () => { fired.push('quest') })

    ctx.emit('zone-enter', { zoneId: 'other' })
    ctx.emit('zone-enter', { zoneId: 'grove' })
    ctx.emit('quest.complete')

    assert.deepEqual(fired, ['grove', 'quest'])
})

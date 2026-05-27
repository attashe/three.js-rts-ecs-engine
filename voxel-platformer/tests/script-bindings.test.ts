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
    PlayerFacade,
    VoxelCoord,
    ZoneFacade,
} from '../src/engine/script/types'

// VoxelCoord is re-exported from world.ts via types.ts; the test imports
// it through that surface so the binding facade matches the real types.

function stubs() {
    const calls: Record<string, unknown[]> = {
        audioPlay: [], audioStop: [],
        chunksSet: [], chunksFill: [], chunksGet: [],
        playerTeleport: [], playerKill: [],
        pickupSpawn: [],
        log: [],
        zoneContains: [],
    }
    let playerPos: VoxelCoord | null = { x: 1, y: 2, z: 3 }
    let gold = 7

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
        teleport(x, y, z) { calls.playerTeleport.push({ x, y, z }) },
        kill(reason) { calls.playerKill.push({ reason }) },
    }
    const pickups: PickupsFacade = {
        spawn(kind, pos, opts) { calls.pickupSpawn.push({ kind, pos, opts }); return `id-${kind}` },
    }
    const zone: ZoneFacade = {
        contains(zoneId, who) { calls.zoneContains.push({ zoneId, who }); return zoneId === 'inside' },
    }
    const log: LogFacade = {
        log(message, kind) { calls.log.push({ message, kind }) },
    }
    return {
        calls,
        deps: { audio, chunks, player, pickups, zone, log },
        setPlayerPos(p: VoxelCoord | null) { playerPos = p },
        setGold(g: number) { gold = g },
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

test('player bindings: position is live, teleport/kill forward', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    assert.deepEqual(ctx.player.position, { x: 1, y: 2, z: 3 })
    s.setPlayerPos({ x: 9, y: 9, z: 9 })
    assert.deepEqual(ctx.player.position, { x: 9, y: 9, z: 9 })
    s.setPlayerPos(null)
    assert.equal(ctx.player.position, null)
    assert.equal(ctx.player.inventory.gold, 7)
    s.setGold(42)
    assert.equal(ctx.player.inventory.gold, 42)
    ctx.player.teleport(5, 5, 5)
    ctx.player.kill('test')
    assert.deepEqual(s.calls.playerTeleport, [{ x: 5, y: 5, z: 5 }])
    assert.deepEqual(s.calls.playerKill, [{ reason: 'test' }])
})

test('pickups.spawn forwards and returns a handle id', () => {
    const s = stubs()
    const ctx = buildScriptContext({ runtime: createRuntime(), ...s.deps, flags: new Map() })
    const id = ctx.pickups.spawn('coin', { x: 1, y: 1, z: 1 }, { amount: 5 })
    assert.equal(id, 'id-coin')
    assert.deepEqual(s.calls.pickupSpawn, [{ kind: 'coin', pos: { x: 1, y: 1, z: 1 }, opts: { amount: 5 } }])
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

import test from 'node:test'
import assert from 'node:assert/strict'
import { createScriptEngineSystem } from '../src/engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    LogFacade,
    PickupsFacade,
    PlayerFacade,
    ScriptEntry,
    ZoneFacade,
} from '../src/engine/script/types'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'

function makeDeps(scripts: ScriptEntry[]) {
    const log: string[] = []
    const audioCalls: { id: string }[] = []
    const audio: AudioFacade = {
        play(id) { audioCalls.push({ id }); return { id } },
        stop() {},
    }
    const chunks: ChunksFacade = {
        getBlock: () => 0,
        setBlock() {},
        fillBlocks() {},
    }
    const player: PlayerFacade = {
        getPosition: () => ({ x: 0, y: 0, z: 0 }),
        getGold: () => 0,
        teleport() {},
        kill() {},
    }
    const pickups: PickupsFacade = {
        spawn() { return 'pickup-stub' },
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: () => false,
        isActive: () => false,
        setActive: () => false,
    }
    const logFacade: LogFacade = {
        log(msg) { log.push(msg) },
    }
    const errors: { entryId: string; where: string; err: unknown }[] = []
    const sys = createScriptEngineSystem({
        audio, chunks, player, pickups, zone, log: logFacade,
        getScripts: () => scripts,
        onScriptError: (entry, where, err) => errors.push({ entryId: entry.id, where, err }),
    })
    return { sys, log, audioCalls, errors }
}

function entry(id: string, source: string, extra: Partial<ScriptEntry> = {}): ScriptEntry {
    return { id, name: id, source, ...extra }
}

const flushMicrotasks = () => new Promise<void>((r) => setImmediate(r))

test('init() compiles enabled scripts and fires level-start', () => {
    const scripts: ScriptEntry[] = [
        entry('a', `on('level-start', () => log("a started"))`),
        entry('b', `on('level-start', () => log("b started"))`),
    ]
    const { sys, log } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    assert.deepEqual(log, ['a started', 'b started'])
})

test('disabled scripts are skipped at compile time', () => {
    const scripts: ScriptEntry[] = [
        entry('a', `log("a compiled")`),
        entry('b', `log("b compiled")`, { enabled: false }),
    ]
    const { sys, log } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    assert.deepEqual(log, ['a compiled'])
})

test('a syntactically broken script is recorded; other scripts keep running', () => {
    const scripts: ScriptEntry[] = [
        entry('broken', `this is not js`),
        entry('ok', `log("ok ran")`),
    ]
    const { sys, log, errors } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    assert.deepEqual(log, ['ok ran'])
    assert.equal(sys.broken.size, 1)
    assert.equal(sys.broken.get('broken')?.phase, 'parse')
    assert.equal(errors.length, 1)
    assert.equal(errors[0]?.where, 'compile.parse')
})

test('runtime exception inside top-level body is caught + recorded', async () => {
    const scripts: ScriptEntry[] = [
        entry('boom', `throw new Error("runtime-boom")`),
        entry('ok', `log("survives")`),
    ]
    const { sys, log, errors } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    await flushMicrotasks()
    assert.deepEqual(log, ['survives'])
    assert.equal(sys.broken.get('boom')?.phase, 'runtime')
    assert.ok(errors.some((e) => e.where === 'compile.runtime'))
})

test('apply() tears down handlers and re-runs scripts', () => {
    let counter = 0
    const scripts: ScriptEntry[] = [
        entry('inc', `
            on('ping', () => { log('ping-' + (++globalThis.__t)) })
            globalThis.__t = globalThis.__t ?? 0
        `),
    ]
    const { sys, log } = makeDeps(scripts)
    ;(globalThis as { __t?: number }).__t = 0
    sys.init?.(null as unknown as GameWorld)
    sys.runtime.emit('ping')
    sys.runtime.emit('ping')
    assert.deepEqual(log, ['ping-1', 'ping-2'])

    // apply: handlers torn down + re-registered. Old handlers must
    // NOT fire alongside the new ones.
    sys.apply()
    sys.runtime.emit('ping')
    assert.deepEqual(log, ['ping-1', 'ping-2', 'ping-3'])

    // Cleanup global state used to count across runs.
    delete (globalThis as { __t?: number }).__t
    counter += 1
    assert.ok(counter > 0)
})

test('update() advances time so wait() resolves and timer subscriptions fire', async () => {
    const scripts: ScriptEntry[] = [
        entry('q', `
            on('level-start', async () => {
                log('start')
                await wait(0.5)
                log('after-wait')
            })
            on('timer', { periodSeconds: 0.25 }, () => log('tick'))
        `),
    ]
    const { sys, log } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    await flushMicrotasks()
    assert.deepEqual(log, ['start'])

    // Tick to 0.25s → one timer fire.
    sys.update(null as unknown as GameWorld, 0.25)
    await flushMicrotasks()
    assert.deepEqual(log, ['start', 'tick'])

    // Tick to 0.5s → timer fires again, wait(0.5) resolves.
    sys.update(null as unknown as GameWorld, 0.25)
    await flushMicrotasks()
    assert.deepEqual(log, ['start', 'tick', 'tick', 'after-wait'])
})

test('level.reset event fires before subscriptions are torn down on apply()', () => {
    const scripts: ScriptEntry[] = [
        entry('s', `
            on('level.reset', () => log('reset-seen'))
            log('compiled')
        `),
    ]
    const { sys, log } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    assert.deepEqual(log, ['compiled'])
    sys.apply()
    // log() after compiled is "reset-seen" then "compiled" again.
    assert.deepEqual(log, ['compiled', 'reset-seen', 'compiled'])
})

test('once: true via opts removes after first emission', () => {
    const scripts: ScriptEntry[] = [
        entry('s', `
            on('level-start', () => log('boot'))
            on('ping', () => log('once'), { once: true })
        `),
    ]
    const { sys, log } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    sys.runtime.emit('ping')
    sys.runtime.emit('ping')
    assert.deepEqual(log, ['boot', 'once'])
})

test('dispose tears everything down', () => {
    const scripts: ScriptEntry[] = [
        entry('s', `
            on('ping', () => log('echo'))
            flags.set('foo', 1)
        `),
    ]
    const { sys, log } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    assert.equal(sys.flags.get('foo'), 1)
    sys.dispose?.()
    sys.runtime.emit('ping')
    assert.deepEqual(log, [])
    assert.equal(sys.flags.size, 0)
})

test('runtime is observable for tests + future editor (state surface)', () => {
    const scripts: ScriptEntry[] = []
    const { sys } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    assert.equal(sys.runtime.now, 0)
    assert.equal(sys.runtime.tick, 0)
    sys.update(null as unknown as GameWorld, 0.1)
    assert.ok(Math.abs(sys.runtime.now - 0.1) < 1e-9)
    assert.equal(sys.runtime.tick, 1)
})

test('cross-script messaging via emit/on', async () => {
    const scripts: ScriptEntry[] = [
        entry('producer', `
            on('level-start', async () => {
                log('producer-go')
                emit('quest.amulet.found', { silver: 3 })
            })
        `),
        entry('consumer', `
            on('quest.amulet.found', (data) => {
                log('consumer-' + data.silver)
            })
        `),
    ]
    const { sys, log } = makeDeps(scripts)
    sys.init?.(null as unknown as GameWorld)
    await flushMicrotasks()
    assert.deepEqual(log, ['producer-go', 'consumer-3'])
})

// Suppress the unused-var warning — createGameWorld will get used once
// we wire ZoneTriggerSystem hooks in Slice 3 and need a real world.
void createGameWorld

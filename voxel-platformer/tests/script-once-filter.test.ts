import test from 'node:test'
import assert from 'node:assert/strict'
import { buildScriptContext } from '../src/engine/script/bindings'
import { createRuntime } from '../src/engine/script/runtime'
import type {
    AudioFacade,
    ChunksFacade,
    LogFacade,
    PickupsFacade,
    PistonsFacade,
    PlayerFacade,
    ZoneFacade,
} from '../src/engine/script/types'

// Minimal facade set — these tests only exercise on/emit, so every
// world-touching facade is an inert stub.
function minimalDeps() {
    const audio: AudioFacade = { play: () => ({}), stop: () => {} }
    const chunks: ChunksFacade = { getBlock: () => 0, setBlock: () => {}, fillBlocks: () => {} }
    const player: PlayerFacade = {
        getPosition: () => ({ x: 0, y: 0, z: 0 }),
        getGold: () => 0,
        getArrows: () => 0,
        getSettings: () => ({}) as never,
        setSettings: () => ({}) as never,
        setAbility: () => {},
        setGold: () => {},
        setArrows: () => {},
        teleport: () => {},
        kill: () => {},
        getCheckpoint: () => null,
        setCheckpoint: () => {},
        clearCheckpoint: () => {},
    }
    const pickups: PickupsFacade = { spawn: () => 'id', despawn: () => false, exists: () => false }
    const pistons: PistonsFacade = {
        setEnabled: () => false,
        isEnabled: () => false,
        flip: () => false,
        list: () => [],
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: () => true,
        isActive: () => true,
        setActive: () => true,
    }
    const log: LogFacade = { log: () => {} }
    return { audio, chunks, player, pickups, pistons, zone, log }
}

test('once: true inside the filter object fires the handler exactly once', () => {
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...minimalDeps(), flags: new Map() })

    let calls = 0
    // The shape every doc example uses: `once` co-located with the filter.
    ctx.on('zone-enter', { zoneId: 'grove', once: true }, () => { calls++ })

    runtime.emit('zone-enter', { zoneId: 'grove' })
    runtime.emit('zone-enter', { zoneId: 'grove' })

    assert.equal(calls, 1, 'handler should fire on the first matching event and then dispose')
})

test('a lifted once filter still matches its other keys', () => {
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...minimalDeps(), flags: new Map() })

    let calls = 0
    ctx.on('zone-enter', { zoneId: 'grove', once: true }, () => { calls++ })

    // Non-matching zoneId must not fire the handler — the rest of the
    // filter survives the lift.
    runtime.emit('zone-enter', { zoneId: 'other' })
    assert.equal(calls, 0, 'mismatched filter keys must still gate the handler')

    runtime.emit('zone-enter', { zoneId: 'grove' })
    assert.equal(calls, 1)
})

test('once: false in the filter registers a recurring handler', () => {
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...minimalDeps(), flags: new Map() })

    let calls = 0
    ctx.on('ping', { tag: 'a', once: false }, () => { calls++ })

    runtime.emit('ping', { tag: 'a' })
    runtime.emit('ping', { tag: 'a' })
    assert.equal(calls, 2, 'once:false must not dispose after the first firing')
})

test('explicit opts.once wins over a conflicting filter once', () => {
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...minimalDeps(), flags: new Map() })

    let calls = 0
    // Filter says once:false, but the explicit 4th-arg opts says once:true.
    // The explicit channel is authoritative.
    ctx.on('ping', { tag: 'a', once: false }, () => { calls++ }, { once: true })

    runtime.emit('ping', { tag: 'a' })
    runtime.emit('ping', { tag: 'a' })
    assert.equal(calls, 1, 'explicit opts.once:true should take precedence')
})

test('canonical opts-position once still works (no regression)', () => {
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...minimalDeps(), flags: new Map() })

    let calls = 0
    ctx.on('zone-enter', { zoneId: 'grove' }, () => { calls++ }, { once: true })

    runtime.emit('zone-enter', { zoneId: 'grove' })
    runtime.emit('zone-enter', { zoneId: 'grove' })
    assert.equal(calls, 1)
})

test('a filter of only { once: true } collapses to match-all', () => {
    const runtime = createRuntime()
    const ctx = buildScriptContext({ runtime, ...minimalDeps(), flags: new Map() })

    let calls = 0
    ctx.on('custom.event', { once: true }, () => { calls++ })

    runtime.emit('custom.event', { anything: 1 })
    runtime.emit('custom.event', { anything: 2 })
    assert.equal(calls, 1, 'a once-only filter should match any payload and fire once')
})

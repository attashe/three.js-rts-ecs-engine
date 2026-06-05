import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import {
    BoxCollider,
    PlayerControlled,
    Position,
} from '../src/engine/ecs/components'
import { createZoneTriggerSystem } from '../src/engine/ecs/systems/zone-trigger-system'
import {
    consumeScriptTriggerEvents,
    createGameWorld,
    type GameWorld,
} from '../src/engine/ecs/world'
import { defineZone, isZoneActive, setZoneActive } from '../src/engine/ecs/zones'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { buildScriptContext } from '../src/engine/script/bindings'
import { createRuntime } from '../src/engine/script/runtime'
import type {
    AudioFacade,
    ChunksFacade,
    DayCycleFacade,
    LogFacade,
    PickupsFacade,
    PistonsFacade,
    PlayerFacade,
    WeatherFacade,
    ZoneFacade,
} from '../src/engine/script/types'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS } from '../src/game/player-settings'

/**
 * Slice 1.6 surface: zone.setActive / isActive / exists, flag.changed
 * event emission, dayCycle.* + weather.* facade plumbing. The
 * facades themselves are tested via stubs here; the production
 * implementations in `script-system.ts` are smoke-tested through the
 * demo-quest test which runs the live runtime.
 */

function spawnPlayer(world: GameWorld, pos: { x: number; y: number; z: number }): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, PlayerControlled)
    Position.x[eid] = pos.x
    Position.y[eid] = pos.y
    Position.z[eid] = pos.z
    BoxCollider.x[eid] = 0.4
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.4
    return eid
}

// ─── Zone.active filtering ─────────────────────────────────────────────

test('isZoneActive defaults to true when the `active` flag is missing', () => {
    assert.equal(isZoneActive({
        id: 'a', kind: 'trigger', min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 },
    }), true)
    assert.equal(isZoneActive({
        id: 'b', kind: 'trigger', min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 },
        active: false,
    }), false)
})

test('setZoneActive clones the zone with the new flag and returns true', () => {
    const world = createGameWorld()
    defineZone(world, {
        id: 'z.x', kind: 'trigger',
        min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 4 },
    })
    assert.equal(setZoneActive(world, 'z.x', false), true)
    assert.equal(isZoneActive(world.zones.get('z.x')!), false)

    // Calling again with the same value is a no-op success.
    assert.equal(setZoneActive(world, 'z.x', false), true)

    // Reactivation flips back.
    assert.equal(setZoneActive(world, 'z.x', true), true)
    assert.equal(isZoneActive(world.zones.get('z.x')!), true)

    // Missing zone returns false.
    assert.equal(setZoneActive(world, 'missing', true), false)
})

test('an inactive zone does not fire zone-enter when the player overlaps', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    defineZone(world, {
        id: 'z.x', kind: 'trigger',
        min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 4 },
        active: false,
    })
    spawnPlayer(world, { x: 2, y: 1, z: 2 })

    const sys = createZoneTriggerSystem({ log: false })
    sys.update(world, 1 / 60)

    const events = consumeScriptTriggerEvents(world)
    assert.equal(events.length, 0, 'no zone-enter while the zone is inactive')
})

test('deactivating a zone mid-overlap synthesises a zone-exit on the next tick', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    defineZone(world, {
        id: 'z.x', kind: 'trigger',
        min: { x: 0, y: 0, z: 0 }, max: { x: 4, y: 4, z: 4 },
    })
    spawnPlayer(world, { x: 2, y: 1, z: 2 })

    const sys = createZoneTriggerSystem({ log: false })
    sys.update(world, 1 / 60)
    consumeScriptTriggerEvents(world)  // drop enter

    setZoneActive(world, 'z.x', false)
    sys.update(world, 1 / 60)

    const events = consumeScriptTriggerEvents(world)
    assert.ok(events.some((e) => e.kind === 'zone-exit'),
        'zone-exit must fire when the active flag drops mid-overlap')
})

// ─── flag.changed event ────────────────────────────────────────────────

function stubs() {
    const player: PlayerFacade = {
        getPosition: () => ({ x: 0, y: 0, z: 0 }),
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
    const chunks: ChunksFacade = {
        getBlock: () => 0,
        setBlock() {},
        fillBlocks() {},
    }
    const audio: AudioFacade = { play() { return null }, stop() {} }
    const pickups: PickupsFacade = { spawn() { return 'stub' }, despawn() { return false }, exists() { return false } }
    const pistons: PistonsFacade = {
        setEnabled() { return false },
        isEnabled() { return false },
        flip() { return false },
        list() { return [] },
    }
    const zone: ZoneFacade = {
        contains: () => false,
        exists: () => false,
        isActive: () => false,
        setActive: () => false,
    }
    const log: LogFacade = { log() {} }
    return { player, chunks, audio, pickups, pistons, zone, log }
}

test('flags.set emits flag.changed with name + value + previousValue', () => {
    const runtime = createRuntime()
    const flags = new Map<string, number | string | boolean>()
    const ctx = buildScriptContext({ runtime, ...stubs(), flags })
    const events: unknown[] = []
    ctx.on('flag.changed', (e: unknown) => { events.push(e) })

    ctx.flags.set('quest.stage', 1)
    ctx.flags.set('quest.stage', 2)
    ctx.flags.set('grove.opened', true)

    assert.equal(events.length, 3)
    assert.deepEqual(events[0], { name: 'quest.stage', value: 1, previousValue: undefined })
    assert.deepEqual(events[1], { name: 'quest.stage', value: 2, previousValue: 1 })
    assert.deepEqual(events[2], { name: 'grove.opened', value: true, previousValue: undefined })
})

test('flags.set does not re-fire when the value is unchanged', () => {
    const runtime = createRuntime()
    const flags = new Map<string, number | string | boolean>()
    const ctx = buildScriptContext({ runtime, ...stubs(), flags })
    let calls = 0
    ctx.on('flag.changed', { name: 'x' }, () => { calls++ })
    ctx.flags.set('x', 1)
    ctx.flags.set('x', 1)
    ctx.flags.set('x', 1)
    assert.equal(calls, 1)
})

test('filtered flag.changed matches only the requested name', () => {
    const runtime = createRuntime()
    const flags = new Map<string, number | string | boolean>()
    const ctx = buildScriptContext({ runtime, ...stubs(), flags })
    const seen: string[] = []
    ctx.on('flag.changed', { name: 'door.east' }, (e) => {
        const payload = e as { name: string; value: unknown }
        seen.push(`${payload.name}=${payload.value}`)
    })
    ctx.flags.set('door.east', 'open')
    ctx.flags.set('door.west', 'open')
    ctx.flags.set('door.east', 'shut')
    assert.deepEqual(seen, ['door.east=open', 'door.east=shut'])
})

// ─── Zone facade bindings ──────────────────────────────────────────────

test('zone bindings (exists / isActive / setActive) forward to the facade', () => {
    const runtime = createRuntime()
    const calls: { method: string; args: unknown[] }[] = []
    const facadeOverride: ZoneFacade = {
        contains() { calls.push({ method: 'contains', args: [] }); return false },
        exists(id) { calls.push({ method: 'exists', args: [id] }); return id === 'z.x' },
        isActive(id) { calls.push({ method: 'isActive', args: [id] }); return id === 'z.x' },
        setActive(id, on) { calls.push({ method: 'setActive', args: [id, on] }); return true },
    }
    const base = stubs()
    const ctx = buildScriptContext({
        runtime,
        ...base,
        zone: facadeOverride,
        flags: new Map(),
    })
    assert.equal(ctx.zone.exists('z.x'), true)
    assert.equal(ctx.zone.exists('z.y'), false)
    assert.equal(ctx.zone.isActive('z.x'), true)
    assert.equal(ctx.zone.setActive('z.x', false), true)
    const setCall = calls.find((c) => c.method === 'setActive')
    assert.deepEqual(setCall?.args, ['z.x', false])
})

// ─── dayCycle + weather facade bindings ────────────────────────────────

test('dayCycle bindings forward to the facade', () => {
    const runtime = createRuntime()
    let hour = 8
    let enabled = true
    const dayCycle: DayCycleFacade = {
        getHour() { return hour },
        setHour(h) { hour = h },
        isEnabled() { return enabled },
        setEnabled(on) { enabled = on },
        setSpeed() {},
    }
    const ctx = buildScriptContext({
        runtime,
        ...stubs(),
        dayCycle,
        flags: new Map(),
    })
    assert.equal(ctx.dayCycle.hour, 8)
    ctx.dayCycle.setHour(19)
    assert.equal(hour, 19)
    assert.equal(ctx.dayCycle.hour, 19)
    assert.equal(ctx.dayCycle.enabled, true)
    ctx.dayCycle.setEnabled(false)
    assert.equal(enabled, false)
})

test('dayCycle defaults to noop when no facade is provided', () => {
    const runtime = createRuntime()
    const ctx = buildScriptContext({
        runtime,
        ...stubs(),
        flags: new Map(),
    })
    // Reads return the fallback; writes are silent. The script can
    // still call these without throwing on a level with no ambient.
    assert.equal(ctx.dayCycle.hour, 12)
    ctx.dayCycle.setHour(3.5)
    ctx.dayCycle.setEnabled(true)
    assert.equal(ctx.dayCycle.hour, 12)
})

test('weather bindings forward to the facade', () => {
    const runtime = createRuntime()
    const calls: { method: string; args: unknown[] }[] = []
    const weather: WeatherFacade = {
        setRain(on) { calls.push({ method: 'setRain', args: [on] }) },
        setSnow(on) { calls.push({ method: 'setSnow', args: [on] }) },
        setLightning(on) { calls.push({ method: 'setLightning', args: [on] }) },
        applyPreset(id) {
            calls.push({ method: 'applyPreset', args: [id] })
            return id === 'rain'
        },
        setZoneEnabled() { return false },
        isZoneEnabled() { return false },
        setZonePreset() { return false },
    }
    const ctx = buildScriptContext({
        runtime,
        ...stubs(),
        weather,
        flags: new Map(),
    })
    ctx.weather.setRain(true)
    ctx.weather.setSnow(false)
    ctx.weather.setLightning(true)
    assert.equal(ctx.weather.applyPreset('rain'), true)
    assert.equal(ctx.weather.applyPreset('unknown'), false)
    assert.deepEqual(calls.map((c) => c.method), ['setRain', 'setSnow', 'setLightning', 'applyPreset', 'applyPreset'])
})

// ─── Cross-script flag.changed observation ─────────────────────────────

test('two scripts can coordinate via flag.changed without polling', () => {
    const runtime = createRuntime()
    const flags = new Map<string, number | string | boolean>()
    const ctx = buildScriptContext({ runtime, ...stubs(), flags })

    // Script A: subscribes to the gate flag.
    const observed: string[] = []
    ctx.on('flag.changed', { name: 'gate.east' }, (e) => {
        const value = (e as { value: unknown }).value
        observed.push(`gate.east → ${value}`)
    })

    // Script B: writes the gate flag.
    ctx.flags.set('gate.east', 'closed')
    ctx.flags.set('gate.east', 'opening')
    ctx.flags.set('gate.east', 'open')

    assert.deepEqual(observed, [
        'gate.east → closed',
        'gate.east → opening',
        'gate.east → open',
    ])
})

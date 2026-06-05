import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisualFxZoneController, type FxZoneRegistry } from '../src/game/visual-fx-zone-controller'
import type { WeatherZoneRuntimeConfig } from '../src/game/weather-config'

function fakeRegistry() {
    const created = new Map<string, { id: string; presetType: string }>()
    const live = new Map<string, { id: string; presetType: string }>()
    const calls: { method: 'addZone' | 'removeZone' | 'setZoneActive'; id: string; type?: string; active?: boolean }[] = []
    const registry: FxZoneRegistry = {
        addZone(params) {
            const id = params.id ?? '<anon>'
            created.set(id, { id, presetType: params.type })
            live.set(id, { id, presetType: params.type })
            calls.push({ method: 'addZone', id, type: params.type })
            return params
        },
        removeZone(id) {
            created.delete(id)
            live.delete(id)
            calls.push({ method: 'removeZone', id })
        },
        setZoneActive(id, active) {
            const zone = created.get(id)
            if (!zone) return false
            if (active) live.set(id, zone)
            else live.delete(id)
            calls.push({ method: 'setZoneActive', id, active })
            return true
        },
    }
    return { registry, created, live, calls }
}

function authoredZone(id: string, presetId: string): WeatherZoneRuntimeConfig {
    return {
        id,
        label: id,
        presetId,
        position: { x: 0, y: 0, z: 0 },
        size: { x: 8, y: 4, z: 8 },
        addSound: false,
        soundId: undefined,
        soundVolume: 1,
    }
}

test('controller spawns enabled zones via spawnEnabled and reports them as live', () => {
    const { registry, live } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire'), authoredZone('zone.rain', 'rain')])
    ctl.spawnEnabled()
    assert.equal(live.size, 2)
    assert.equal(ctl.isZoneEnabled('zone.fire'), true)
    assert.equal(ctl.isZoneEnabled('zone.rain'), true)
})

test('controller leaves authored disabled zones dormant until scripts enable them', () => {
    const { registry, created, live, calls } = fakeRegistry()
    const zone = { ...authoredZone('zone.magic', 'magic'), enabled: false }
    const ctl = createVisualFxZoneController(registry, [zone])

    ctl.spawnEnabled()
    assert.equal(created.size, 1, 'disabled zones are warm-allocated to avoid activation hitches')
    assert.equal(live.size, 0)
    assert.equal(ctl.isZoneEnabled('zone.magic'), false)

    calls.length = 0
    assert.equal(ctl.setZoneEnabled('zone.magic', true), true)
    assert.equal(live.has('zone.magic'), true)
    assert.deepEqual(calls, [{ method: 'setZoneActive', id: 'zone.magic', active: true }])
})

test('setZoneEnabled(id, false) hides the warm zone and reports disabled', () => {
    const { registry, live, calls } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire')])
    ctl.spawnEnabled()
    calls.length = 0
    assert.equal(ctl.setZoneEnabled('zone.fire', false), true)
    assert.equal(live.size, 0)
    assert.equal(ctl.isZoneEnabled('zone.fire'), false)
    assert.deepEqual(calls, [{ method: 'setZoneActive', id: 'zone.fire', active: false }])
})

test('setZoneEnabled(id, true) reactivates a previously-disabled warm zone', () => {
    const { registry, live } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire')])
    ctl.spawnEnabled()
    ctl.setZoneEnabled('zone.fire', false)
    assert.equal(live.size, 0)
    assert.equal(ctl.setZoneEnabled('zone.fire', true), true)
    assert.equal(live.has('zone.fire'), true)
    assert.equal(ctl.isZoneEnabled('zone.fire'), true)
})

test('script-driven enable/disable uses the lifecycle hooks registered at init', () => {
    const { registry } = fakeRegistry()
    const zone = { ...authoredZone('zone.magic', 'magic'), enabled: false }
    const ctl = createVisualFxZoneController(registry, [zone])
    const events: string[] = []

    ctl.spawnEnabled({
        onSpawned: (config) => events.push(`spawn:${config.id}`),
        onDespawned: (config) => events.push(`despawn:${config.id}`),
    })

    ctl.setZoneEnabled('zone.magic', true)
    ctl.setZoneEnabled('zone.magic', false)

    assert.deepEqual(events, ['spawn:zone.magic', 'despawn:zone.magic'])
})

test('setZoneEnabled is idempotent — repeated true/false calls do not double-spawn or double-remove', () => {
    const { registry, calls } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire')])
    ctl.spawnEnabled()
    calls.length = 0
    ctl.setZoneEnabled('zone.fire', true)
    ctl.setZoneEnabled('zone.fire', true)
    assert.deepEqual(calls, [], 'enabling an already-enabled zone is a no-op at the registry level')
    ctl.setZoneEnabled('zone.fire', false)
    ctl.setZoneEnabled('zone.fire', false)
    assert.deepEqual(calls, [{ method: 'setZoneActive', id: 'zone.fire', active: false }],
        'disabling an already-disabled zone is a no-op at the registry level')
})

test('setZoneEnabled on an unknown id returns false and never touches the registry', () => {
    const { registry, calls } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire')])
    ctl.spawnEnabled()
    calls.length = 0
    assert.equal(ctl.setZoneEnabled('zone.unknown', true), false)
    assert.equal(ctl.setZoneEnabled('zone.unknown', false), false)
    assert.deepEqual(calls, [])
})

test('setZonePreset on a live zone swaps the preset via remove+add and remembers the new preset', () => {
    const { registry, live, calls } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.weather', 'rain')])
    ctl.spawnEnabled()
    calls.length = 0
    assert.equal(ctl.setZonePreset('zone.weather', 'storm'), true)
    assert.equal(live.get('zone.weather')?.presetType, 'rain', 'storm preset still uses the rain emitter type')
    // Preset swaps still rebuild topology, then reactivate the warm zone.
    assert.deepEqual(calls.map((c) => c.method), ['removeZone', 'addZone', 'setZoneActive'])

    // Disable + re-enable picks up the new preset, proving the swap was
    // persisted on the controller's config map.
    ctl.setZoneEnabled('zone.weather', false)
    calls.length = 0
    ctl.setZoneEnabled('zone.weather', true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.method, 'setZoneActive')
    assert.equal(calls[0]!.active, true)
})

test('setZonePreset on an unknown preset id returns false and leaves state untouched', () => {
    const { registry, calls } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.weather', 'rain')])
    ctl.spawnEnabled()
    calls.length = 0
    assert.equal(ctl.setZonePreset('zone.weather', 'made.up'), false)
    assert.deepEqual(calls, [], 'no remove/add side effect on a failed preset swap')
})

test('despawnAll removes every allocated zone; isZoneEnabled goes false; spawnEnabled re-creates them', () => {
    const { registry, live } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [
        authoredZone('zone.a', 'fire'),
        authoredZone('zone.b', 'rain'),
    ])
    ctl.spawnEnabled()
    assert.equal(ctl.isZoneEnabled('zone.a'), true)
    ctl.despawnAll()
    assert.equal(live.size, 0)
    assert.equal(ctl.isZoneEnabled('zone.a'), false, 'isZoneEnabled tracks live-in-registry, not the enable flag')
    ctl.spawnEnabled()
    assert.equal(live.size, 2, 'spawnEnabled re-creates the same zones')
    assert.equal(ctl.isZoneEnabled('zone.a'), true)
})

test('isZoneEnabled returns false before spawnEnabled is called, even for authored zones', () => {
    const { registry } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire')])
    assert.equal(ctl.isZoneEnabled('zone.fire'), false, 'pre-spawn, the zone is configured but not live')
    ctl.spawnEnabled()
    assert.equal(ctl.isZoneEnabled('zone.fire'), true)
})

test('controller deep-copies author configs so preset swaps do not mutate level metadata', () => {
    const { registry } = fakeRegistry()
    const author = authoredZone('zone.weather', 'rain')
    const ctl = createVisualFxZoneController(registry, [author])
    ctl.setZonePreset('zone.weather', 'storm')
    assert.equal(author.presetId, 'rain', 'the source config the level handed in must be unmodified')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createVisualFxZoneController, type FxZoneRegistry } from '../src/game/visual-fx-zone-controller'
import type { WeatherZoneRuntimeConfig } from '../src/game/weather-config'

function fakeRegistry() {
    const live = new Map<string, { id: string; presetType: string }>()
    const calls: { method: 'addZone' | 'removeZone'; id: string; type?: string }[] = []
    const registry: FxZoneRegistry = {
        addZone(params) {
            const id = params.id ?? '<anon>'
            live.set(id, { id, presetType: params.type })
            calls.push({ method: 'addZone', id, type: params.type })
            return params
        },
        removeZone(id) {
            live.delete(id)
            calls.push({ method: 'removeZone', id })
        },
    }
    return { registry, live, calls }
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

test('setZoneEnabled(id, false) removes the zone from the registry and reports disabled', () => {
    const { registry, live, calls } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire')])
    ctl.spawnEnabled()
    calls.length = 0
    assert.equal(ctl.setZoneEnabled('zone.fire', false), true)
    assert.equal(live.size, 0)
    assert.equal(ctl.isZoneEnabled('zone.fire'), false)
    assert.deepEqual(calls, [{ method: 'removeZone', id: 'zone.fire' }])
})

test('setZoneEnabled(id, true) re-spawns a previously-disabled zone', () => {
    const { registry, live } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.fire', 'fire')])
    ctl.spawnEnabled()
    ctl.setZoneEnabled('zone.fire', false)
    assert.equal(live.size, 0)
    assert.equal(ctl.setZoneEnabled('zone.fire', true), true)
    assert.equal(live.has('zone.fire'), true)
    assert.equal(ctl.isZoneEnabled('zone.fire'), true)
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
    assert.deepEqual(calls, [{ method: 'removeZone', id: 'zone.fire' }],
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
    // The visible change is: zone was removed then re-added.
    assert.deepEqual(calls.map((c) => c.method), ['removeZone', 'addZone'])

    // Disable + re-enable picks up the new preset, proving the swap was
    // persisted on the controller's config map.
    ctl.setZoneEnabled('zone.weather', false)
    calls.length = 0
    ctl.setZoneEnabled('zone.weather', true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.method, 'addZone')
})

test('setZonePreset on an unknown preset id returns false and leaves state untouched', () => {
    const { registry, calls } = fakeRegistry()
    const ctl = createVisualFxZoneController(registry, [authoredZone('zone.weather', 'rain')])
    ctl.spawnEnabled()
    calls.length = 0
    assert.equal(ctl.setZonePreset('zone.weather', 'made.up'), false)
    assert.deepEqual(calls, [], 'no remove/add side effect on a failed preset swap')
})

test('despawnAll removes every live zone; isZoneEnabled goes false; spawnEnabled re-creates them', () => {
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

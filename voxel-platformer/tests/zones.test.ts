import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { BoxCollider, MovingObject, PlayerControlled, Position, Velocity } from '../src/engine/ecs/components'
import { createGameWorld, pushZoneEvent, type GameWorld } from '../src/engine/ecs/world'
import { createZoneTriggerSystem } from '../src/engine/ecs/systems/zone-trigger-system'
import { defineZone, findZoneAtPoint, isPointInZone, removeZone, sampleZonePoint, zoneAcceptsTrigger } from '../src/engine/ecs/zones'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { MovingObjectKind } from '../src/game/moving-objects'

function placePlayer(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, PlayerControlled)
    Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = z
    BoxCollider.x[eid] = 0.25; BoxCollider.y[eid] = 0.5; BoxCollider.z[eid] = 0.25
    return eid
}

function placeArrow(world: GameWorld, x: number, y: number, z: number, vx: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, MovingObject)
    Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = z
    Velocity.x[eid] = vx; Velocity.y[eid] = 0; Velocity.z[eid] = 0
    BoxCollider.x[eid] = 0.05; BoxCollider.y[eid] = 0.05; BoxCollider.z[eid] = 0.05
    MovingObject.kind[eid] = MovingObjectKind.Arrow
    return eid
}

test('isPointInZone: min is inclusive, max is exclusive', () => {
    const zone = {
        id: 'a',
        kind: 'generic',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 2, y: 1, z: 2 },
    }
    assert.equal(isPointInZone(zone, { x: 0, y: 0, z: 0 }), true, 'min corner inside')
    assert.equal(isPointInZone(zone, { x: 1.5, y: 0.5, z: 1.5 }), true, 'interior')
    assert.equal(isPointInZone(zone, { x: 2, y: 0, z: 1 }), false, 'max X is exclusive')
    assert.equal(isPointInZone(zone, { x: 1, y: 1, z: 1 }), false, 'max Y is exclusive')
    assert.equal(isPointInZone(zone, { x: 1, y: 0, z: 2 }), false, 'max Z is exclusive')
    assert.equal(isPointInZone(zone, { x: -1, y: 0, z: 0 }), false, 'outside')
})

test('findZoneAtPoint: returns the first matching zone, or null', () => {
    const world = createGameWorld()
    defineZone(world, { id: 'arena', kind: 'trigger', min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 5, z: 10 } })
    defineZone(world, { id: 'lava', kind: 'killzone', min: { x: 2, y: 0, z: 2 }, max: { x: 4, y: 2, z: 4 } })

    const hitArena = findZoneAtPoint(world, { x: 8, y: 1, z: 8 })
    assert.equal(hitArena?.id, 'arena')

    const miss = findZoneAtPoint(world, { x: -1, y: 0, z: 0 })
    assert.equal(miss, null)

    removeZone(world, 'arena')
    const onlyLava = findZoneAtPoint(world, { x: 3, y: 1, z: 3 })
    assert.equal(onlyLava?.id, 'lava')
})

test('sampleZonePoint: same seed → same point, different seeds → spread', () => {
    const zone = {
        id: 'a',
        kind: 'generic',
        min: { x: 0, y: 4, z: 0 },
        max: { x: 10, y: 5, z: 10 },
    }
    const a = sampleZonePoint(zone, 42)
    const b = sampleZonePoint(zone, 42)
    assert.deepEqual(a, b, 'deterministic for same seed')

    assert.equal(a.y, zone.min.y, 'Y pinned to zone.min.y')
    assert.ok(a.x >= zone.min.x && a.x < zone.max.x, `x in [${zone.min.x},${zone.max.x}), got ${a.x}`)
    assert.ok(a.z >= zone.min.z && a.z < zone.max.z, `z in [${zone.min.z},${zone.max.z}), got ${a.z}`)

    // Two distinct seeds give two distinct points (probabilistically; this
    // pair is hand-picked to avoid hash collisions for the constants used).
    const c = sampleZonePoint(zone, 99)
    assert.ok(a.x !== c.x || a.z !== c.z, 'different seeds spread x/z')
})

test('zoneAcceptsTrigger: trigger zones default to player and can opt into arrow', () => {
    const base = {
        id: 'door',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
    }
    assert.equal(zoneAcceptsTrigger(base, 'player'), true)
    assert.equal(zoneAcceptsTrigger(base, 'arrow'), false)
    assert.equal(zoneAcceptsTrigger({ ...base, triggerSources: ['arrow'] }, 'player'), false)
    assert.equal(zoneAcceptsTrigger({ ...base, triggerSources: ['arrow'] }, 'arrow'), true)
})

test('zoneAcceptsTrigger: portal zones default to player activation', () => {
    const portal = {
        id: 'exit',
        kind: 'portal',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
        portal: { targetLevelId: 'basement' },
    }
    assert.equal(zoneAcceptsTrigger(portal, 'player'), true)
    assert.equal(zoneAcceptsTrigger(portal, 'arrow'), false)
})

test('ZoneTriggerSystem: player activates a trigger on enter, not every tick', () => {
    const world = createGameWorld()
    defineZone(world, {
        id: 'entry',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 2, y: 2, z: 2 },
        triggerSources: ['player'],
    })
    const player = placePlayer(world, 1, 0, 1)
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const system = createZoneTriggerSystem({ log: false })

    system.update(world, 1 / 60)
    system.update(world, 1 / 60)
    assert.equal(world.zoneEvents.length, 1, 'enter emits exactly once')
    assert.equal(world.zoneEvents[0]?.zoneId, 'entry')
    assert.equal(world.zoneEvents[0]?.source, 'player')
    assert.equal(world.zoneEvents[0]?.eid, player)

    Position.x[player] = 10
    system.update(world, 1 / 60)
    Position.x[player] = 1
    system.update(world, 1 / 60)
    assert.equal(world.zoneEvents.length, 2, 're-enter emits again after leaving')
})

test('ZoneTriggerSystem: arrow-only trigger ignores player and fires on swept arrow collision', () => {
    const world = createGameWorld()
    defineZone(world, {
        id: 'remote',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
        triggerSources: ['arrow'],
    })
    placePlayer(world, 0.5, 0, 0.5)
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const system = createZoneTriggerSystem({ log: false })

    system.update(world, 0.1)
    assert.equal(world.zoneEvents.length, 0, 'player does not activate arrow-only trigger')

    const arrow = placeArrow(world, 2, 0.45, 0.5, 30)
    system.update(world, 0.1)
    assert.equal(world.zoneEvents.length, 1, 'swept arrow path crosses the zone')
    assert.equal(world.zoneEvents[0]?.zoneId, 'remote')
    assert.equal(world.zoneEvents[0]?.source, 'arrow')
    assert.equal(world.zoneEvents[0]?.eid, arrow)

    system.update(world, 0.1)
    assert.equal(world.zoneEvents.length, 1, 'same arrow does not retrigger the same zone')
})

test('pushZoneEvent: caps world.zoneEvents to the most recent 64 entries', () => {
    const world = createGameWorld()
    for (let i = 0; i < 100; i++) {
        pushZoneEvent(world, {
            zoneId: `z-${i}`,
            zoneKind: 'trigger',
            source: 'player',
            eid: i,
            point: { x: 0, y: 0, z: 0 },
        })
    }
    assert.equal(world.zoneEvents.length, 64, 'queue is capped')
    assert.equal(world.zoneEvents[0]?.zoneId, 'z-36', 'oldest entries evicted FIFO')
    assert.equal(world.zoneEvents[63]?.zoneId, 'z-99', 'newest entry preserved')
})

// The legacy `ZoneScriptAction` surface (message / kill-player /
// set-block / fill-blocks executed inline by `executeZoneScript`) was
// removed alongside the Slice 3 script-engine work. Authored quest
// behaviour now lives in editor-loaded `.js` scripts that react to
// `zone-enter` / `zone-exit` events via the script engine. The
// previous "trigger scripts can show messages, kill the player, and
// edit blocks" coverage moves to the script-engine test suite.

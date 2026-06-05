import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { BoxCollider, PlayerControlled, Position } from '../src/engine/ecs/components'
import { createZoneTriggerSystem } from '../src/engine/ecs/systems/zone-trigger-system'
import {
    consumeScriptTriggerEvents,
    createGameWorld,
    type GameWorld,
} from '../src/engine/ecs/world'
import { defineZone } from '../src/engine/ecs/zones'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/engine/voxel/palette'

/**
 * Slice 1.5 producer-emitter tests. The script engine doesn't appear
 * here — these tests verify that the upstream systems push the right
 * shapes into `world.scriptTriggerEvents` so the script engine can
 * dispatch them. (script-engine-system.test.ts already covers the
 * dispatch path against a stubbed queue.)
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

test('ZoneTriggerSystem pushes zone-enter when player enters a trigger zone', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    defineZone(world, {
        id: 'zone.x',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 4, y: 4, z: 4 },
    })
    spawnPlayer(world, { x: 2, y: 1, z: 2 })

    const sys = createZoneTriggerSystem(chunks, { log: false })
    sys.update(world, 1 / 60)

    const events = consumeScriptTriggerEvents(world)
    const enter = events.find((e) => e.kind === 'zone-enter')
    assert.ok(enter, 'a zone-enter event must be queued')
    if (enter.kind === 'zone-enter') {
        assert.equal(enter.zoneId, 'zone.x')
        assert.equal(enter.source, 'player')
    }
})

test('ZoneTriggerSystem pushes zone-exit when player leaves', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    defineZone(world, {
        id: 'zone.x',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 4, y: 4, z: 4 },
    })
    const eid = spawnPlayer(world, { x: 2, y: 1, z: 2 })
    const sys = createZoneTriggerSystem(chunks, { log: false })

    // First tick: player is inside the zone — zone-enter fires.
    sys.update(world, 1 / 60)
    consumeScriptTriggerEvents(world)  // drop enter

    // Move the player outside. Next tick should fire zone-exit.
    Position.x[eid] = 20
    Position.y[eid] = 1
    Position.z[eid] = 20
    sys.update(world, 1 / 60)

    const events = consumeScriptTriggerEvents(world)
    const exit = events.find((e) => e.kind === 'zone-exit')
    assert.ok(exit, 'a zone-exit event must be queued when the player leaves')
})

test('zone-exit fires only once per visit (no re-fire while still outside)', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    defineZone(world, {
        id: 'zone.x',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 4, y: 4, z: 4 },
    })
    const eid = spawnPlayer(world, { x: 2, y: 1, z: 2 })
    const sys = createZoneTriggerSystem(chunks, { log: false })

    sys.update(world, 1 / 60)
    consumeScriptTriggerEvents(world)

    Position.x[eid] = 20
    sys.update(world, 1 / 60)
    const first = consumeScriptTriggerEvents(world)
    assert.equal(first.filter((e) => e.kind === 'zone-exit').length, 1)

    // Player still outside; no more events.
    sys.update(world, 1 / 60)
    sys.update(world, 1 / 60)
    const subsequent = consumeScriptTriggerEvents(world)
    assert.equal(subsequent.length, 0)
})

test('re-entering after exit emits a fresh zone-enter', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    defineZone(world, {
        id: 'zone.x',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 4, y: 4, z: 4 },
    })
    const eid = spawnPlayer(world, { x: 2, y: 1, z: 2 })
    const sys = createZoneTriggerSystem(chunks, { log: false })

    sys.update(world, 1 / 60)
    Position.x[eid] = 20
    sys.update(world, 1 / 60)
    consumeScriptTriggerEvents(world)

    // Player walks back in.
    Position.x[eid] = 2
    sys.update(world, 1 / 60)
    const events = consumeScriptTriggerEvents(world)
    assert.equal(events.filter((e) => e.kind === 'zone-enter').length, 1)
})

test('clearing all zones synthesises exit events for active overlaps', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    defineZone(world, {
        id: 'zone.x',
        kind: 'trigger',
        min: { x: 0, y: 0, z: 0 },
        max: { x: 4, y: 4, z: 4 },
    })
    spawnPlayer(world, { x: 2, y: 1, z: 2 })
    const sys = createZoneTriggerSystem(chunks, { log: false })

    sys.update(world, 1 / 60)
    consumeScriptTriggerEvents(world)

    // Remove all zones — a level swap, for example. The system's
    // bookkeeping should emit a synthetic exit for the entity we
    // were tracking.
    world.zones.clear()
    sys.update(world, 1 / 60)
    const events = consumeScriptTriggerEvents(world)
    assert.equal(events.filter((e) => e.kind === 'zone-exit').length, 1)
})

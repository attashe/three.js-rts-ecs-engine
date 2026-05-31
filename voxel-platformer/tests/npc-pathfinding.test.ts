import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents } from 'bitecs'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE, BLOCK } from '../src/engine/voxel/palette'
import { findPath } from '../src/engine/voxel/voxel-path'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import { createEntity } from '../src/engine/ecs/entity'
import { PlayerControlled, Position } from '../src/engine/ecs/components'
import { createNpcBehaviourSystem } from '../src/engine/ecs/systems/npc-behaviour-system'
import type { NpcRuntimeState } from '../src/game/npcs/npc-types'
import {
    NPC_TARGET_PLAYER, setNpcHostile, setNpcPerceptionRadius, setNpcWaypoints, stopNpc,
} from '../src/game/npcs/npc-ai'

function flatWorld(size = 14): ChunkManager {
    const m = new ChunkManager(DEFAULT_PALETTE)
    for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) m.setVoxel(x, 0, z, BLOCK.grass)
    }
    return m
}

test('findPath walks straight across a flat floor', () => {
    const m = flatWorld()
    const path = findPath(m, { x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 })
    assert.ok(path, 'expected a path')
    assert.equal(path![0]!.x, 0)
    assert.equal(path![path!.length - 1]!.x, 5)
    assert.equal(path!.length, 6) // 4-connected: 5 steps = 6 cells
})

test('findPath returns null when the goal is walled off', () => {
    const m = flatWorld()
    for (let z = 0; z < 14; z++) { // span the full floor so there's no way around
        m.setVoxel(3, 1, z, BLOCK.stone)
        m.setVoxel(3, 2, z, BLOCK.stone)
    }
    const path = findPath(m, { x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 })
    assert.equal(path, null)
})

test('findPath routes around dynamic blockers via isBlocked', () => {
    const m = flatWorld()
    const blocked = new Set(['2,1,0', '3,1,0'])
    const path = findPath(m, { x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, {
        isBlocked: (x, y, z) => blocked.has(`${x},${y},${z}`),
    })
    assert.ok(path, 'expected a detour path')
    assert.ok(!path!.some((p) => blocked.has(`${p.x},${p.y},${p.z}`)), 'path avoids blocked cells')
})

// ── AI control helpers ──

function fakeWorld(runtime: NpcRuntimeState): GameWorld {
    return { npcRuntimeById: new Map([[runtime.id, runtime]]) } as unknown as GameWorld
}

function makeRuntime(): NpcRuntimeState {
    return {
        id: 'guard', position: { x: 4, y: 1, z: 4 }, yaw: 0,
        colliderRadius: 0.35, colliderHeight: 1.6, hp: 2,
        requestAttack: false, requestDie: false, dying: false,
        ai: null, zoneId: null, obstacleId: null,
    }
}

test('setNpcWaypoints lazily creates a brain and stores the route', () => {
    const rt = makeRuntime()
    const world = fakeWorld(rt)
    assert.equal(rt.ai, null)
    assert.ok(setNpcWaypoints(world, 'guard', [{ x: 1, y: 1, z: 1 }, { x: 8, y: 1, z: 1 }]))
    assert.equal(rt.ai!.waypoints.length, 2)
    assert.equal(rt.ai!.waypointIndex, 0)
    // Home defaults to the spawn post.
    assert.deepEqual(rt.ai!.home, { x: 4, y: 1, z: 4 })
})

test('setNpcHostile toggles player + per-id hostility; stop clears the route', () => {
    const rt = makeRuntime()
    const world = fakeWorld(rt)
    setNpcHostile(world, 'guard', NPC_TARGET_PLAYER, true)
    setNpcHostile(world, 'guard', 'rat', true)
    assert.equal(rt.ai!.hostileToPlayer, true)
    assert.ok(rt.ai!.hostileIds.has('rat'))
    setNpcHostile(world, 'guard', 'rat', false)
    assert.ok(!rt.ai!.hostileIds.has('rat'))

    stopNpc(world, 'guard')
    assert.equal(rt.ai!.waypoints.length, 0)
})

test('AI helpers no-op on unknown / dying NPCs', () => {
    const rt = makeRuntime()
    rt.dying = true
    const world = fakeWorld(rt)
    assert.equal(setNpcWaypoints(world, 'guard', [{ x: 0, y: 0, z: 0 }]), false)
    assert.equal(setNpcWaypoints(world, 'missing', []), false)
})

// ── behaviour system integration (real GameWorld + ChunkManager) ──

function spawnRuntimeNpc(world: GameWorld, id: string, x: number, z: number): NpcRuntimeState {
    const rt: NpcRuntimeState = {
        id, position: { x, y: 1, z }, yaw: 0,
        colliderRadius: 0.35, colliderHeight: 1.6, hp: 2,
        requestAttack: false, requestDie: false, dying: false,
        ai: null, zoneId: null, obstacleId: null,
    }
    world.npcRuntimeById.set(id, rt)
    return rt
}

test('a multi-waypoint patrol advances and emits npc-reached', () => {
    const chunks = flatWorld()
    const world = createGameWorld()
    const rt = spawnRuntimeNpc(world, 'guard', 2, 2)
    setNpcWaypoints(world, 'guard', [{ x: 2, y: 1, z: 2 }, { x: 6, y: 1, z: 2 }])

    const sys = createNpcBehaviourSystem(chunks)
    for (let i = 0; i < 600; i++) sys.update!(world, 1 / 60)

    const reached = world.scriptTriggerEvents.filter((e) => e.kind === 'npc-reached')
    assert.ok(reached.length >= 2, `expected the patrol to reach waypoints, got ${reached.length}`)
    // It should be patrolling between the two posts, not stuck.
    assert.ok(rt.position.x >= 2 && rt.position.x <= 7)
})

test('a hostile NPC spots and paths toward the player', () => {
    const chunks = flatWorld()
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [Position, PlayerControlled])
    Position.x[player] = 11
    Position.y[player] = 1
    Position.z[player] = 2

    const rt = spawnRuntimeNpc(world, 'orc', 2, 2)
    setNpcHostile(world, 'orc', NPC_TARGET_PLAYER, true)
    setNpcPerceptionRadius(world, 'orc', 20)

    const sys = createNpcBehaviourSystem(chunks)
    for (let i = 0; i < 600; i++) sys.update!(world, 1 / 60)

    assert.ok(world.scriptTriggerEvents.some((e) => e.kind === 'npc-spotted-enemy'),
        'expected an npc-spotted-enemy event')
    // It should have closed most of the gap toward the player at x=11.
    assert.ok(rt.position.x > 7, `expected the orc to advance toward the player, x=${rt.position.x}`)
})

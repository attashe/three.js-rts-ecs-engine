import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents, query } from 'bitecs'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE, BLOCK } from '../src/engine/voxel/palette'
import { findPath } from '../src/engine/voxel/voxel-path'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import { createEntity } from '../src/engine/ecs/entity'
import { BoxCollider, Health, MovingObject, PlayerControlled, Position, Rotation, Shield, Velocity } from '../src/engine/ecs/components'
import { createNpcBehaviourSystem } from '../src/engine/ecs/systems/npc-behaviour-system'
import { createMeleeCombatSystem } from '../src/engine/ecs/systems/melee-combat-system'
import { createArrowHitSystem } from '../src/engine/ecs/systems/arrow-hit-system'
import { MovingObjectKind, spawnArrowProjectile } from '../src/game/moving-objects'
import { __resetDebugInfoCache, setDebugInfoEnabled } from '../src/engine/render/render-settings'
import { damageNpc, type NpcRuntimeState } from '../src/game/npcs/npc-types'
import { HUMANOID_ANIM_TIMINGS } from '../src/game/anim/clip-timings'
import { METAL_HELMET_ITEM_ID } from '../src/game/equipment-items'
import {
    NPC_TARGET_PLAYER, setNpcFlee, setNpcHostile, setNpcPerceptionRadius, setNpcWaypoints, stopNpc,
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
        invulnerable: false, requestAttack: false, requestDie: false, dying: false,
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
        invulnerable: false, requestAttack: false, requestDie: false, dying: false,
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

test('an attacked NPC retaliates: a player hit turns it hostile and it engages', () => {
    const chunks = flatWorld()
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [Position, PlayerControlled])
    Position.x[player] = 6
    Position.y[player] = 1
    Position.z[player] = 4

    const victim = spawnRuntimeNpc(world, 'farmer', 4, 4) // neutral, brain-less, 2 units away

    // The player lands a non-lethal strike: damage alone only records it
    // (the brain-less → recorded contract is unit-tested in npc-system).
    assert.equal(damageNpc(victim, 1, { byPlayer: true }), false)
    assert.equal(victim.provoked, true)

    // One behaviour tick consumes the provocation and turns it hostile.
    const sys = createNpcBehaviourSystem(chunks)
    sys.update!(world, 1 / 60)
    assert.equal(victim.provoked, false, 'the flag is consumed once')
    assert.equal(victim.ai?.hostileToPlayer, true, 'the struck NPC is now hostile to the player')
    assert.ok(world.scriptTriggerEvents.some((e) => e.kind === 'npc-spotted-enemy'),
        'the retaliating NPC acquires its attacker as a target')
})

test('hammer NPC attacks use a timed circular impact', () => {
    const chunks = flatWorld()
    const world = createGameWorld()
    const attacker = spawnRuntimeNpc(world, 'guardian', 4, 4)
    attacker.attackClip = 'hammerAttack'
    const target = spawnRuntimeNpc(world, 'target', 4, 5)
    target.hp = 2
    setNpcHostile(world, 'guardian', 'target', true)
    setNpcPerceptionRadius(world, 'guardian', 8)

    const sys = createNpcBehaviourSystem(chunks)
    const combat = createMeleeCombatSystem()
    sys.update!(world, 1 / 60)

    assert.equal(attacker.requestAttack, true)
    assert.equal(attacker.requestAttackClip, 'hammerAttack')
    assert.ok(world.meleeAttacks.has('npc:guardian'), 'hammer strike should schedule a timed melee attack')
    assert.equal(target.hp, 2)

    combat.update(world, HUMANOID_ANIM_TIMINGS.hammerImpact - 0.02)
    assert.equal(target.hp, 2)

    combat.update(world, 0.04)
    assert.equal(target.hp, 1)
})

test('ordinary NPC attacks expose an active wedge hitbox and damage on active', () => {
    __resetDebugInfoCache()
    setDebugInfoEnabled(true)
    const chunks = flatWorld()
    const world = createGameWorld()
    const attacker = spawnRuntimeNpc(world, 'guard', 4, 4)
    const target = spawnRuntimeNpc(world, 'target', 4, 5)
    setNpcHostile(world, 'guard', 'target', true)
    setNpcPerceptionRadius(world, 'guard', 8)

    const sys = createNpcBehaviourSystem(chunks)
    const combat = createMeleeCombatSystem()
    sys.update!(world, 1 / 60)

    assert.equal(target.hp, 2)
    assert.equal(world.debugHitboxes.some((hitbox) => hitbox.id === 'npc:guard:attack'), false)

    combat.update(world, 0.29)
    assert.equal(target.hp, 2)
    assert.equal(world.debugHitboxes.some((hitbox) => hitbox.id === 'npc:guard:attack'), false)

    combat.update(world, 0.03)
    assert.ok(
        world.debugHitboxes.some((hitbox) => hitbox.kind === 'wedge' && hitbox.id === 'npc:guard:attack'),
        'ordinary melee attacks should add a visible active wedge',
    )
    assert.equal(target.hp, 1)
})

test('ordinary NPC slash can be avoided outside the locked wedge', () => {
    const chunks = flatWorld()
    const world = createGameWorld()
    const attacker = spawnRuntimeNpc(world, 'guard', 4, 4)
    const target = spawnRuntimeNpc(world, 'target', 4, 5)
    setNpcHostile(world, 'guard', 'target', true)
    setNpcPerceptionRadius(world, 'guard', 8)

    const sys = createNpcBehaviourSystem(chunks)
    const combat = createMeleeCombatSystem()
    sys.update!(world, 1 / 60)

    combat.update(world, 0.26)
    target.position.x = 6
    target.position.z = 4
    combat.update(world, 0.06)

    assert.equal(target.hp, 2)
})

test('shield spearman raises guard on sight and lowers it while thrusting', () => {
    const chunks = flatWorld(18)
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [Position, PlayerControlled])
    Position.x[player] = 9
    Position.y[player] = 1
    Position.z[player] = 4

    const spearman = spawnRuntimeNpc(world, 'spearman', 4, 4)
    spearman.attackClip = 'spearAttack'
    spearman.shieldGuard = {
        raised: false,
        arcCos: Math.cos((65 * Math.PI) / 180),
        minY: -0.2,
        maxY: 1.75,
    }
    setNpcHostile(world, 'spearman', NPC_TARGET_PLAYER, true)
    setNpcPerceptionRadius(world, 'spearman', 10)

    const sys = createNpcBehaviourSystem(chunks)
    sys.update!(world, 1 / 60)
    assert.equal(spearman.shieldGuard.raised, true, 'spearman should raise shield when tracking a visible enemy')
    assert.equal(world.meleeAttacks.has('npc:spearman'), false)

    Position.x[player] = 4
    Position.z[player] = 5
    sys.update!(world, 1 / 60)

    assert.equal(spearman.requestAttackClip, 'spearAttack')
    assert.equal(spearman.shieldGuard.raised, false, 'spearman should drop the shield during its own attack')
    assert.equal(world.meleeAttacks.get('npc:spearman')?.def.id, 'npc-spear-thrust')
})

// ── migrated NPC archetypes: archer (ranged) + rabbit (flee) ──

test('an archer NPC fires a hostile arrow at a ranged target instead of meleeing', () => {
    const chunks = flatWorld(18)
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [Position, PlayerControlled])
    Position.x[player] = 4
    Position.y[player] = 1
    Position.z[player] = 10 // 6 units away from the archer — inside bow range, beyond melee

    const archer = spawnRuntimeNpc(world, 'archer', 4, 4)
    archer.attackClip = 'shoot'
    setNpcHostile(world, 'archer', NPC_TARGET_PLAYER, true)
    setNpcPerceptionRadius(world, 'archer', 14)

    const sys = createNpcBehaviourSystem(chunks)
    sys.update!(world, 1 / 60)

    assert.equal(archer.requestAttackClip, 'shoot', 'archer plays the draw/release clip')
    // It stays at range (does not path into melee) and spawns one hostile arrow.
    assert.ok(archer.position.x === 4 && archer.position.z === 4, 'archer holds its ground at bow range')
    const arrows = [...query(world, [MovingObject, Velocity])].filter(
        (a) => MovingObject.kind[a] === MovingObjectKind.Arrow && MovingObject.hostile[a] === 1,
    )
    assert.equal(arrows.length, 1, 'archer fired exactly one hostile arrow')
    assert.ok(Velocity.z[arrows[0]!]! > 0, 'the arrow flies toward the player (+z)')
})

test('a fleeing rabbit runs away from the player and never attacks', () => {
    const chunks = flatWorld(24)
    const world = createGameWorld()
    const player = createEntity(world)
    addComponents(world, player, [Position, PlayerControlled])
    Position.x[player] = 4
    Position.y[player] = 1
    Position.z[player] = 12

    const rabbit = spawnRuntimeNpc(world, 'rabbit', 9, 12) // 5 units +x from the player
    setNpcFlee(world, 'rabbit', true)
    setNpcPerceptionRadius(world, 'rabbit', 12)
    const startX = rabbit.position.x

    const sys = createNpcBehaviourSystem(chunks)
    for (let i = 0; i < 120; i++) sys.update!(world, 1 / 60)

    assert.ok(rabbit.position.x > startX + 1, `rabbit should flee away from the player (+x), x=${rabbit.position.x}`)
    assert.equal(rabbit.requestAttack, false, 'prey never attacks')
    assert.equal(world.meleeAttacks.has('npc:rabbit'), false)
})

test('a hostile arrow damages the player, but a raised frontal shield blocks it', () => {
    function setupPlayer(world: GameWorld): number {
        const player = createEntity(world)
        addComponents(world, player, [Position, PlayerControlled, BoxCollider, Health, Rotation, Shield])
        Position.x[player] = 8
        Position.y[player] = 1
        Position.z[player] = 8
        BoxCollider.x[player] = 0.4
        BoxCollider.y[player] = 0.9
        BoxCollider.z[player] = 0.4
        Health.max[player] = 6
        Health.current[player] = 6
        return player
    }

    // Unshielded: the incoming arrow lands.
    {
        const chunks = flatWorld(16)
        const world = createGameWorld()
        const player = setupPlayer(world)
        spawnArrowProjectile(world, { x: 8.6, y: 2, z: 8 }, { x: -30, y: 0, z: 0 }, { hostile: true })
        const sys = createArrowHitSystem(chunks)
        sys.update!(world, 1 / 60)
        assert.ok(Health.current[player]! < 6, 'a hostile arrow damages the unshielded player')
    }

    // Shielded toward the incoming arrow (+x): blocked, no damage.
    {
        const chunks = flatWorld(16)
        const world = createGameWorld()
        const player = setupPlayer(world)
        Rotation.y[player] = Math.PI / 2 // face +x, toward where the arrow comes from
        Shield.raised[player] = 1
        Shield.blockArcCos[player] = Math.cos(Math.PI * 0.4)
        Shield.blockYawOffset[player] = 0
        Shield.minY[player] = 0.3
        Shield.maxY[player] = 2.2
        spawnArrowProjectile(world, { x: 8.6, y: 2, z: 8 }, { x: -30, y: 0, z: 0 }, { hostile: true })
        const sys = createArrowHitSystem(chunks)
        sys.update!(world, 1 / 60)
        assert.equal(Health.current[player], 6, 'a raised frontal shield blocks the arrow')
    }

    // Metal helmet: low roll blocks incoming hostile arrow damage.
    {
        const chunks = flatWorld(16)
        const world = createGameWorld()
        const player = setupPlayer(world)
        world.playerSettings.equipment.head = METAL_HELMET_ITEM_ID
        spawnArrowProjectile(world, { x: 8.6, y: 2, z: 8 }, { x: -30, y: 0, z: 0 }, { hostile: true })
        const sys = createArrowHitSystem(chunks, { helmetBlockRoll: () => 0.1 })
        sys.update!(world, 1 / 60)
        assert.equal(Health.current[player], 6, 'metal helmet low roll blocks hostile arrow damage')
    }
})

test('a guarding NPC shield deflects a player arrow from the front', () => {
    function setupGuard(world: GameWorld): NpcRuntimeState {
        const npc = spawnRuntimeNpc(world, 'warrior', 8, 8)
        npc.yaw = Math.PI / 2 // face +x, toward where the player arrow comes from
        return npc
    }

    // Guard raised toward the incoming arrow: deflected, no damage.
    {
        const chunks = flatWorld(20)
        const world = createGameWorld()
        const npc = setupGuard(world)
        npc.shieldGuard = { raised: true, arcCos: Math.cos((65 * Math.PI) / 180), minY: -0.2, maxY: 1.75 }
        spawnArrowProjectile(world, { x: 8.6, y: 1.5, z: 8 }, { x: -30, y: 0, z: 0 }) // player arrow (non-hostile)
        const sys = createArrowHitSystem(chunks)
        sys.update!(world, 1 / 60)
        assert.equal(npc.hp, 2, 'a raised front shield deflects the player arrow')
    }

    // Same arrow, no guard raised: it lands and damages the NPC.
    {
        const chunks = flatWorld(20)
        const world = createGameWorld()
        const npc = setupGuard(world)
        spawnArrowProjectile(world, { x: 8.6, y: 1.5, z: 8 }, { x: -30, y: 0, z: 0 })
        const sys = createArrowHitSystem(chunks)
        sys.update!(world, 1 / 60)
        assert.ok(npc.hp < 2, 'an unguarded NPC takes the player arrow')
    }

    // Guard raised but cooling down: it should be open to arrows.
    {
        const chunks = flatWorld(20)
        const world = createGameWorld()
        const npc = setupGuard(world)
        npc.shieldGuard = { raised: true, arcCos: Math.cos((65 * Math.PI) / 180), minY: -0.2, maxY: 1.75, cooldownSeconds: 0.5 }
        spawnArrowProjectile(world, { x: 8.6, y: 1.5, z: 8 }, { x: -30, y: 0, z: 0 })
        const sys = createArrowHitSystem(chunks)
        sys.update!(world, 1 / 60)
        assert.ok(npc.hp < 2, 'cooling-down NPC shield should not deflect the arrow')
    }
})

test('NPC stops moving and turning once melee attack locks', () => {
    const chunks = flatWorld()
    const world = createGameWorld()
    const attacker = spawnRuntimeNpc(world, 'guard', 4, 4)
    const target = spawnRuntimeNpc(world, 'target', 4, 5)
    setNpcHostile(world, 'guard', 'target', true)
    setNpcPerceptionRadius(world, 'guard', 8)

    const sys = createNpcBehaviourSystem(chunks)
    const combat = createMeleeCombatSystem()
    sys.update!(world, 1 / 60)
    combat.update(world, 0.26)

    target.position.x = 6
    target.position.z = 4
    const before = { x: attacker.position.x, z: attacker.position.z, yaw: attacker.yaw }
    sys.update!(world, 0.1)

    assert.deepEqual({ x: attacker.position.x, z: attacker.position.z, yaw: attacker.yaw }, before)
})

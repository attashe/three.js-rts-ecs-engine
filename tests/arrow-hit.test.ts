import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent, query } from 'bitecs'
import { BoxCollider, Faction, Health, MovingObject, PlayerControlled, Position, Rotation, Shield } from '../src/client/engine/ecs/components'
import { createArrowHitSystem } from '../src/client/engine/ecs/systems/arrow-hit-system'
import { FactionId } from '../src/client/engine/ecs/factions'
import { createGameWorld } from '../src/client/engine/ecs/world'
import { ChunkManager } from '../src/client/engine/voxel/chunk-manager'
import { DEFAULT_PALETTE } from '../src/client/engine/voxel/palette'
import { spawnArrowProjectile } from '../src/client/game/moving-objects'
import { spawnGuardNpc, spawnHunterNpc } from '../src/client/game/npc'

test('ArrowHitSystem: owned enemy arrows can hit player-controlled targets', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const archer = addEntity(world)
    addComponent(world, archer, Faction)
    Faction.id[archer] = FactionId.Hostile

    const player = addEntity(world)
    addComponent(world, player, Position)
    addComponent(world, player, BoxCollider)
    addComponent(world, player, Health)
    addComponent(world, player, Faction)
    addComponent(world, player, PlayerControlled)
    Position.x[player] = 0
    Position.y[player] = 0
    Position.z[player] = 1.25
    BoxCollider.x[player] = 0.35
    BoxCollider.y[player] = 0.9
    BoxCollider.z[player] = 0.35
    Health.max[player] = 100
    Health.current[player] = 100
    Faction.id[player] = FactionId.Player

    spawnArrowProjectile(
        world,
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 0, z: 10 },
        archer,
    )

    createArrowHitSystem(chunks, { baseDamage: 10, speedBonus: 0 }).update(world, 0.2)

    assert.equal(Health.current[player], 90)
})

test('ArrowHitSystem: raised player shield blocks arrows from the front', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const archer = addEntity(world)
    addComponent(world, archer, Faction)
    Faction.id[archer] = FactionId.Hostile

    const player = addShieldedPlayer(world)
    Shield.raised[player] = 1
    Rotation.y[player] = 0

    spawnArrowProjectile(
        world,
        { x: 0, y: 1, z: 1.25 },
        { x: 0, y: 0, z: -10 },
        archer,
    )

    createArrowHitSystem(chunks, { baseDamage: 10, speedBonus: 0 }).update(world, 0.2)

    assert.equal(Health.current[player], 100)
    assert.equal(query(world, [MovingObject]).length, 0)
})

test('ArrowHitSystem: lowered shield does not block arrows', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const archer = addEntity(world)
    addComponent(world, archer, Faction)
    Faction.id[archer] = FactionId.Hostile

    const player = addShieldedPlayer(world)
    Shield.raised[player] = 0
    Rotation.y[player] = 0

    spawnArrowProjectile(
        world,
        { x: 0, y: 1, z: 1.25 },
        { x: 0, y: 0, z: -10 },
        archer,
    )

    createArrowHitSystem(chunks, { baseDamage: 10, speedBonus: 0 }).update(world, 0.2)

    assert.equal(Health.current[player], 90)
})

test('ArrowHitSystem: raised shield does not block arrows from behind', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const archer = addEntity(world)
    addComponent(world, archer, Faction)
    Faction.id[archer] = FactionId.Hostile

    const player = addShieldedPlayer(world)
    Shield.raised[player] = 1
    Rotation.y[player] = 0

    spawnArrowProjectile(
        world,
        { x: 0, y: 1, z: -1.25 },
        { x: 0, y: 0, z: 10 },
        archer,
    )

    createArrowHitSystem(chunks, { baseDamage: 10, speedBonus: 0 }).update(world, 0.2)

    assert.equal(Health.current[player], 90)
})

test('ArrowHitSystem: non-player actor shields block arrows from the front', () => {
    const world = createGameWorld()
    const chunks = new ChunkManager(DEFAULT_PALETTE)

    const archer = addEntity(world)
    addComponent(world, archer, Faction)
    Faction.id[archer] = FactionId.Hostile

    const guard = addShieldedActor(world, FactionId.Neutral)
    Shield.raised[guard] = 1
    Rotation.y[guard] = 0

    spawnArrowProjectile(
        world,
        { x: 0, y: 1, z: 1.25 },
        { x: 0, y: 0, z: -10 },
        archer,
    )

    createArrowHitSystem(chunks, { baseDamage: 10, speedBonus: 0 }).update(world, 0.2)

    assert.equal(Health.current[guard], 100)
    assert.equal(query(world, [MovingObject]).length, 0)
})

test('guard and hunter spawns carry active shield components', () => {
    const world = createGameWorld()
    const guard = spawnGuardNpc(world, { position: { x: 0, y: 1, z: 0 } })
    const hunter = spawnHunterNpc(world, {
        position: { x: 2, y: 1, z: 0 },
        huntingGround: { x: 5, y: 1, z: 0 },
    })

    assert.equal(hasComponent(world, guard, Shield), true)
    assert.equal(hasComponent(world, hunter, Shield), true)
    assert.equal(Shield.raised[guard], 1)
    assert.equal(Shield.raised[hunter], 1)
})

function addShieldedPlayer(world: ReturnType<typeof createGameWorld>): number {
    const player = addShieldedActor(world, FactionId.Player)
    addComponent(world, player, PlayerControlled)
    return player
}

function addShieldedActor(world: ReturnType<typeof createGameWorld>, faction: FactionId): number {
    const player = addEntity(world)
    addComponent(world, player, Position)
    addComponent(world, player, Rotation)
    addComponent(world, player, BoxCollider)
    addComponent(world, player, Health)
    addComponent(world, player, Faction)
    addComponent(world, player, Shield)
    Position.x[player] = 0
    Position.y[player] = 0
    Position.z[player] = 0
    BoxCollider.x[player] = 0.35
    BoxCollider.y[player] = 0.9
    BoxCollider.z[player] = 0.35
    Health.max[player] = 100
    Health.current[player] = 100
    Faction.id[player] = faction
    Shield.blockArcCos[player] = Math.cos(Math.PI * 0.42)
    Shield.minY[player] = 0.45
    Shield.maxY[player] = 1.45
    return player
}

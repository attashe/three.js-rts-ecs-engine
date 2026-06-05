import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents, hasComponent, query } from 'bitecs'
import { BoxCollider, Health, MovingObject, PlayerControlled, Position, Rotation, Velocity } from '../src/engine/ecs/components'
import { createEntity } from '../src/engine/ecs/entity'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import {
    DYNAMITE_FUSE_SECONDS,
    createDynamiteSystem,
    explodeAt,
} from '../src/game/dynamite-system'
import { MovingObjectKind, spawnDynamiteProjectile, spawnFallingStone } from '../src/game/moving-objects'
import { normalizeNpcConfig } from '../src/game/npcs/npc-types'
import { registerRuntimeNpcs } from '../src/game/npcs/npc-runtime'

function spawnPlayer(world: GameWorld, x: number, z: number): number {
    const eid = createEntity(world)
    addComponents(world, eid, [PlayerControlled, Position, Rotation, BoxCollider, Health])
    Position.x[eid] = x
    Position.y[eid] = 0
    Position.z[eid] = z
    BoxCollider.x[eid] = 0.35
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.35
    Health.current[eid] = 10
    Health.max[eid] = 10
    return eid
}

test('dynamite explodes after its fuse and despawns once', () => {
    const world = createGameWorld()
    const eid = spawnDynamiteProjectile(world, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 })
    MovingObject.age[eid] = DYNAMITE_FUSE_SECONDS + 0.01
    let explosions = 0

    createDynamiteSystem({ onExplode: () => { explosions++ } }).update(world, 1 / 60)

    assert.equal(explosions, 1)
    assert.equal(hasComponent(world, eid, MovingObject), false)
    assert.equal(query(world, [MovingObject]).some((id) => MovingObject.kind[id] === MovingObjectKind.Dynamite), false)
})

test('explosion damages player and neutral NPCs using target volume distance', () => {
    const world = createGameWorld()
    const player = spawnPlayer(world, 0, 0)
    registerRuntimeNpcs(world, [
        normalizeNpcConfig({ id: 'near', model: 'keeper', position: { x: 1.2, y: 0, z: 0 } }),
        normalizeNpcConfig({ id: 'far', model: 'keeper', position: { x: 6, y: 0, z: 0 } }),
    ])
    const near = world.npcRuntimeById.get('near')!
    const far = world.npcRuntimeById.get('far')!

    const event = explodeAt(world, { x: 0, y: 1, z: 0 })

    assert.ok(Health.current[player] < 10, 'player should take self/friendly-fire damage')
    assert.ok(near.hp < near.maxHp!, 'near neutral NPC should take damage')
    assert.equal(far.hp, far.maxHp, 'far NPC outside the volume should be untouched')
    assert.equal(event.damagedActors, 2)
})

test('explosion applies radial push to physics bodies', () => {
    const world = createGameWorld()
    const stone = spawnFallingStone(world, { x: 0, y: 1, z: 1.1 }, { x: 0, y: 0, z: 0 })

    const event = explodeAt(world, { x: 0, y: 1, z: 0 })

    assert.ok(event.pushedBodies >= 1)
    assert.ok(Velocity.z[stone]! > 0, `expected stone to be pushed outward, got z velocity ${Velocity.z[stone]}`)
})

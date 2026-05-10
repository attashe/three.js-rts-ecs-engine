import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, query } from 'bitecs'
import { MovingObject, Sleeping } from '../src/client/engine/ecs/components'
import { createFallingStoneSpawnerSystem } from '../src/client/engine/ecs/systems/moving-object-system'
import { createGameWorld } from '../src/client/engine/ecs/world'
import { MovingObjectKind, STONE_TIER } from '../src/client/game/moving-objects'

test('FallingStoneSpawnerSystem ignores settled sleeping stones when enforcing moving-stone cap', () => {
    const world = createGameWorld()
    const settled = addEntity(world)
    addComponent(world, settled, MovingObject)
    addComponent(world, settled, Sleeping)
    MovingObject.kind[settled] = MovingObjectKind.Stone

    createFallingStoneSpawnerSystem([{
        position: { x: 0, y: 4, z: 0 },
        velocity: { x: 1, y: 0, z: 0 },
        interval: 10,
        options: STONE_TIER.boulder,
    }], { maxMovingStones: 1 }).update(world, 1 / 60)

    const stones = query(world, [MovingObject]).filter((eid) => MovingObject.kind[eid] === MovingObjectKind.Stone)
    assert.equal(stones.length, 2)
})

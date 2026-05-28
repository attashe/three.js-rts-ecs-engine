import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, hasComponent, query } from 'bitecs'
import { MovingObject, Sleeping, Velocity } from '../src/engine/ecs/components'
import { createFallingStoneSpawnerSystem } from '../src/engine/ecs/systems/moving-object-system'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import { MovingObjectKind, type StoneFallSpawnerConfig } from '../src/game/moving-objects'

test('falling stone spawner honors initial delay, per-spawner max active count, and script controller', () => {
    const world = createGameWorld()
    const spawner: StoneFallSpawnerConfig = {
        id: 'rocks',
        position: { x: 1, y: 5, z: 1 },
        velocity: { x: 0, y: -2, z: 0 },
        interval: 1,
        delay: 0.5,
        maxLive: 1,
        size: 0.2,
    }
    const system = createFallingStoneSpawnerSystem([spawner], { maxMovingStones: 10 })
    system.init?.(world)

    system.update(world, 0.49)
    assert.equal(activeStoneCount(world), 0)

    system.update(world, 0.02)
    assert.equal(activeStoneCount(world), 1)

    system.update(world, 1.1)
    assert.equal(activeStoneCount(world), 1, 'max active cap prevents a second active stone')

    const controller = world.stoneSpawnersById.get('rocks')
    assert.ok(controller)
    controller.setEnabled(false)
    assert.equal(controller.isEnabled(), false)
    assert.equal(controller.trigger(3), 0, 'disabled spawners do not trigger')

    sleepAllStones(world)
    controller.setEnabled(true)
    assert.equal(controller.trigger(3), 1, 'trigger respects the same max active cap')
    assert.equal(activeStoneCount(world), 1)

    system.dispose?.()
    assert.equal(world.stoneSpawnersById.has('rocks'), false)
})

function activeStoneCount(world: GameWorld): number {
    const eids = query(world, [MovingObject])
    let count = 0
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        if (
            MovingObject.kind[eid] === MovingObjectKind.Stone &&
            hasComponent(world, eid, Velocity) &&
            !hasComponent(world, eid, Sleeping)
        ) {
            count++
        }
    }
    return count
}

function sleepAllStones(world: GameWorld): void {
    const eids = query(world, [MovingObject])
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        if (MovingObject.kind[eid] !== MovingObjectKind.Stone) continue
        addComponent(world, eid, Sleeping)
    }
}

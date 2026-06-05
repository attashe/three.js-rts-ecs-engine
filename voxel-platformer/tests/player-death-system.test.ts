import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { BoxCollider, PlayerControlled, Position } from '../src/engine/ecs/components'
import { createPlayerDeathSystem } from '../src/engine/ecs/systems/player-death-system'
import { createGameWorld, type DeathReason, type GameWorld } from '../src/engine/ecs/world'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'

test('player death system kills the player on lava contact', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.lava)
    const world = createGameWorld()
    addPlayer(world, 0.5, 0, 0.5)
    let seenReason: DeathReason | null = null

    createPlayerDeathSystem({
        chunks,
        onDeath(reason) { seenReason = reason },
    }).update(world, 1 / 60)

    assert.equal(world.deathSignal, 'burned-by-lava')
    assert.equal(seenReason, 'burned-by-lava')
    assert.equal(world.log.at(-1), 'You touched lava.')
})

test('player death system does not kill the player on water contact', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.water)
    const world = createGameWorld()
    addPlayer(world, 0.5, 0, 0.5)

    createPlayerDeathSystem({ chunks }).update(world, 1 / 60)

    assert.equal(world.deathSignal, null)
})

function addPlayer(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, PlayerControlled)
    Position.x[eid] = x
    Position.y[eid] = y
    Position.z[eid] = z
    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    return eid
}

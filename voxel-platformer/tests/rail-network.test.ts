import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity, hasComponent } from 'bitecs'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import {
    BLOCK,
    DEFAULT_PALETTE,
    isCollidable,
    isRailBlock,
    isRaycastTarget,
    isRenderableVoxel,
    railBlockIndex,
    voxelOpacity,
} from '../src/engine/voxel/palette'
import { BoxCollider, Position, RidingCart, Velocity } from '../src/engine/ecs/components'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { GameAction } from '../src/game/actions'
import {
    chooseRailExit,
    railConnectionMask,
    railNeighborCell,
    railVariantFromMask,
    RailDirection,
} from '../src/game/rail/rail-network'
import {
    createRailCartSystem,
    nearestRailCartInteractionTarget,
} from '../src/game/rail/rail-cart-system'
import { spawnFallingStone } from '../src/game/moving-objects'

test('default rail is a raycastable non-physical special block', () => {
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.rail]?.name, 'rail')
    assert.equal(isRailBlock(DEFAULT_PALETTE, BLOCK.rail), true)
    assert.equal(railBlockIndex(DEFAULT_PALETTE), BLOCK.rail)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.rail), false)
    assert.equal(isRaycastTarget(DEFAULT_PALETTE, BLOCK.rail), true)
    assert.equal(isRenderableVoxel(DEFAULT_PALETTE, BLOCK.rail), false)
    assert.equal(voxelOpacity(DEFAULT_PALETTE, BLOCK.rail), 0)
})

test('rail graph derives straight, corner, t-junction, and cross variants from neighbors', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 1, 0, BLOCK.rail)

    assert.deepEqual(railVariantFromMask(railConnectionMask(chunks, 0, 1, 0)), {
        variant: 'isolated',
        rotation: 0,
    })

    chunks.setVoxel(1, 1, 0, BLOCK.rail)
    chunks.setVoxel(-1, 1, 0, BLOCK.rail)
    assert.deepEqual(railVariantFromMask(railConnectionMask(chunks, 0, 1, 0)), {
        variant: 'straight',
        rotation: 1,
    })

    chunks.setVoxel(-1, 1, 0, 0)
    chunks.setVoxel(0, 1, -1, BLOCK.rail)
    assert.deepEqual(railVariantFromMask(railConnectionMask(chunks, 0, 1, 0)), {
        variant: 'corner',
        rotation: 0,
    })

    chunks.setVoxel(-1, 1, 0, BLOCK.rail)
    assert.deepEqual(railVariantFromMask(railConnectionMask(chunks, 0, 1, 0)).variant, 't')

    chunks.setVoxel(0, 1, 1, BLOCK.rail)
    assert.deepEqual(railVariantFromMask(railConnectionMask(chunks, 0, 1, 0)), {
        variant: 'cross',
        rotation: 0,
    })
})

test('rail graph connects to adjacent rails one level above or below', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 1, 0, BLOCK.rail)
    chunks.setVoxel(1, 2, 0, BLOCK.rail)
    chunks.setVoxel(0, 0, 1, BLOCK.rail)

    const mask = railConnectionMask(chunks, 0, 1, 0)
    assert.equal((mask & (1 << RailDirection.East)) !== 0, true)
    assert.equal((mask & (1 << RailDirection.South)) !== 0, true)
    assert.deepEqual(railNeighborCell(chunks, { x: 0, y: 1, z: 0 }, RailDirection.East), {
        dir: RailDirection.East,
        cell: { x: 1, y: 2, z: 0 },
        dy: 1,
    })
    assert.deepEqual(railNeighborCell(chunks, { x: 0, y: 1, z: 0 }, RailDirection.South), {
        dir: RailDirection.South,
        cell: { x: 0, y: 0, z: 1 },
        dy: -1,
    })
})

test('rail routing continues straight through crosses and refuses ambiguous forks', () => {
    const cross = 0b1111
    assert.equal(chooseRailExit(cross, RailDirection.East), RailDirection.East)

    const northEastWest = (1 << RailDirection.North) | (1 << RailDirection.East) | (1 << RailDirection.West)
    assert.equal(chooseRailExit(northEastWest, RailDirection.South), null)
})

test('rail cart mounts through interaction and moves along rails with W/S actions', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 1, 0, BLOCK.rail)
    chunks.setVoxel(1, 1, 0, BLOCK.rail)
    chunks.setVoxel(2, 1, 0, BLOCK.rail)
    const world = createGameWorld()
    const actions = heldActions()
    const system = createRailCartSystem(chunks, [{
        id: 'cart-a',
        railCell: { x: 0, y: 1, z: 0 },
        front: 'east',
        speed: 4,
    }], { actions })
    system.init?.(world)

    const player = placePlayer(world, 0.5, 1, 0.5)
    const target = nearestRailCartInteractionTarget(world, { eid: player, x: 0.5, y: 1, z: 0.5 }, chunks)
    assert.ok(target)
    target.interact(world, { eid: player, x: 0.5, y: 1, z: 0.5 })
    assert.equal(hasComponent(world, player, RidingCart), true)

    actions.hold(GameAction.MoveForward)
    system.update?.(world, 0.25)
    assert.equal(world.railCarts[0]?.railCell.x, 1)
    assert.ok(Math.abs(Position.x[player] - 1.5) < 1e-5)

    actions.release(GameAction.MoveForward)
    const leave = nearestRailCartInteractionTarget(world, { eid: player, x: Position.x[player], y: Position.y[player], z: Position.z[player] }, chunks)
    assert.equal(leave?.prompt, 'Leave cart')
    leave?.interact(world, { eid: player, x: Position.x[player], y: Position.y[player], z: Position.z[player] })
    assert.equal(hasComponent(world, player, RidingCart), false)
})

test('rail cart follows uphill and downhill rail cells over terrain supports', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    chunks.setVoxel(1, 1, 0, BLOCK.stone)
    chunks.setVoxel(2, 0, 0, BLOCK.stone)
    chunks.setVoxel(0, 1, 0, BLOCK.rail)
    chunks.setVoxel(1, 2, 0, BLOCK.rail)
    chunks.setVoxel(2, 1, 0, BLOCK.rail)
    const world = createGameWorld()
    const actions = heldActions()
    const system = createRailCartSystem(chunks, [{
        id: 'cart-a',
        railCell: { x: 0, y: 1, z: 0 },
        front: 'east',
        speed: 4,
    }], { actions })
    system.init?.(world)

    const player = placePlayer(world, 0.5, 1, 0.5)
    nearestRailCartInteractionTarget(world, { eid: player, x: 0.5, y: 1, z: 0.5 }, chunks)
        ?.interact(world, { eid: player, x: 0.5, y: 1, z: 0.5 })

    actions.hold(GameAction.MoveForward)
    system.update?.(world, 0.125)
    assert.ok(Math.abs(Position.x[player] - 1.0) < 1e-5)
    assert.ok(Math.abs(Position.y[player] - 2.4) < 1e-5)

    system.update?.(world, 0.125)
    assert.deepEqual(world.railCarts[0]?.railCell, { x: 1, y: 2, z: 0 })
    assert.ok(Math.abs(Position.y[player] - 2.4) < 1e-5)

    system.update?.(world, 0.125)
    assert.ok(Math.abs(Position.x[player] - 2.0) < 1e-5)
    assert.ok(Math.abs(Position.y[player] - 2.4) < 1e-5)

    system.update?.(world, 0.125)
    assert.deepEqual(world.railCarts[0]?.railCell, { x: 2, y: 1, z: 0 })
    assert.ok(Math.abs(Position.y[player] - 1.4) < 1e-5)
})

test('rail cart stops before an active stone blocking the rail path', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 1, 0, BLOCK.rail)
    chunks.setVoxel(1, 1, 0, BLOCK.rail)
    chunks.setVoxel(2, 1, 0, BLOCK.rail)
    const world = createGameWorld()
    const actions = heldActions()
    const system = createRailCartSystem(chunks, [{
        id: 'cart-a',
        railCell: { x: 0, y: 1, z: 0 },
        front: 'east',
        speed: 4,
    }], { actions })
    system.init?.(world)

    const player = placePlayer(world, 0.5, 1, 0.5)
    nearestRailCartInteractionTarget(world, { eid: player, x: 0.5, y: 1, z: 0.5 }, chunks)
        ?.interact(world, { eid: player, x: 0.5, y: 1, z: 0.5 })
    spawnFallingStone(world, { x: 1.5, y: 1, z: 0.5 }, { x: 0, y: 0, z: 0 }, { radius: 0.42 })

    actions.hold(GameAction.MoveForward)
    system.update?.(world, 0.25)

    assert.equal(world.railCarts[0]?.railCell.x, 0)
    assert.ok(Math.abs(Position.x[player] - 0.5) < 1e-5)
})

function placePlayer(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, BoxCollider)
    Position.x[eid] = x
    Position.y[eid] = y
    Position.z[eid] = z
    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    return eid
}

function heldActions(): ActionMap & { hold(id: string): void; release(id: string): void } {
    const held = new Set<string>()
    return {
        hold(id: string) { held.add(id) },
        release(id: string) { held.delete(id) },
        isHeld(id: string) { return held.has(id) },
    } as ActionMap & { hold(id: string): void; release(id: string): void }
}

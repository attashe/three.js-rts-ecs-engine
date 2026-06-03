import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponents, addEntity, hasComponent } from 'bitecs'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import {
    BLOCK,
    DEFAULT_PALETTE,
    clonePalette,
    isCollidable,
    isLadderBlock,
    isRaycastTarget,
    isRenderableVoxel,
    ladderBlockIndex,
    voxelOpacity,
} from '../src/engine/voxel/palette'
import { BoxCollider, ClimbingLadder, PlayerControlled, Position, Velocity } from '../src/engine/ecs/components'
import { createPhysicsSystem } from '../src/engine/ecs/systems/physics-system'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import type { ActionMap } from '../src/engine/input/actions'
import { GameAction } from '../src/game/actions'
import { createLadderSystem, nearestLadderInteractionTarget } from '../src/game/ladder/ladder-system'

test('default ladder is a raycastable non-physical special block', () => {
    assert.equal(BLOCK.ladder, 47)
    assert.equal(DEFAULT_PALETTE.entries[BLOCK.ladder]?.name, 'ladder')
    assert.equal(isLadderBlock(DEFAULT_PALETTE, BLOCK.ladder), true)
    assert.equal(ladderBlockIndex(DEFAULT_PALETTE), BLOCK.ladder)
    assert.equal(isCollidable(DEFAULT_PALETTE, BLOCK.ladder), false)
    assert.equal(isRaycastTarget(DEFAULT_PALETTE, BLOCK.ladder), true)
    assert.equal(isRenderableVoxel(DEFAULT_PALETTE, BLOCK.ladder), false)
    assert.equal(voxelOpacity(DEFAULT_PALETTE, BLOCK.ladder), 0)
})

test('old palettes receive a missing ladder entry without overwriting custom tail entries', () => {
    const oldPalette = clonePalette(DEFAULT_PALETTE)
    oldPalette.entries.length = BLOCK.ladder
    oldPalette.entries.push({
        name: 'custom after stairs',
        color: [0.2, 0.1, 0.4],
        solid: true,
    })

    const chunks = new ChunkManager(oldPalette)

    assert.equal(chunks.palette.entries[BLOCK.ladder]?.name, 'custom after stairs')
    const ladderIndex = ladderBlockIndex(chunks.palette)
    assert.notEqual(ladderIndex, BLOCK.ladder)
    assert.equal(isLadderBlock(chunks.palette, ladderIndex), true)
})

test('old palettes append stairs before ladder to preserve stable default indices', () => {
    const oldPalette = clonePalette(DEFAULT_PALETTE)
    oldPalette.entries.length = BLOCK.stairs

    const chunks = new ChunkManager(oldPalette)

    assert.equal(chunks.palette.entries[BLOCK.stairs]?.name, 'stairs')
    assert.equal(chunks.palette.entries[BLOCK.ladder]?.name, 'ladder')
    assert.equal(ladderBlockIndex(chunks.palette), BLOCK.ladder)
})

test('ladder interaction attaches the player and physics skips gravity while climbing', () => {
    const chunks = ladderTestChunks()
    const world = createGameWorld()
    const player = placePlayer(world, 0.62, 1, 0.52)
    Velocity.y[player] = -6

    const target = nearestLadderInteractionTarget(world, playerInfo(player), chunks)
    assert.equal(target?.prompt, 'Climb ladder')
    target?.interact(world, playerInfo(player))

    assert.equal(hasComponent(world, player, ClimbingLadder), true)
    assertNear(Position.x[player], 0.5)
    assertNear(Position.z[player], 0.5)
    assert.equal(Velocity.y[player], 0)

    createPhysicsSystem(chunks).update(world, 0.25)
    assertNear(Position.y[player], 1)
})

test('pressing interaction while attached drops from the ladder and gravity resumes', () => {
    const chunks = ladderTestChunks()
    const world = createGameWorld()
    const player = placePlayer(world, 0.5, 2.2, 0.5)
    nearestLadderInteractionTarget(world, playerInfo(player), chunks)?.interact(world, playerInfo(player))

    const drop = nearestLadderInteractionTarget(world, playerInfo(player), chunks)
    assert.equal(drop?.prompt, 'Drop from ladder')
    drop?.interact(world, playerInfo(player))

    assert.equal(hasComponent(world, player, ClimbingLadder), false)
    createPhysicsSystem(chunks).update(world, 1 / 60)
    assert.ok(Position.y[player] < 2.2)
})

test('climber detaches if the ladder column is broken while attached', () => {
    const chunks = ladderTestChunks()
    const world = createGameWorld()
    const actions = heldActions()
    const system = createLadderSystem(chunks, { actions, climbSpeed: 2 })
    const player = placePlayer(world, 0.5, 2, 0.5)

    nearestLadderInteractionTarget(world, playerInfo(player), chunks)?.interact(world, playerInfo(player))
    assert.equal(hasComponent(world, player, ClimbingLadder), true)

    chunks.setVoxel(0, 2, 0, BLOCK.air)
    system.update(world, 1 / 60)

    assert.equal(hasComponent(world, player, ClimbingLadder), false)
})

test('W and S climb vertically and auto-detach at ladder endpoints', () => {
    const chunks = ladderTestChunks()
    chunks.setVoxel(1, 3, 0, BLOCK.stone)
    const world = createGameWorld()
    const actions = heldActions()
    const system = createLadderSystem(chunks, { actions, climbSpeed: 2 })
    const player = placePlayer(world, 0.5, 1, 0.5)

    nearestLadderInteractionTarget(world, playerInfo(player), chunks)?.interact(world, playerInfo(player))
    actions.hold(GameAction.MoveForward)
    system.update(world, 0.5)
    assert.equal(hasComponent(world, player, ClimbingLadder), true)
    assertNear(Position.y[player], 2)

    system.update(world, 2)
    assert.equal(hasComponent(world, player, ClimbingLadder), false)
    assertNear(Position.x[player], 1.5)
    assertNear(Position.y[player], 4)
    assertNear(Position.z[player], 0.5)

    Position.x[player] = 0.5
    Position.y[player] = 2
    Position.z[player] = 0.5
    nearestLadderInteractionTarget(world, playerInfo(player), chunks)?.interact(world, playerInfo(player))
    actions.release(GameAction.MoveForward)
    actions.hold(GameAction.MoveBackward)
    system.update(world, 1)

    assert.equal(hasComponent(world, player, ClimbingLadder), false)
    assertNear(Position.x[player], 0.5)
    assertNear(Position.y[player], 1)
    assertNear(Position.z[player], 0.5)
})

function ladderTestChunks(): ChunkManager {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    chunks.setVoxel(0, 1, 0, BLOCK.ladder)
    chunks.setVoxel(0, 2, 0, BLOCK.ladder)
    chunks.setVoxel(0, 3, 0, BLOCK.ladder)
    return chunks
}

function placePlayer(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponents(world, eid, [PlayerControlled, Position, Velocity, BoxCollider])
    Position.x[eid] = x
    Position.y[eid] = y
    Position.z[eid] = z
    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    return eid
}

function playerInfo(eid: number): { eid: number; x: number; y: number; z: number } {
    return { eid, x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
}

function heldActions(): ActionMap & { hold(id: string): void; release(id: string): void } {
    const held = new Set<string>()
    return {
        hold(id: string) { held.add(id) },
        release(id: string) { held.delete(id) },
        isHeld(id: string) { return held.has(id) },
    } as ActionMap & { hold(id: string): void; release(id: string): void }
}

function assertNear(actual: number, expected: number): void {
    assert.ok(Math.abs(actual - expected) < 1e-5, `expected ${expected}, got ${actual}`)
}

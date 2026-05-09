import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { ChunkManager } from '../src/client/engine/voxel/chunk-manager'
import { isGrounded, sweepAxis, type AABB, type ObstacleSource } from '../src/client/engine/voxel/voxel-collide'
import { ObstacleRegistry } from '../src/client/engine/ecs/obstacle-registry'
import { BLOCK, DEFAULT_PALETTE } from '../src/client/engine/voxel/palette'
import { createDynamicCollisionSystem } from '../src/client/engine/ecs/systems/dynamic-collision-system'
import { BoxCollider, PlayerControlled, Position, Velocity } from '../src/client/engine/ecs/components'
import { createGameWorld, type GameWorld } from '../src/client/engine/ecs/world'

function makeAABB(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
    return { minX, minY, minZ, maxX, maxY, maxZ }
}

function addMovableActor(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, PlayerControlled)
    Position.x[eid] = x
    Position.y[eid] = y
    Position.z[eid] = z
    BoxCollider.x[eid] = 0.34
    BoxCollider.y[eid] = 0.9
    BoxCollider.z[eid] = 0.34
    return eid
}

test('ObstacleRegistry: add then intersects matches the AABB', () => {
    const reg = new ObstacleRegistry()
    reg.add(42, makeAABB(2, 4, 5, 2.56, 4.56, 5.56))
    assert.equal(reg.size(), 1)
    assert.equal(reg.intersects(makeAABB(2.1, 4.1, 5.1, 2.4, 4.4, 5.4)), true)
    assert.equal(reg.intersects(makeAABB(3, 4, 5, 3.5, 4.5, 5.5)), false)
})

test('ObstacleRegistry: excludeEid skips self', () => {
    const reg = new ObstacleRegistry()
    reg.add(7, makeAABB(0, 0, 0, 1, 1, 1))
    assert.equal(reg.intersects(makeAABB(0.2, 0.2, 0.2, 0.8, 0.8, 0.8)), true)
    assert.equal(reg.intersects(makeAABB(0.2, 0.2, 0.2, 0.8, 0.8, 0.8), 7), false)
})

test('ObstacleRegistry: remove drops the entry without leaking buckets', () => {
    const reg = new ObstacleRegistry()
    reg.add(1, makeAABB(0, 0, 0, 1, 1, 1))
    reg.add(2, makeAABB(2, 0, 0, 3, 1, 1))
    reg.remove(1)
    assert.equal(reg.size(), 1)
    assert.equal(reg.intersects(makeAABB(0.1, 0.1, 0.1, 0.9, 0.9, 0.9)), false)
    assert.equal(reg.intersects(makeAABB(2.1, 0.1, 0.1, 2.9, 0.9, 0.9)), true)
})

test('ObstacleRegistry: AABB spanning multiple cells is found from any cell', () => {
    const reg = new ObstacleRegistry()
    // AABB straddles cells (2,4,5) and (3,4,5).
    reg.add(11, makeAABB(2.7, 4, 5.2, 3.3, 4.6, 5.6))
    assert.equal(reg.intersects(makeAABB(2.71, 4.1, 5.21, 2.95, 4.5, 5.5)), true)
    assert.equal(reg.intersects(makeAABB(3.05, 4.1, 5.21, 3.29, 4.5, 5.5)), true)
})

test('ObstacleRegistry: re-adding the same eid replaces (not duplicates) its AABB', () => {
    const reg = new ObstacleRegistry()
    reg.add(5, makeAABB(0, 0, 0, 1, 1, 1))
    reg.add(5, makeAABB(10, 0, 0, 11, 1, 1))
    assert.equal(reg.size(), 1)
    assert.equal(reg.intersects(makeAABB(0.2, 0.2, 0.2, 0.8, 0.8, 0.8)), false)
    assert.equal(reg.intersects(makeAABB(10.2, 0.2, 0.2, 10.8, 0.8, 0.8)), true)
})

test('sweepAxis: a registered obstacle blocks a sweep through empty voxels', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const reg = new ObstacleRegistry()
    // Stone-sized obstacle at (3, 4, 5) (foot-anchored AABB Y = [4, 4.56]).
    reg.add(99, makeAABB(2.72, 4, 4.72, 3.28, 4.56, 5.28))

    const pos = { x: 0, y: 4, z: 5 }
    const half = { x: 0.25, y: 0.5, z: 0.25 }

    const sweep = sweepAxis(chunks, pos, half, 'x', 5, reg)
    assert.equal(sweep.blocked, true)
    // Should clamp before the obstacle's minX (2.72) minus the body's half-width (0.25) = 2.47.
    assert.ok(pos.x < 2.48, `expected clamped x < 2.48, got ${pos.x}`)
    assert.ok(pos.x > 2.4, `expected clamped x > 2.4, got ${pos.x}`)
})

test('sweepAxis: excludeEid prevents collision against own registry entry', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const reg = new ObstacleRegistry()
    // Body's own settled AABB at (1, 0, 0).
    reg.add(50, makeAABB(1, 0, 0, 1.5, 1, 0.5))

    // Body stands clear of its registry entry and sweeps toward +x.
    const half = { x: 0.25, y: 0.5, z: 0.25 }

    const pos1 = { x: 0, y: 0, z: 0.25 }
    const blockedSweep = sweepAxis(chunks, pos1, half, 'x', 2, reg)
    assert.equal(blockedSweep.blocked, true)
    assert.ok(pos1.x < 0.76, `expected blocked before x=0.76, got ${pos1.x}`)

    const pos2 = { x: 0, y: 0, z: 0.25 }
    const freeSweep = sweepAxis(chunks, pos2, half, 'x', 2, reg, 50)
    assert.equal(freeSweep.blocked, false)
    // Substep accumulation introduces a tiny FP residual; assert near-equality.
    assert.ok(Math.abs(pos2.x - 2) < 1e-9, `expected pos.x ≈ 2, got ${pos2.x}`)
})

test('isGrounded: registered obstacle below the body counts as ground', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const reg = new ObstacleRegistry()
    reg.add(60, makeAABB(0, 3, 0, 1, 3.5, 1))

    const pos = { x: 0.5, y: 3.5, z: 0.5 }
    const half = { x: 0.25, y: 0.5, z: 0.25 }

    assert.equal(isGrounded(chunks, pos, half, 0.08), false, 'voxel grid is empty')
    assert.equal(isGrounded(chunks, pos, half, 0.08, reg), true, 'registry entry should ground us')
    assert.equal(isGrounded(chunks, pos, half, 0.08, reg, 60), false, 'self exclusion ignores own entry')
})

test('sweepAxis: obstacle on top of voxel does not double-count and still blocks Y-fall', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    const reg = new ObstacleRegistry()
    // Settled stone resting on the voxel at y=1.
    reg.add(70, makeAABB(0, 1, 0, 1, 1.56, 1))

    // Falling body at y = 3, size matches the stone, falling 4 units down.
    const pos = { x: 0.5, y: 3, z: 0.5 }
    const half = { x: 0.28, y: 0.28, z: 0.28 }

    const sweep = sweepAxis(chunks, pos, half, 'y', -4, reg)
    assert.equal(sweep.blocked, true)
    // Should land on top of the registered obstacle (top y = 1.56).
    assert.ok(pos.y >= 1.55 && pos.y <= 1.57, `expected y ≈ 1.56, got ${pos.y}`)
})

test('sweepAxis: body that starts inside a wall can escape if delta lands clear', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)
    // Body starts inside the voxel (overlap), trying to move out along -x.
    const pos = { x: 1.2, y: 0, z: 0.5 }
    const half = { x: 0.25, y: 0.5, z: 0.25 }

    const sweep = sweepAxis(chunks, pos, half, 'x', -1)
    // Destination at x=0.2 has body AABB [-0.05, 0.45] which is clear of the
    // voxel at cell x=1 ([1, 2]). The escape commits the full delta.
    assert.equal(sweep.blocked, false)
    assert.ok(Math.abs(pos.x - 0.2) < 1e-9, `expected pos.x ≈ 0.2, got ${pos.x}`)
})

test('sweepAxis: body inside a wall reports not-blocked when destination still overlaps', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)
    // Body starts overlapping the voxel and tries to move further into it.
    const pos = { x: 1.4, y: 0, z: 0.5 }
    const half = { x: 0.25, y: 0.5, z: 0.25 }

    const sweep = sweepAxis(chunks, pos, half, 'x', 0.3)
    // Both endpoints overlap, so no movement — but the sweep must NOT report
    // `blocked: true`, since that would make physics-system zero out the
    // body's velocity and trap it permanently.
    assert.equal(sweep.blocked, false)
    assert.equal(sweep.moved, 0)
    assert.equal(pos.x, 1.4)
})

test('sweepAxis: centre-anchored body lands with its centre half above the floor', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    // Stone-shaped centre-anchored body falling onto the voxel at (0, 0, 0)
    // (top face at y=1).
    const pos = { x: 0.5, y: 5, z: 0.5 }
    const half = { x: 0.28, y: 0.28, z: 0.28 }

    const sweep = sweepAxis(chunks, pos, half, 'y', -10, null, undefined, 'center')
    assert.equal(sweep.blocked, true)
    // Body centre should rest at floor + half.y (= 1 + 0.28 = 1.28). Allow a
    // small binary-search residual.
    assert.ok(pos.y >= 1.27 && pos.y <= 1.29, `expected y ≈ 1.28, got ${pos.y}`)
})

test('isGrounded: centre-anchored body probes below its bottom face', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(0, 0, 0, BLOCK.stone)
    const half = { x: 0.28, y: 0.28, z: 0.28 }

    // Body centre exactly at floor + half.y → resting on the voxel.
    const restingPos = { x: 0.5, y: 1.28, z: 0.5 }
    assert.equal(isGrounded(chunks, restingPos, half, 0.08, null, undefined, 'center'), true)

    // Body centre well above the voxel → airborne.
    const airbornePos = { x: 0.5, y: 3, z: 0.5 }
    assert.equal(isGrounded(chunks, airbornePos, half, 0.08, null, undefined, 'center'), false)
})

test('sweepAxis: actor pair-separation displacement is capped by voxel walls (regression)', () => {
    // Regression for: dynamic-collision-system used to write Position directly
    // when separating overlapping actor AABBs, which let one actor shove
    // another (or the player) through a wall and trap them inside the voxel.
    // The fix routes the shove through sweepAxis; this test pins that
    // invariant — even with a 0.5 m corrective push toward a wall, the actor
    // body cannot end up inside it.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)
    chunks.setVoxel(1, 1, 0, BLOCK.stone)

    // Foot-anchored actor (matches NPC + player BoxCollider shape) standing
    // just east of the wall (cell x=1, voxel span [1, 2]).
    const pos = { x: 2.4, y: 0, z: 0.5 }
    const half = { x: 0.34, y: 0.9, z: 0.34 }

    const result = sweepAxis(chunks, pos, half, 'x', -0.5)
    assert.equal(result.blocked, true)
    // Body's left edge should not cross the wall's east face at x=2: pos.x ≥ 2 + half.x.
    assert.ok(pos.x >= 2.34 - 1e-6, `expected pos.x >= 2.34, got ${pos.x}`)
})

test('DynamicCollisionSystem: corrective shoves do not double-apply sweep displacement', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    chunks.setVoxel(1, 0, 0, BLOCK.stone)
    chunks.setVoxel(1, 1, 0, BLOCK.stone)

    const world = createGameWorld()
    addMovableActor(world, 2.9, 0, 0.5)
    const wallSideActor = addMovableActor(world, 2.4, 0, 0.5)

    createDynamicCollisionSystem(chunks, { passes: 1, padding: 0.08 }).update(world, 1 / 60)

    assert.ok(
        Position.x[wallSideActor] >= 2.34 - 1e-6,
        `expected wall-side actor to stay outside the voxel wall, got x=${Position.x[wallSideActor]}`,
    )
})

test('ObstacleSource interface: any object satisfying it works with sweepAxis', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    let queried = 0
    const source: ObstacleSource = {
        intersects(aabb) {
            queried++
            // Pretend a wall exists at x>=2.
            return aabb.maxX > 2
        },
    }

    const pos = { x: 0, y: 0, z: 0 }
    const half = { x: 0.25, y: 0.5, z: 0.25 }
    const sweep = sweepAxis(chunks, pos, half, 'x', 5, source)
    assert.equal(sweep.blocked, true)
    assert.ok(queried > 0, 'sweepAxis should consult the obstacle source')
    assert.ok(pos.x < 1.76, `expected clamped x < 1.76, got ${pos.x}`)
})

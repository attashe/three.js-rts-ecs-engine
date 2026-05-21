import test from 'node:test'
import assert from 'node:assert/strict'
import { addComponent, addEntity } from 'bitecs'
import { ChunkManager } from '../src/engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../src/engine/voxel/palette'
import { BoxCollider, PlayerControlled, Position, Velocity } from '../src/engine/ecs/components'
import { createGameWorld, type GameWorld } from '../src/engine/ecs/world'
import { createPistonSystem } from '../src/engine/ecs/systems/piston-system'
import { registerPistonMechanism } from '../src/game/mechanisms'

function placePlayer(world: GameWorld, x: number, y: number, z: number): number {
    const eid = addEntity(world)
    addComponent(world, eid, Position)
    addComponent(world, eid, BoxCollider)
    addComponent(world, eid, Velocity)
    addComponent(world, eid, PlayerControlled)
    Position.x[eid] = x; Position.y[eid] = y; Position.z[eid] = z
    BoxCollider.x[eid] = 0.34; BoxCollider.y[eid] = 0.9; BoxCollider.z[eid] = 0.34
    return eid
}

test('PistonSystem: timer flips the block between from and to', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        initial: 'from',
    })
    // registerPistonMechanism seeds the initial cell.
    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.plank)

    const system = createPistonSystem(chunks)
    // Two half-second ticks to consume the delay.
    system.update(world, 0.5)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.air, 'still at from after 0.5 s')
    system.update(world, 0.5)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.plank, 'flipped to "to" once timer hits zero')
    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.air, 'source cell cleared')
})

test('PistonSystem: characterPolicy "block" refuses to flip when the player overlaps the target', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 1,
        characterPolicy: 'block',
    })

    // Player straddles the target cell.
    placePlayer(world, 6.5, 1, 0.5)

    createPistonSystem(chunks).update(world, 1)
    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.air, 'flip refused while player is in the way')
    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.brick, 'source cell still holds the block')
})

test('PistonSystem: characterPolicy "push" carries the player along the full flip delta', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        characterPolicy: 'push',
    })

    const player = placePlayer(world, 5.5, 3, 0.5)

    createPistonSystem(chunks).update(world, 1)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.plank, 'piston extended into the target cell')
    // Push uses the full delta vector (target - source = (0, +2, 0)) so the
    // player lands on top of the newly-placed block, not embedded in it.
    assert.ok(Math.abs(Position.y[player] - 5) < 1e-5, `expected player.y ≈ 5, got ${Position.y[player]}`)
})

test('PistonSystem: "push" carries a rider standing on top of the source block', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    // Travel 3 cells so the rider's AABB doesn't happen to overlap the
    // target cell — this case used to fall out of the target-occupant push
    // and leave the rider behind as the block teleported away.
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 4, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        characterPolicy: 'push',
    })

    // Player feet on top of the source block (block top face = y=2).
    const player = placePlayer(world, 5.5, 2, 0.5)

    createPistonSystem(chunks).update(world, 1)
    assert.equal(chunks.getVoxel(5, 4, 0), BLOCK.plank, 'piston extended to the target cell')
    // Rider should be carried up the full delta (+3), landing on top of
    // the new block at y=4 → feet at y=5.
    assert.ok(Math.abs(Position.y[player] - 5) < 1e-5, `expected player.y ≈ 5, got ${Position.y[player]}`)
})

test('PistonSystem: "push" refuses the flip if the displaced player would land in a wall', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    // Wall above the player's would-be landing spot.
    chunks.setVoxel(5, 5, 0, BLOCK.stone)
    chunks.setVoxel(5, 6, 0, BLOCK.stone)
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        characterPolicy: 'push',
    })

    const player = placePlayer(world, 5.5, 3, 0.5)
    const startY = Position.y[player]

    createPistonSystem(chunks).update(world, 1)
    assert.equal(chunks.getVoxel(5, 3, 0), BLOCK.air, 'flip refused — push would crush the player')
    assert.equal(Position.y[player], startY, 'player stays put when the flip is refused')
})

test('PistonSystem: blocked flip retries every tick instead of waiting a full delay', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 5,
        characterPolicy: 'block',
    })
    placePlayer(world, 6.5, 1, 0.5)

    const system = createPistonSystem(chunks)
    system.update(world, 5)
    // Refused — schedule sits in the past so the next tick re-attempts.
    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.air, 'first attempt blocked')
    assert.ok(piston.nextFlipAt <= 5 + 1e-6, `expected nextFlipAt in the past after a block, got ${piston.nextFlipAt}`)
})

test('PistonSystem: two pistons placed together stay in sync after one is blocked', () => {
    // Two horizontal pistons with the same delay. Player blocks A's
    // target for one tick, then steps away. B succeeds on schedule.
    // After A unblocks and flips, both pistons should be aligned to the
    // same grid tick (i.e. equal nextFlipAt).
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const a = registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.brick,
        delay: 2,
        characterPolicy: 'block',
    })
    const b = registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 10 },
        to: { x: 6, y: 1, z: 10 },
        block: BLOCK.brick,
        delay: 2,
        characterPolicy: 'block',
    })

    const player = placePlayer(world, 6.5, 1, 0.5)
    const system = createPistonSystem(chunks)

    // Tick to delay — A blocked, B flips. Schedules diverge for now.
    system.update(world, 2)
    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.air, 'A blocked')
    assert.equal(chunks.getVoxel(6, 1, 10), BLOCK.brick, 'B flipped')

    // Player steps away.
    Position.x[player] = 0

    // One small tick — A retries and succeeds. Both should now share the
    // same nextFlipAt because += delay snaps A back to the global grid.
    system.update(world, 0.016)
    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.brick, 'A flipped after retry')
    assert.equal(a.nextFlipAt, b.nextFlipAt,
        `pistons should resync, got a=${a.nextFlipAt} b=${b.nextFlipAt}`)
})

test('PistonSystem: rider on a 2-cell descending platform travels down with it (no false crush)', () => {
    // Two side-by-side pistons descending one cell each. Player straddles
    // both source cells. Without grouped source exclusion, the first
    // piston's wall check would see the second piston's still-solid
    // source block as a wall and falsely flag the player as crushed.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 3, z: 0 },
        to: { x: 5, y: 2, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        characterPolicy: 'push',
    })
    registerPistonMechanism(world, chunks, {
        from: { x: 6, y: 3, z: 0 },
        to: { x: 6, y: 2, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        characterPolicy: 'push',
    })
    // Feet on top face (y=4) of both source blocks; X centred between them.
    const player = placePlayer(world, 5.7, 4, 0.5)

    createPistonSystem(chunks).update(world, 1)
    assert.equal(world.deathSignal, null, 'no spurious death signal')
    assert.equal(chunks.getVoxel(5, 2, 0), BLOCK.plank, 'piston A descended')
    assert.equal(chunks.getVoxel(6, 2, 0), BLOCK.plank, 'piston B descended')
    assert.ok(Math.abs(Position.y[player] - 3) < 1e-5, `expected player.y ≈ 3, got ${Position.y[player]}`)
})

test('PistonSystem: downward piston that crushes a player signals death', () => {
    // Player stands on the floor; a piston descends onto their target cell
    // and tries to push them further down, but the floor is in the way.
    // The piston should flip anyway and set deathSignal = 'crushed-by-piston'.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    // Solid floor at y=0 so a downward push can't displace the player.
    chunks.setVoxel(5, 0, 0, BLOCK.stone)
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 3, z: 0 },
        to: { x: 5, y: 1, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        characterPolicy: 'push',
    })
    placePlayer(world, 5.5, 1, 0.5)

    createPistonSystem(chunks).update(world, 1)
    assert.equal(world.deathSignal, 'crushed-by-piston', 'death signalled')
    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.plank, 'piston flipped anyway')
})

test('PistonSystem: physical piston moves continuously between endpoints', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })

    assert.equal(chunks.getVoxel(5, 1, 0), BLOCK.air, 'physical block is not baked into chunks')
    assert.ok(piston.eid >= 0, 'physical piston owns an entity')

    const system = createPistonSystem(chunks)
    system.update(world, 0.5)
    assert.equal(Position.y[piston.eid], 1, 'waits until delay')
    system.update(world, 0.5)
    assert.ok(Math.abs(Position.y[piston.eid] - 2) < 1e-5, `expected halfway y≈2, got ${Position.y[piston.eid]}`)
    system.update(world, 0.5)
    assert.ok(Math.abs(Position.y[piston.eid] - 3) < 1e-5, `expected endpoint y≈3, got ${Position.y[piston.eid]}`)
    assert.equal(piston.occupied, 'to')
})

test('PistonSystem: physical piston carries a rider during travel', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 1,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })
    const player = placePlayer(world, 5.5, 2, 0.5)

    const system = createPistonSystem(chunks)
    system.update(world, 0.5)
    system.update(world, 0.5)
    assert.ok(Math.abs(Position.y[player] - 3) < 1e-5, `expected rider halfway y≈3, got ${Position.y[player]}`)
    system.update(world, 0.5)
    assert.ok(Math.abs(Position.y[player] - 4) < 1e-5, `expected rider endpoint y≈4, got ${Position.y[player]}`)
})

test('PistonSystem: physical vertical piston does not carry a player from tiny side contact', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 0,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })
    const player = placePlayer(world, 6.33, 1, 0.5)

    createPistonSystem(chunks).update(world, 0.25)

    assert.equal(world.deathSignal, null, 'side contact should not crush')
    assert.ok(Math.abs(Position.y[player] - 1) < 1e-5, `side contact should not ride upward, got y=${Position.y[player]}`)
    assert.ok(Position.x[player] >= 6.34 - 1e-5, `side contact should separate sideways, got x=${Position.x[player]}`)
})

test('PistonSystem: descending physical piston side contact does not crush', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 3, z: 0 },
        to: { x: 5, y: 1, z: 0 },
        block: BLOCK.plank,
        delay: 0,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })
    const player = placePlayer(world, 6.33, 1, 0.5)

    createPistonSystem(chunks).update(world, 0.25)

    assert.equal(world.deathSignal, null, 'side graze from descending block should not crush')
    assert.ok(Math.abs(Position.y[player] - 1) < 1e-5, `side contact should not ride downward, got y=${Position.y[player]}`)
    assert.ok(Position.x[player] >= 6.34 - 1e-5, `side contact should separate sideways, got x=${Position.x[player]}`)
})

test('PistonSystem: zero-delay physical piston does not side-stick after repeated reversals', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 0,
        travelTime: 0.25,
        motion: 'physical',
        characterPolicy: 'push',
    })
    const player = placePlayer(world, 6.2, 1, 0.5)
    const system = createPistonSystem(chunks)

    for (let i = 0; i < 12; i++) system.update(world, 0.05)

    assert.equal(world.deathSignal, null, 'repeated zero-delay side contact should not crush')
    assert.ok(Math.abs(Position.y[player] - 1) < 1e-5, `side contact should not become vertical carry, got y=${Position.y[player]}`)
    assert.ok(Position.x[player] >= 6.34 - 1e-5, `player should stay separated from piston side, got x=${Position.x[player]}`)
})

test('PistonSystem: side-graze of a physical vertical piston preserves player velocity', () => {
    // Regression: the old apply loop zeroed X/Z velocity and clamped Y at
    // Math.max(0, vy) for *every* push contact — including side-grazes.
    // That made a falling player hang in midair next to a vertical piston
    // because gravity-applied vy kept getting clamped to 0 on the next
    // piston tick, and any walking velocity got nuked too. Only riders /
    // vertical-approach contacts should zero velocity; side-grazes must
    // leave the player's own physics state untouched.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 0,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })
    const player = placePlayer(world, 6.33, 1, 0.5)
    // Player is mid-fall + walking away from the piston.
    const expectedVx = -2.5
    const expectedVy = -3.0
    const expectedVz = 1.1
    Velocity.x[player] = expectedVx
    Velocity.y[player] = expectedVy
    Velocity.z[player] = expectedVz
    // Snapshot what bitecs' Float32 component actually stored — comparing
    // against the literal would fail on `1.1` because it doesn't round-trip
    // through Float32Array. The point of the test is that the system
    // doesn't *mutate* the value, not that it preserves bit-exact decimals.
    const storedVx = Velocity.x[player]
    const storedVy = Velocity.y[player]
    const storedVz = Velocity.z[player]

    createPistonSystem(chunks).update(world, 0.1)

    assert.equal(world.deathSignal, null, 'side graze must not crush')
    assert.equal(Velocity.x[player], storedVx, 'walking velocity preserved through a side graze')
    assert.equal(Velocity.y[player], storedVy, 'falling velocity preserved through a side graze')
    assert.equal(Velocity.z[player], storedVz, 'z velocity preserved through a side graze')
})

test('PistonSystem: physical cloud piston gets an alpha-blended material (not alphaHash)', () => {
    // Regression: `alphaHash` isn't implemented in three.js's WebGPU
    // renderer, so the previous shared-material config silently produced
    // fully-opaque cloud blocks. The correct path is classic alpha
    // blending — `transparent: true` + the palette's opacity — matching
    // the chunk renderer's behaviour for cloud voxels.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.cloud,
        delay: 0,
        travelTime: 1,
        motion: 'physical',
    })
    const visual = world.object3DByEid.get(piston.eid)
    assert.ok(visual, 'physical piston spawns a renderable')
    const mesh = (visual!.children[0] as { material?: { transparent?: boolean; opacity?: number; alphaHash?: boolean } })
    assert.equal(mesh.material?.transparent, true, 'cloud piston uses alpha blending')
    assert.ok((mesh.material?.opacity ?? 1) < 1, `cloud piston is translucent, got opacity=${mesh.material?.opacity}`)
    assert.notEqual(mesh.material?.alphaHash, true, 'alphaHash should not be enabled — unsupported in three.js WebGPU')
})

test('PistonSystem: physical cloud piston does not register an obstacle or push the player', () => {
    // A cloud-block physical piston should render and move but stay
    // non-collidable — the player walks through it just like through the
    // matching voxel cells. Regression for the bug where physical
    // pistons unconditionally added their AABB to `world.obstacles` and
    // ran the player-push step regardless of palette `collidable`.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.cloud,
        delay: 0,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })
    // Player straddling the piston's column at y=1.5 — directly inside
    // the cloud block's path. A collidable block would block / push them.
    const player = placePlayer(world, 5.5, 1.5, 0.5)
    const startX = Position.x[player]
    const startY = Position.y[player]
    const startZ = Position.z[player]
    const startVx = Velocity.x[player]
    const startVy = Velocity.y[player]
    const startVz = Velocity.z[player]

    createPistonSystem(chunks).update(world, 0.25)

    // The cloud block must NOT be registered as an obstacle.
    assert.equal(world.obstacles.intersects({
        minX: startX - 0.34,
        minY: startY,
        minZ: startZ - 0.34,
        maxX: startX + 0.34,
        maxY: startY + 1.8,
        maxZ: startZ + 0.34,
    }), false, 'cloud piston AABB should not enter obstacle registry')

    // The player's position + velocity must be untouched — no carry, no push.
    assert.equal(Position.x[player], startX, 'cloud piston should not push player x')
    assert.equal(Position.y[player], startY, 'cloud piston should not push player y')
    assert.equal(Position.z[player], startZ, 'cloud piston should not push player z')
    assert.equal(Velocity.x[player], startVx)
    assert.equal(Velocity.y[player], startVy)
    assert.equal(Velocity.z[player], startVz)
    assert.equal(world.deathSignal, null, 'cloud piston cannot crush')
})

test('PistonSystem: teleport cloud piston flips even when the player stands in the target cell', () => {
    // Symmetric regression: `block` characterPolicy refused to flip when
    // a player overlapped the target cell. For non-collidable blocks the
    // player can share the cell, so the flip must go ahead.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 6, y: 1, z: 0 },
        block: BLOCK.cloud,
        delay: 1,
        characterPolicy: 'block',
    })
    placePlayer(world, 6.5, 1, 0.5)

    createPistonSystem(chunks).update(world, 1)

    assert.equal(chunks.getVoxel(6, 1, 0), BLOCK.cloud, 'cloud flip happens through the player')
    assert.equal(chunks.getVoxel(5, 1, 0), 0, 'source cell cleared')
})

test('PistonSystem: physical piston with zero delay reverses continuously', () => {
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const world = createGameWorld()
    const piston = registerPistonMechanism(world, chunks, {
        from: { x: 5, y: 1, z: 0 },
        to: { x: 5, y: 3, z: 0 },
        block: BLOCK.plank,
        delay: 0,
        travelTime: 1,
        motion: 'physical',
        characterPolicy: 'push',
    })

    const system = createPistonSystem(chunks)
    system.update(world, 0.25)
    assert.ok(Math.abs(Position.y[piston.eid] - 1.5) < 1e-5, `expected outbound y≈1.5, got ${Position.y[piston.eid]}`)
    system.update(world, 0.75)
    assert.ok(Math.abs(Position.y[piston.eid] - 3) < 1e-5, `expected endpoint y≈3, got ${Position.y[piston.eid]}`)
    system.update(world, 0.25)
    assert.ok(Math.abs(Position.y[piston.eid] - 2.5) < 1e-5, `expected immediate return y≈2.5, got ${Position.y[piston.eid]}`)
})

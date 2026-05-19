import { BLOCK, type ChunkManager } from '../engine/voxel'
import type { Zone } from '../engine/ecs/zones'
import type { PistonMechanismConfig } from './mechanisms'
import { STONE_TIER, type StoneFallSpawnerConfig } from './moving-objects'

export interface CoinPileSpawn {
    position: { x: number; y: number; z: number }
    amount?: number
}

export interface LevelMeta {
    /** World-space spawn position (X, Y, Z). Y is standing height (one above topmost solid). */
    spawn: { x: number; y: number; z: number }
    /** Falling-stone emitter configs. */
    stoneSpawners: StoneFallSpawnerConfig[]
    /** Coin pile placements — pickup-system grants gold on contact. */
    coinPiles: CoinPileSpawn[]
    /** Piston / moving-platform configs registered by client.ts. */
    pistons: PistonMechanismConfig[]
    /** Named AABB regions — registered into `world.zones` by client.ts. */
    zones: Zone[]
    /** XZ extent of the generated level, used by the demo to centre the camera. */
    size: number
}

/**
 * Compact platformer demo level. Three pieces:
 *
 *  - A 24×24 grass plaza for movement testing.
 *  - A two-step staircase + raised platform for jump testing (needs to clear
 *    a 1-block step at minimum).
 *  - A short cliff with two stone spawners that drop pebbles and cobbles into
 *    the plaza so the physics is observable.
 *
 * No mechanisms, no NPCs, no doors — pure terrain.
 */
export function generatePlatformerLevel(chunks: ChunkManager): LevelMeta {
    const size = 24
    const groundY = 4

    // Grass plaza floor — one block thick, dirt under it for visual fringe at
    // the cliff cut.
    for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < groundY; y++) {
                chunks.setVoxel(x, y, z, y === groundY - 1 ? BLOCK.dirt : BLOCK.stone)
            }
            chunks.setVoxel(x, groundY, z, BLOCK.grass)
        }
    }

    // Three-step staircase climbing south to north along x=18.
    for (let step = 0; step < 3; step++) {
        const stepY = groundY + 1 + step
        const stepZ = 8 + step * 2
        for (let x = 16; x <= 20; x++) {
            for (let z = stepZ; z < stepZ + 2; z++) {
                chunks.setVoxel(x, stepY, z, BLOCK.plank)
                // Fill underneath so the steps are solid all the way down.
                for (let y = groundY + 1; y < stepY; y++) {
                    chunks.setVoxel(x, y, z, BLOCK.stone)
                }
            }
        }
    }

    // Raised platform north of the staircase — a 5×5 grass island at y=8.
    const platformTop = groundY + 4
    for (let x = 14; x <= 22; x++) {
        for (let z = 16; z <= 20; z++) {
            for (let y = groundY + 1; y < platformTop; y++) {
                chunks.setVoxel(x, y, z, BLOCK.stone)
            }
            chunks.setVoxel(x, platformTop, z, BLOCK.grass)
        }
    }

    // A short wall on the west edge to give arrows somewhere to stick.
    for (let z = 2; z <= 8; z++) {
        for (let y = groundY + 1; y <= groundY + 3; y++) {
            chunks.setVoxel(2, y, z, BLOCK.brick)
        }
    }

    // Cliff with two stone spawners on the east side of the plaza.
    const cliffTop = groundY + 4
    for (let x = 22; x < size; x++) {
        for (let z = 2; z <= 6; z++) {
            for (let y = groundY + 1; y <= cliffTop; y++) {
                chunks.setVoxel(x, y, z, y === cliffTop ? BLOCK.stone : BLOCK.dirt)
            }
        }
    }

    const stoneSpawners: StoneFallSpawnerConfig[] = [
        {
            position: { x: 22.4, y: cliffTop + 0.6, z: 3.5 },
            velocity: { x: -2.6, y: 0.2, z: 0.3 },
            interval: 1.6,
            jitter: 0.3,
            options: STONE_TIER.pebble,
        },
        {
            position: { x: 22.4, y: cliffTop + 0.6, z: 5.5 },
            velocity: { x: -2.4, y: 0.1, z: -0.2 },
            interval: 2.4,
            jitter: 0.25,
            options: STONE_TIER.cobble,
        },
    ]

    // A handful of coin piles to give the player a reason to traverse the
    // demo: one on the raised platform (needs the staircase OR a high-jump),
    // one near the cliff base (in the path of falling stones), one tucked
    // behind the wall, one isolated on a small island reachable only by the
    // vertical elevator piston below.
    const coinPiles = [
        { position: { x: 18, y: platformTop + 1, z: 18 }, amount: 20 },
        { position: { x: 20, y: groundY + 1, z: 4 }, amount: 12 },
        { position: { x: 4, y: groundY + 1, z: 5 }, amount: 8 },
        { position: { x: 8, y: groundY + 4, z: 21 }, amount: 25 },
    ]

    // Carve a small floating island to host the elevator-target coin pile.
    // The island has no stairs, so the player must ride the vertical piston
    // up to it (or use high-jump if they can clear ~3 m).
    //
    // Leave a hole at the piston target cell (8, groundY+3, 21) — that's
    // where the elevator block extends to, and if we paved over it the
    // piston could never flip (target permanently solid).
    for (let x = 7; x <= 9; x++) {
        for (let z = 20; z <= 22; z++) {
            if (x === 8 && z === 21) continue
            chunks.setVoxel(x, groundY + 3, z, BLOCK.stone)
        }
    }

    // Pistons:
    //  - Vertical elevator at (8, groundY+1..groundY+3, 21): a plank block
    //    that swaps between the ground-floor cell and the floating-island
    //    cell. characterPolicy 'push' so a player standing on it gets
    //    carried up. delay 3s gives the player time to step on and ride.
    //  - Horizontal piston near the centre: a brick block that alternates
    //    between two adjacent cells. characterPolicy 'push' so the block
    //    shoves the player aside when they're standing in the target spot —
    //    matching the parent engine's trap-piston feel and demoing the
    //    push behaviour on the horizontal axis.
    const pistons: PistonMechanismConfig[] = [
        {
            from: { x: 8, y: groundY + 1, z: 21 },
            to: { x: 8, y: groundY + 3, z: 21 },
            block: BLOCK.plank,
            delay: 3,
            characterPolicy: 'push',
        },
        {
            from: { x: 12, y: groundY + 1, z: 12 },
            to: { x: 13, y: groundY + 1, z: 12 },
            block: BLOCK.brick,
            delay: 1.4,
            characterPolicy: 'push',
        },
    ]

    return {
        spawn: { x: size / 2, y: groundY + 1, z: size / 2 },
        stoneSpawners,
        coinPiles,
        pistons,
        zones: [],
        size,
    }
}

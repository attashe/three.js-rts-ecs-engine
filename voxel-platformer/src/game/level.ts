import { BLOCK, type ChunkManager } from '../engine/voxel'
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
    // behind the wall.
    const coinPiles = [
        { position: { x: 18, y: platformTop + 1, z: 18 }, amount: 20 },
        { position: { x: 20, y: groundY + 1, z: 4 }, amount: 12 },
        { position: { x: 4, y: groundY + 1, z: 5 }, amount: 8 },
    ]

    return {
        spawn: { x: size / 2, y: groundY + 1, z: size / 2 },
        stoneSpawners,
        coinPiles,
        size,
    }
}

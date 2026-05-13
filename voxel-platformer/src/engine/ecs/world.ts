import { createWorld, type World } from 'bitecs'
import type { Object3D } from 'three'
import { ObstacleRegistry } from './obstacle-registry'
import { EngineMetrics } from '../metrics'

export interface VoxelCoord {
    x: number
    y: number
    z: number
}

/** Aggregated counts of collected pickups. Pickup-system increments these;
 *  consumers (debug overlay, eventual HUD) read them. */
export interface PickupInventory {
    gold: number
    arrows: number
}

/**
 * A voxel-shaped block that teleports between two cells on a fixed timer.
 * Used for moving platforms / stepping stones. Driven by piston-system.
 */
export interface PistonMechanism {
    from: VoxelCoord
    to: VoxelCoord
    /** Palette index placed at the currently-occupied cell. */
    block: number
    /** Which side currently holds the block. */
    occupied: 'from' | 'to'
    /** Seconds between flip attempts. */
    interval: number
    /** Countdown to next flip attempt. */
    timer: number
    /**
     * What to do when a character is standing in the target cell at flip time.
     * - `block`: don't flip until the cell is clear (hazard / locked door
     *   style).
     * - `push`: nudge the character one cell in the flip direction so the
     *   block can take its spot. Good for elevator-style platforms that
     *   should carry the player.
     */
    characterPolicy: 'block' | 'push'
}

const MAX_LOG_ENTRIES = 12

// Side-tables. bitecs components hold only numeric data; anything that's a
// reference type (Object3D, registry side tables) lives here keyed by entity id.
export interface GameContext {
    metrics: EngineMetrics
    object3DByEid: Map<number, Object3D>
    /** AABBs of settled rigid bodies the voxel-sweep treats as solid. */
    obstacles: ObstacleRegistry
    inventory: PickupInventory
    /** Active piston mechanisms — voxel-toggling moving platforms. */
    pistons: PistonMechanism[]
    /** Capped ring of recent gameplay messages — pickup notifications, spell
     *  casts, etc. Rendered by debug-overlay-system. */
    log: string[]
}

export type GameWorld = World<GameContext>

export function createGameWorld(): GameWorld {
    return createWorld<GameContext>({
        metrics: new EngineMetrics(),
        object3DByEid: new Map<number, Object3D>(),
        obstacles: new ObstacleRegistry(),
        inventory: { gold: 0, arrows: 0 },
        pistons: [],
        log: [],
    })
}

/** Append a one-line debug/log message, evicting oldest entries past the cap. */
export function pushLog(world: GameWorld, message: string): void {
    world.log.push(message)
    if (world.log.length > MAX_LOG_ENTRIES) {
        world.log.splice(0, world.log.length - MAX_LOG_ENTRIES)
    }
}

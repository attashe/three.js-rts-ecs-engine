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
 *
 * Scheduling is absolute — `nextFlipAt` is a simulation-time stamp, not a
 * countdown. After a successful flip the system does
 * `nextFlipAt += delay` (monotonic), which keeps every piston created in
 * the same tick locked to the same global delay grid even when some
 * individual flips run a tick or two late because they were blocked.
 */
export interface PistonMechanism {
    from: VoxelCoord
    to: VoxelCoord
    /** Palette index placed at the currently-occupied cell. */
    block: number
    /** Teleport pistons rewrite voxels at endpoints; physical pistons are
     *  renderable/collidable block entities that move continuously between
     *  endpoints. Missing field defaults to `'teleport'` for old saves. */
    motion: 'teleport' | 'physical'
    /** Which side currently holds the block. */
    occupied: 'from' | 'to'
    /** Seconds spent waiting at each endpoint before moving/flipping.
     *  0 means start the next move as soon as the previous one finishes. */
    delay: number
    /** Seconds spent travelling between endpoints for physical pistons. */
    travelTime: number
    /** Absolute sim-time of the next flip attempt. */
    nextFlipAt: number
    /** Physical-piston entity id. `-1` for teleport pistons. */
    eid: number
    /** Physical-piston movement state. */
    moving: 0 | 1
    /** Normalized [0, 1] travel progress for the active physical move. */
    moveT: number
    /** Endpoint occupied before the active physical move started. */
    moveFrom: 'from' | 'to'
    /**
     * What to do when a character is standing in the target cell at flip time.
     * - `block`: don't flip until the cell is clear (hazard / locked door
     *   style).
     * - `push`: nudge the character along the flip direction so the block
     *   can take its spot. Good for elevator-style platforms that should
     *   carry the player. For *downward* pistons, a failed push (player
     *   crushed against a floor) signals death instead of refusing the
     *   flip — see `player-death-system`.
     */
    characterPolicy: 'block' | 'push'
}

/** Why the level should restart. Set by gameplay systems; consumed by
 *  `restart-system` which calls `location.reload()`. */
export type DeathReason = 'fell-into-void' | 'crushed-by-piston' | 'manual-restart'

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
    /** When non-null, the level should restart. `restart-system` reads
     *  this each render frame and triggers a page reload. */
    deathSignal: DeathReason | null
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
        deathSignal: null,
    })
}

/** Append a one-line debug/log message, evicting oldest entries past the cap. */
export function pushLog(world: GameWorld, message: string): void {
    world.log.push(message)
    if (world.log.length > MAX_LOG_ENTRIES) {
        world.log.splice(0, world.log.length - MAX_LOG_ENTRIES)
    }
}

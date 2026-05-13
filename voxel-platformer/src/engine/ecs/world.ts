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

const MAX_LOG_ENTRIES = 12

// Side-tables. bitecs components hold only numeric data; anything that's a
// reference type (Object3D, registry side tables) lives here keyed by entity id.
export interface GameContext {
    metrics: EngineMetrics
    object3DByEid: Map<number, Object3D>
    /** AABBs of settled rigid bodies the voxel-sweep treats as solid. */
    obstacles: ObstacleRegistry
    inventory: PickupInventory
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

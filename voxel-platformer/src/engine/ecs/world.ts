import { createWorld, type World } from 'bitecs'
import type { Object3D } from 'three'
import { ObstacleRegistry } from './obstacle-registry'
import { EngineMetrics } from '../metrics'

export interface VoxelCoord {
    x: number
    y: number
    z: number
}

// Side-tables. bitecs components hold only numeric data; anything that's a
// reference type (Object3D, registry side tables) lives here keyed by entity id.
export interface GameContext {
    metrics: EngineMetrics
    object3DByEid: Map<number, Object3D>
    /** AABBs of settled rigid bodies the voxel-sweep treats as solid. */
    obstacles: ObstacleRegistry
}

export type GameWorld = World<GameContext>

export function createGameWorld(): GameWorld {
    return createWorld<GameContext>({
        metrics: new EngineMetrics(),
        object3DByEid: new Map<number, Object3D>(),
        obstacles: new ObstacleRegistry(),
    })
}

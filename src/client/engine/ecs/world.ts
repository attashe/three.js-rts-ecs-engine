import { createWorld, type World } from 'bitecs'
import type { Object3D, Vector3 } from 'three'
import { ObstacleRegistry } from './obstacle-registry'

export interface VoxelCoord {
    x: number
    y: number
    z: number
}

export interface PathState {
    /** World-space waypoints, including the start (index 0). */
    points: Vector3[]
    /** Index of the next waypoint to walk toward. */
    index: number
    /** World-units per second. */
    speed: number
    /** Seconds spent blocked while trying to follow this path. */
    blockedTime?: number
    /** Number of local waypoint skips already tried for the current path. */
    blockedSkips?: number
}

export interface InteractionState {
    label: string
    message: string
}

export interface PickupState {
    label: string
    message: string
}

export interface DoorBlock {
    pos: VoxelCoord
    block: number
}

export interface DoorMechanism {
    kind: 'door'
    blocks: DoorBlock[]
    open: boolean
}

export interface PistonMechanism {
    kind: 'piston'
    from: VoxelCoord
    to: VoxelCoord
    block: number
    occupied: 'from' | 'to'
    interval: number
    timer: number
    characterPolicy: 'block' | 'push'
}

export type VoxelMechanism = DoorMechanism | PistonMechanism

export interface GameLogEntry {
    time: number
    type: 'interaction' | 'pickup' | 'combat' | 'path'
    message: string
    eid?: number
}

/** Emitted by physics-system when a body's downward sweep was hard-blocked.
 *  Drained each fixed step by impact-system. */
export interface ImpactEvent {
    eid: number
    /** Inbound speed along the ground normal (m/s, always positive). */
    speed: number
    /** Body mass at the moment of impact. */
    mass: number
    /** Body position (foot-anchored) at the moment of impact. */
    x: number
    y: number
    z: number
}

// Side-tables. bitecs components hold only numeric data; anything that's a
// reference type (Object3D, path arrays, palette indices for level metadata)
// lives here keyed by entity id.
export interface GameContext {
    object3DByEid: Map<number, Object3D>
    pathByEid: Map<number, PathState>
    interactionByEid: Map<number, InteractionState>
    pickupByEid: Map<number, PickupState>
    mechanismByEid: Map<number, VoxelMechanism>
    voxelMechanisms: VoxelMechanism[]
    log: GameLogEntry[]
    /** Per-frame queue of high-energy impacts produced by physics-system. */
    impactEvents: ImpactEvent[]
    /** AABBs of settled rigid bodies the voxel-sweep treats as solid. */
    obstacles: ObstacleRegistry
}

export type GameWorld = World<GameContext>

export function createGameWorld(): GameWorld {
    return createWorld<GameContext>({
        object3DByEid: new Map<number, Object3D>(),
        pathByEid: new Map<number, PathState>(),
        interactionByEid: new Map<number, InteractionState>(),
        pickupByEid: new Map<number, PickupState>(),
        mechanismByEid: new Map<number, VoxelMechanism>(),
        voxelMechanisms: [],
        log: [],
        impactEvents: [],
        obstacles: new ObstacleRegistry(),
    })
}

export function pushGameLog(world: GameWorld, entry: Omit<GameLogEntry, 'time'>): void {
    world.log.push({ ...entry, time: performance.now() })
    if (world.log.length > 64) world.log.splice(0, world.log.length - 64)
}

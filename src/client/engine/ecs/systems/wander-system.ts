import { Vector3 } from 'three'
import { addComponent, hasComponent, query } from 'bitecs'
import { findPath, type ChunkManager } from '../../voxel'
import {
    BoxCollider,
    Interactable,
    MoveAlongPath,
    PlayerControlled,
    Position,
    Sleeping,
    Wanderer,
    WanderHome,
    WanderRadius,
    WanderTimer,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import type { GameWorld } from '../world'

export interface WanderSystemOptions {
    speed?: number
    repathDelay?: number
}

export function createWanderSystem(chunks: ChunkManager, opts: WanderSystemOptions = {}): System {
    const speed = opts.speed ?? 2.2
    const repathDelay = opts.repathDelay ?? 1.25

    return {
        fixed: true,
        order: FixedOrder.ai,
        update(world, dt) {
            const eids = query(world, [Wanderer, Position, WanderHome, WanderRadius, WanderTimer])
            const dynamicBlockers = collectDynamicBlockers(world)
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                if (hasComponent(world, eid, MoveAlongPath)) continue

                WanderTimer.value[eid] -= dt
                if (WanderTimer.value[eid] > 0) continue

                const start = {
                    x: Math.floor(Position.x[eid]),
                    y: Math.floor(Position.y[eid]),
                    z: Math.floor(Position.z[eid]),
                }
                const goal = chooseGoal(eid)
                const path = findPath(chunks, start, goal, {
                    maxNodes: 2048,
                    maxStepUp: 1,
                    maxDrop: 2,
                    surfaceSearchRange: 8,
                    isBlocked: (x, y, z) => isDynamicallyBlocked(dynamicBlockers, eid, x, y, z),
                })

                if (path && path.length > 1) {
                    world.pathByEid.set(eid, {
                        points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
                        index: 0,
                        speed,
                    })
                    addComponent(world, eid, MoveAlongPath)
                    WanderTimer.value[eid] = repathDelay
                } else {
                    WanderTimer.value[eid] = repathDelay * 0.5
                }
            }
        },
    }
}

interface DynamicBlocker {
    eid: number
    x: number
    y: number
    z: number
    radius: number
}

function collectDynamicBlockers(world: GameWorld): DynamicBlocker[] {
    const eids = query(world, [Position, BoxCollider])
    const blockers: DynamicBlocker[] = []
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        if (
            !hasComponent(world, eid, PlayerControlled) &&
            !hasComponent(world, eid, Wanderer) &&
            !hasComponent(world, eid, Interactable) &&
            !hasComponent(world, eid, Sleeping)
        ) {
            continue
        }
        blockers.push({
            eid,
            x: Position.x[eid],
            y: Position.y[eid],
            z: Position.z[eid],
            radius: Math.max(BoxCollider.x[eid], BoxCollider.z[eid]),
        })
    }
    return blockers
}

function isDynamicallyBlocked(
    blockers: DynamicBlocker[],
    self: number,
    x: number,
    y: number,
    z: number,
): boolean {
    const cx = x + 0.5
    const cz = z + 0.5
    for (const blocker of blockers) {
        if (blocker.eid === self) continue
        if (Math.abs(blocker.y - y) > 1.2) continue
        const clearance = blocker.radius + 0.24
        const dx = blocker.x - cx
        const dz = blocker.z - cz
        if (dx * dx + dz * dz < clearance * clearance) return true
    }
    return false
}

function chooseGoal(eid: number): { x: number; y: number; z: number } {
    const radius = Math.max(1, Math.floor(WanderRadius.value[eid]))
    const seed = nextSeed(eid)
    const dx = (seed % (radius * 2 + 1)) - radius
    const dz = (Math.floor(seed / 17) % (radius * 2 + 1)) - radius
    return {
        x: Math.floor(WanderHome.x[eid] + dx),
        y: Math.floor(WanderHome.y[eid]),
        z: Math.floor(WanderHome.z[eid] + dz),
    }
}

function nextSeed(eid: number): number {
    const n = Math.imul((performance.now() | 0) ^ (eid * 1103515245), 1664525) + 1013904223
    return Math.abs(n | 0)
}

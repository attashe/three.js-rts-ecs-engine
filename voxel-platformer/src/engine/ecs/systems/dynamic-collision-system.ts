import { hasComponent, query } from 'bitecs'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { sweepAxis } from '../../voxel/voxel-collide'
import {
    BoxCollider,
    ClimbingLadder,
    MovementState,
    PlayerControlled,
    Position,
    Velocity,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { MovementStateId } from '../movement-state'
import type { GameWorld } from '../world'

export interface DynamicCollisionOptions {
    /** Extra horizontal gap between solid character bodies. Default 0.08. */
    padding?: number
    passes?: number
}

export function createDynamicCollisionSystem(chunks: ChunkManager, opts: DynamicCollisionOptions = {}): System {
    const padding = opts.padding ?? 0.08
    const passes = opts.passes ?? 3

    return {
        fixed: true,
        order: FixedOrder.dynamicCollision,
        update(world) {
            const eids = collectSolidCharacters(world)
            const cellSize = collisionCellSize(eids, padding)
            let pairCount = 0
            for (let pass = 0; pass < passes; pass++) {
                const pairs = collectCandidatePairs(eids, cellSize)
                pairCount += pairs.length
                for (let i = 0; i < pairs.length; i++) {
                    const pair = pairs[i]!
                    separatePair(world, chunks, pair.a, pair.b, padding)
                }
            }
            world.metrics.setGauge('dynamicCollision.actors', eids.length)
            world.metrics.setGauge('dynamicCollision.pairs', pairCount)
        },
    }
}

interface CandidatePair {
    a: number
    b: number
}

function collectSolidCharacters(world: Parameters<System['update']>[0]): number[] {
    const allColliders = query(world, [Position, BoxCollider])
    const eids: number[] = []
    for (let i = 0; i < allColliders.length; i++) {
        const eid = allColliders[i]
        if (isSolidCharacter(world, eid)) eids.push(eid)
    }
    return eids
}

function collisionCellSize(eids: number[], padding: number): number {
    let maxRadius = 0
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        maxRadius = Math.max(maxRadius, BoxCollider.x[eid], BoxCollider.z[eid])
    }
    return Math.max(1, maxRadius * 2 + padding)
}

function collectCandidatePairs(eids: number[], cellSize: number): CandidatePair[] {
    const buckets = new Map<string, number[]>()
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        const key = pairCellKey(Position.x[eid], Position.z[eid], cellSize)
        const bucket = buckets.get(key)
        if (bucket) bucket.push(eid)
        else buckets.set(key, [eid])
    }

    const pairs: CandidatePair[] = []
    for (let i = 0; i < eids.length; i++) {
        const a = eids[i]!
        const cx = Math.floor(Position.x[a] / cellSize)
        const cz = Math.floor(Position.z[a] / cellSize)
        for (let oz = -1; oz <= 1; oz++) {
            for (let ox = -1; ox <= 1; ox++) {
                const bucket = buckets.get(`${cx + ox},${cz + oz}`)
                if (!bucket) continue
                for (let j = 0; j < bucket.length; j++) {
                    const b = bucket[j]!
                    if (b <= a) continue
                    pairs.push({ a, b })
                }
            }
        }
    }
    return pairs
}

function pairCellKey(x: number, z: number, cellSize: number): string {
    return `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`
}

function isSolidCharacter(world: Parameters<System['update']>[0], eid: number): boolean {
    // The platformer foundation has only one actor class: the player. NPC /
    // pathing tags from the parent engine were dropped — re-add hooks here
    // when more actor archetypes land.
    return hasComponent(world, eid, PlayerControlled) && !hasComponent(world, eid, ClimbingLadder)
}

function separatePair(world: GameWorld, chunks: ChunkManager, a: number, b: number, padding: number): void {
    const aMinY = Position.y[a]
    const aMaxY = aMinY + BoxCollider.y[a] * 2
    const bMinY = Position.y[b]
    const bMaxY = bMinY + BoxCollider.y[b] * 2
    if (aMaxY <= bMinY || bMaxY <= aMinY) return

    let dx = Position.x[b] - Position.x[a]
    let dz = Position.z[b] - Position.z[a]
    let distSq = dx * dx + dz * dz
    if (distSq < 0.000001) {
        dx = ((a * 31 + b * 17) % 2) === 0 ? 1 : -1
        dz = ((a * 13 + b * 29) % 2) === 0 ? 0.35 : -0.35
        distSq = dx * dx + dz * dz
    }

    const minDist = BoxCollider.x[a] + BoxCollider.x[b] + padding
    if (distSq >= minDist * minDist) return

    const dist = Math.sqrt(distSq)
    const nx = dx / dist
    const nz = dz / dist
    const penetration = minDist - dist
    const aMovable = hasComponent(world, a, Velocity)
    const bMovable = hasComponent(world, b, Velocity)
    const movableCount = Number(aMovable) + Number(bMovable)
    if (movableCount === 0) return
    const aPush = aMovable ? penetration / movableCount : 0
    const bPush = bMovable ? penetration / movableCount : 0
    // Route the corrective shoves through sweepAxis so a wall (or a registered
    // obstacle from a settled rigid body) caps the displacement instead of
    // letting one actor push another through solid voxels.
    if (aPush > 0) {
        shoveActor(world, chunks, a, -nx * aPush, -nz * aPush)
    }
    if (bPush > 0) {
        shoveActor(world, chunks, b, nx * bPush, nz * bPush)
    }
    if (penetration > 0.08) {
        markBlockedMover(world, chooseYieldingEntity(world, a, b))
    }

    if (hasComponent(world, a, Velocity)) {
        const va = Velocity.x[a] * nx + Velocity.z[a] * nz
        if (va > 0) {
            Velocity.x[a] -= nx * va
            Velocity.z[a] -= nz * va
        }
    }
    if (hasComponent(world, b, Velocity)) {
        const vb = Velocity.x[b] * -nx + Velocity.z[b] * -nz
        if (vb > 0) {
            Velocity.x[b] += nx * vb
            Velocity.z[b] += nz * vb
        }
    }
}

function markBlockedMover(world: GameWorld, eid: number): void {
    if (!hasComponent(world, eid, MovementState)) return
    MovementState.value[eid] = MovementStateId.Blocked
}

function shoveActor(world: GameWorld, chunks: ChunkManager, eid: number, dx: number, dz: number): void {
    const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
    const half = { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }
    if (dx !== 0) {
        sweepAxis(chunks, pos, half, 'x', dx, world.obstacles, eid, 'foot')
        Position.x[eid] = pos.x
    }
    if (dz !== 0) {
        pos.x = Position.x[eid]
        sweepAxis(chunks, pos, half, 'z', dz, world.obstacles, eid, 'foot')
        Position.z[eid] = pos.z
    }
}

function chooseYieldingEntity(_world: Parameters<System['update']>[0], a: number, b: number): number {
    // Higher eid yields. Original engine biased by `MoveAlongPath` for AI; with
    // only the player as a solid character today, any deterministic tie-break
    // works.
    return a > b ? a : b
}

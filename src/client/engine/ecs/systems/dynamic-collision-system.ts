import { hasComponent, query } from 'bitecs'
import { sweepAxis, type ChunkManager } from '../../voxel'
import {
    BoxCollider,
    Interactable,
    MoveAlongPath,
    MovementState,
    PlayerControlled,
    Position,
    Velocity,
    Wanderer,
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
            const allColliders = query(world, [Position, BoxCollider])
            const eids: number[] = []
            for (let i = 0; i < allColliders.length; i++) {
                const eid = allColliders[i]
                if (isSolidCharacter(world, eid)) eids.push(eid)
            }
            for (let pass = 0; pass < passes; pass++) {
                for (let i = 0; i < eids.length; i++) {
                    const a = eids[i]
                    for (let j = i + 1; j < eids.length; j++) {
                        const b = eids[j]
                        separatePair(world, chunks, a, b, padding)
                    }
                }
            }
        },
    }
}

function isSolidCharacter(world: Parameters<System['update']>[0], eid: number): boolean {
    return hasComponent(world, eid, PlayerControlled) ||
        hasComponent(world, eid, Wanderer) ||
        hasComponent(world, eid, Interactable)
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
    const yieldEid = chooseYieldingEntity(world, a, b)
    if (penetration > 0.08 && hasComponent(world, yieldEid, MoveAlongPath)) {
        MovementState.value[yieldEid] = MovementStateId.Blocked
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

function shoveActor(world: GameWorld, chunks: ChunkManager, eid: number, dx: number, dz: number): void {
    const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
    const half = { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }
    if (dx !== 0) {
        const moved = sweepAxis(chunks, pos, half, 'x', dx, world.obstacles, eid, 'foot').moved
        Position.x[eid] = pos.x + moved
    }
    if (dz !== 0) {
        const startZ = { x: Position.x[eid], y: pos.y, z: pos.z }
        const moved = sweepAxis(chunks, startZ, half, 'z', dz, world.obstacles, eid, 'foot').moved
        Position.z[eid] = pos.z + moved
    }
}

function chooseYieldingEntity(world: Parameters<System['update']>[0], a: number, b: number): number {
    const aMoving = hasComponent(world, a, MoveAlongPath)
    const bMoving = hasComponent(world, b, MoveAlongPath)
    if (aMoving && !bMoving) return a
    if (bMoving && !aMoving) return b
    return a > b ? a : b
}

import { query } from 'bitecs'
import type { ChunkManager, ColliderAnchor } from '../../voxel'
import { sweepAxis } from '../../voxel'
import { BoxCollider, Position, RigidBody, Velocity } from '../components'
import type { System } from './system'
import type { GameWorld } from '../world'
import { FixedOrder } from './orders'

const POSITION_SLOP = 0.0008
const POSITION_PERCENT = 0.6

/**
 * Single-pass pairwise resolution between awake rigid bodies (e.g. mid-air
 * stones). Mass-weighted Baumgarte position correction with restitution-
 * weighted normal impulse.
 *
 * The position correction uses `sweepAxis` (not direct writes) so a body that
 * gets "squeezed" between another body and a wall stays clear of the wall —
 * shoving a stone through a voxel via pair-correction was the cause of the
 * stuck-in-wall bug.
 */
export function createRigidBodyPairSystem(chunks: ChunkManager): System {
    return {
        fixed: true,
        order: FixedOrder.rigidbodyPairs,
        update(world) {
            const eids = query(world, [Position, Velocity, BoxCollider, RigidBody])
            for (let i = 0; i < eids.length; i++) {
                const a = eids[i]
                for (let j = i + 1; j < eids.length; j++) {
                    resolvePair(chunks, world, a, eids[j])
                }
            }
        },
    }
}

function resolvePair(chunks: ChunkManager, world: GameWorld, a: number, b: number): void {
    const ahx = BoxCollider.x[a], ahy = BoxCollider.y[a], ahz = BoxCollider.z[a]
    const bhx = BoxCollider.x[b], bhy = BoxCollider.y[b], bhz = BoxCollider.z[b]

    const dx = Position.x[b] - Position.x[a]
    const dz = Position.z[b] - Position.z[a]
    const aCenterY = RigidBody.centerAnchored[a] === 1 ? Position.y[a] : Position.y[a] + ahy
    const bCenterY = RigidBody.centerAnchored[b] === 1 ? Position.y[b] : Position.y[b] + bhy
    const dy = bCenterY - aCenterY

    const overlapX = (ahx + bhx) - Math.abs(dx)
    const overlapY = (ahy + bhy) - Math.abs(dy)
    const overlapZ = (ahz + bhz) - Math.abs(dz)
    if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return

    let nx = 0, ny = 0, nz = 0
    let penetration = 0
    if (overlapX < overlapY && overlapX < overlapZ) {
        nx = dx < 0 ? -1 : 1
        penetration = overlapX
    } else if (overlapY < overlapZ) {
        ny = dy < 0 ? -1 : 1
        penetration = overlapY
    } else {
        nz = dz < 0 ? -1 : 1
        penetration = overlapZ
    }

    const massA = RigidBody.mass[a] > 0 ? RigidBody.mass[a] : 1
    const massB = RigidBody.mass[b] > 0 ? RigidBody.mass[b] : 1
    const invA = 1 / massA
    const invB = 1 / massB
    const invSum = invA + invB

    const correction = Math.max(penetration - POSITION_SLOP, 0) * (POSITION_PERCENT / invSum)
    if (correction > 0) {
        applyCorrection(chunks, world, a, ahx, ahy, ahz, -nx * correction * invA, -ny * correction * invA, -nz * correction * invA)
        applyCorrection(chunks, world, b, bhx, bhy, bhz, nx * correction * invB, ny * correction * invB, nz * correction * invB)
    }

    const rvx = Velocity.x[b] - Velocity.x[a]
    const rvy = Velocity.y[b] - Velocity.y[a]
    const rvz = Velocity.z[b] - Velocity.z[a]
    const velAlongNormal = rvx * nx + rvy * ny + rvz * nz
    if (velAlongNormal > 0) return

    const restitution = Math.min(RigidBody.restitution[a], RigidBody.restitution[b])
    const impulseScalar = -(1 + restitution) * velAlongNormal / invSum
    const ix = nx * impulseScalar
    const iy = ny * impulseScalar
    const iz = nz * impulseScalar
    Velocity.x[a] -= ix * invA
    Velocity.y[a] -= iy * invA
    Velocity.z[a] -= iz * invA
    Velocity.x[b] += ix * invB
    Velocity.y[b] += iy * invB
    Velocity.z[b] += iz * invB
}

function applyCorrection(
    chunks: ChunkManager,
    world: GameWorld,
    eid: number,
    hx: number,
    hy: number,
    hz: number,
    cx: number,
    cy: number,
    cz: number,
): void {
    const obstacles = world.obstacles
    const anchor: ColliderAnchor = RigidBody.centerAnchored[eid] === 1 ? 'center' : 'foot'
    const half = { x: hx, y: hy, z: hz }
    const pos = { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
    if (cx !== 0) sweepAxis(chunks, pos, half, 'x', cx, obstacles, eid, anchor)
    if (cy !== 0) sweepAxis(chunks, pos, half, 'y', cy, obstacles, eid, anchor)
    if (cz !== 0) sweepAxis(chunks, pos, half, 'z', cz, obstacles, eid, anchor)
    Position.x[eid] = pos.x
    Position.y[eid] = pos.y
    Position.z[eid] = pos.z
}

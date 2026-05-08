import { query } from 'bitecs'
import { BoxCollider, Position, RigidBody, Velocity } from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'

const POSITION_SLOP = 0.0008
const POSITION_PERCENT = 0.6

/**
 * Single-pass pairwise resolution between awake rigid bodies (e.g. mid-air
 * stones). Mass-weighted position correction with Baumgarte stabilization,
 * plus restitution-weighted normal impulse.
 *
 * Only acts on pairs of (Position, Velocity, BoxCollider, RigidBody) — i.e.
 * dynamic bodies that the physics-system also integrates. Sleeping bodies are
 * filtered out of the query because they have no Velocity component, and the
 * voxel-sweep already collides moving bodies against them via the obstacle
 * registry.
 */
export function createRigidBodyPairSystem(): System {
    return {
        fixed: true,
        order: FixedOrder.rigidbodyPairs,
        update(world) {
            const eids = query(world, [Position, Velocity, BoxCollider, RigidBody])
            for (let i = 0; i < eids.length; i++) {
                const a = eids[i]
                for (let j = i + 1; j < eids.length; j++) {
                    resolvePair(a, eids[j])
                }
            }
        },
    }
}

function resolvePair(a: number, b: number): void {
    const ahx = BoxCollider.x[a], ahy = BoxCollider.y[a], ahz = BoxCollider.z[a]
    const bhx = BoxCollider.x[b], bhy = BoxCollider.y[b], bhz = BoxCollider.z[b]

    const dx = Position.x[b] - Position.x[a]
    const dz = Position.z[b] - Position.z[a]
    // Foot-anchored bodies have Position.y at their bottom face; centre-anchored
    // bodies have Position.y at the AABB centre. Add half.y for the former.
    const aCenterY = RigidBody.centerAnchored[a] === 1 ? Position.y[a] : Position.y[a] + ahy
    const bCenterY = RigidBody.centerAnchored[b] === 1 ? Position.y[b] : Position.y[b] + bhy
    const dy = bCenterY - aCenterY

    const overlapX = (ahx + bhx) - Math.abs(dx)
    const overlapY = (ahy + bhy) - Math.abs(dy)
    const overlapZ = (ahz + bhz) - Math.abs(dz)
    if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) return

    // Pick the axis of minimum penetration as the contact normal — same heuristic
    // a standard SAT-on-AABB resolver uses.
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

    // Position correction (Baumgarte). Skip a tiny slop so resting stacks don't
    // jitter against each other.
    const correction = Math.max(penetration - POSITION_SLOP, 0) * (POSITION_PERCENT / invSum)
    const cax = nx * correction * invA
    const cay = ny * correction * invA
    const caz = nz * correction * invA
    const cbx = nx * correction * invB
    const cby = ny * correction * invB
    const cbz = nz * correction * invB
    Position.x[a] -= cax
    Position.y[a] -= cay
    Position.z[a] -= caz
    Position.x[b] += cbx
    Position.y[b] += cby
    Position.z[b] += cbz

    // Relative velocity along the normal. If they're already separating, no
    // impulse needed.
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

import { hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxCollider,
    Interactable,
    MoveAlongPath,
    MovementState,
    PlayerControlled,
    Position,
    Velocity,
    Wanderer,
    WanderTimer,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { MovementStateId } from '../movement-state'

export interface DynamicCollisionOptions {
    /** Extra horizontal gap between solid character bodies. Default 0.08. */
    padding?: number
    passes?: number
}

export function createDynamicCollisionSystem(opts: DynamicCollisionOptions = {}): System {
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
                        separatePair(world, a, b, padding)
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

function separatePair(world: Parameters<System['update']>[0], a: number, b: number, padding: number): void {
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
    Position.x[a] -= nx * aPush
    Position.z[a] -= nz * aPush
    Position.x[b] += nx * bPush
    Position.z[b] += nz * bPush
    const yieldEid = chooseYieldingEntity(world, a, b)
    if (penetration > 0.06) cancelPath(world, yieldEid)

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

function chooseYieldingEntity(world: Parameters<System['update']>[0], a: number, b: number): number {
    const aMoving = hasComponent(world, a, MoveAlongPath)
    const bMoving = hasComponent(world, b, MoveAlongPath)
    if (aMoving && !bMoving) return a
    if (bMoving && !aMoving) return b
    return a > b ? a : b
}

function cancelPath(world: Parameters<System['update']>[0], eid: number): void {
    if (hasComponent(world, eid, MoveAlongPath)) {
        removeComponent(world, eid, MoveAlongPath)
        world.pathByEid.delete(eid)
    }
    if (hasComponent(world, eid, Velocity)) {
        Velocity.x[eid] = 0
        Velocity.z[eid] = 0
    }
    if (hasComponent(world, eid, WanderTimer)) {
        WanderTimer.value[eid] = 0.75 + (eid % 5) * 0.16
    }
    MovementState.value[eid] = MovementStateId.Blocked
}

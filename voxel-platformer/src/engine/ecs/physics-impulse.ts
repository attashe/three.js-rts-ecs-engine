import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxCollider,
    MovementState,
    PlayerControlled,
    Position,
    RigidBody,
    Sleeping,
    StaticRenderable,
    Velocity,
} from './components'
import { MovementStateId } from './movement-state'
import type { GameWorld } from './world'

export interface RadialPhysicsImpulseOptions {
    origin: { x: number; y: number; z: number }
    radius: number
    baseSpeed: number
    minSpeedFactor?: number
    verticalLift?: number
    exclude?: (eid: number) => boolean
}

export function applyPhysicsImpulse(
    world: GameWorld,
    eid: number,
    impulse: { x: number; y: number; z: number },
): boolean {
    const sleeping = hasComponent(world, eid, Sleeping)
    const hadVelocity = hasComponent(world, eid, Velocity)
    if (!sleeping && !hadVelocity) return false
    if (sleeping) wakeSleepingBody(world, eid)
    if (!hasComponent(world, eid, Velocity)) {
        addComponent(world, eid, Velocity)
        Velocity.x[eid] = 0
        Velocity.y[eid] = 0
        Velocity.z[eid] = 0
    }
    Velocity.x[eid] += impulse.x
    Velocity.y[eid] += impulse.y
    Velocity.z[eid] += impulse.z
    if (hasComponent(world, eid, MovementState)) {
        MovementState.value[eid] = MovementStateId.Airborne
    }
    return true
}

export function applyRadialPhysicsImpulse(world: GameWorld, opts: RadialPhysicsImpulseOptions): number {
    const radius = Math.max(0, opts.radius)
    if (!(radius > 0) || !(opts.baseSpeed > 0)) return 0
    const radiusSq = radius * radius
    const minSpeedFactor = opts.minSpeedFactor ?? 0.2
    const verticalLift = opts.verticalLift ?? 0
    let pushed = 0
    const candidates = query(world, [Position, BoxCollider])
    for (let i = 0; i < candidates.length; i++) {
        const eid = candidates[i]!
        if (hasComponent(world, eid, PlayerControlled)) continue
        if (opts.exclude?.(eid)) continue
        const center = bodyCenter(world, eid)
        const dx = center.x - opts.origin.x
        const dy = center.y - opts.origin.y
        const dz = center.z - opts.origin.z
        const distSq = dx * dx + dy * dy + dz * dz
        if (distSq > radiusSq) continue
        const dist = Math.sqrt(distSq)
        if (dist < 0.001) continue
        const proximity = Math.max(0, 1 - dist / radius)
        const speed = opts.baseSpeed * (minSpeedFactor + (1 - minSpeedFactor) * proximity)
        const radialX = dx / dist
        const radialY = dy / dist
        const radialZ = dz / dist
        if (applyPhysicsImpulse(world, eid, {
            x: radialX * speed,
            y: Math.max(0, radialY) * speed * 0.5 + verticalLift * proximity,
            z: radialZ * speed,
        })) {
            pushed++
        }
    }
    return pushed
}

export function wakeSleepingBody(world: GameWorld, eid: number): void {
    removeComponent(world, eid, Sleeping)
    if (hasComponent(world, eid, StaticRenderable)) removeComponent(world, eid, StaticRenderable)
    world.obstacles.remove(eid)
    if (hasComponent(world, eid, RigidBody)) {
        RigidBody.sleepTimer[eid] = 0
    }
}

function bodyCenter(world: GameWorld, eid: number): { x: number; y: number; z: number } {
    const isCenterAnchored = hasComponent(world, eid, RigidBody) && RigidBody.centerAnchored[eid] === 1
    return {
        x: Position.x[eid],
        y: isCenterAnchored ? Position.y[eid] : Position.y[eid] + BoxCollider.y[eid],
        z: Position.z[eid],
    }
}

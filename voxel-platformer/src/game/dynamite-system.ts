import { addComponent, hasComponent, query } from 'bitecs'
import { BoxCollider, Health, MovingObject, PlayerControlled, Position, Velocity } from '../engine/ecs/components'
import { applyDamage } from '../engine/ecs/combat'
import { despawnEntity } from '../engine/ecs/entity'
import { pushDebugHitbox } from '../engine/ecs/debug-hitboxes'
import { applyRadialPhysicsImpulse } from '../engine/ecs/physics-impulse'
import { FixedOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { GameWorld } from '../engine/ecs/world'
import { MovingObjectKind } from './moving-objects'
import { damageNpc, type NpcRuntimeState } from './npcs/npc-types'

export const DYNAMITE_FUSE_SECONDS = 1.8
export const DYNAMITE_EXPLOSION_RADIUS = 3.25
export const DYNAMITE_EXPLOSION_VERTICAL_REACH = 2.25
export const DYNAMITE_MAX_DAMAGE = 4
export const DYNAMITE_MIN_DAMAGE = 1
export const DYNAMITE_MAX_PUSH_SPEED = 11
export const DYNAMITE_VERTICAL_LIFT = 4

export interface DynamiteExplosionEvent {
    x: number
    y: number
    z: number
    damagedActors: number
    pushedBodies: number
}

export interface DynamiteSystemOptions {
    onExplode?: (event: DynamiteExplosionEvent) => void
}

export function createDynamiteSystem(opts: DynamiteSystemOptions = {}): System {
    return {
        name: 'dynamite',
        fixed: true,
        order: FixedOrder.postPhysics + 2,
        update(world) {
            const gw = world as GameWorld
            const dynamites = [...query(world, [MovingObject, Position])]
                .filter((eid) => MovingObject.kind[eid] === MovingObjectKind.Dynamite && MovingObject.age[eid] >= DYNAMITE_FUSE_SECONDS)
            for (const eid of dynamites) {
                const x = Position.x[eid]
                const y = Position.y[eid]
                const z = Position.z[eid]
                despawnEntity(gw, eid)
                const event = explodeAt(gw, { x, y, z })
                opts.onExplode?.(event)
            }
        },
    }
}

export function explodeAt(gw: GameWorld, origin: { x: number; y: number; z: number }): DynamiteExplosionEvent {
    pushDebugHitbox(gw, {
        kind: 'circle',
        id: `dynamite:${origin.x.toFixed(2)}:${origin.y.toFixed(2)}:${origin.z.toFixed(2)}`,
        center: origin,
        radius: DYNAMITE_EXPLOSION_RADIUS,
        ttl: 0.2,
        color: [1, 0.34, 0.08],
    })

    let damagedActors = 0
    const players = query(gw, [PlayerControlled, Position, BoxCollider, Health])
    for (let i = 0; i < players.length; i++) {
        const eid = players[i]!
        const hit = playerExplosionHit(eid, origin)
        if (!hit) continue
        const damage = explosionDamage(hit.distance)
        applyDamage(gw, eid, damage)
        applyPlayerExplosionPush(gw, eid, origin, hit.center, hit.proximity)
        damagedActors++
    }

    for (const npc of gw.npcRuntimeById.values()) {
        if (npc.dying) continue
        const hit = npcExplosionHit(npc, origin)
        if (!hit) continue
        damageNpc(npc, explosionDamage(hit.distance), { byPlayer: true })
        applyNpcExplosionPush(npc, origin, hit.center, hit.proximity)
        damagedActors++
    }

    const pushedBodies = applyRadialPhysicsImpulse(gw, {
        origin,
        radius: DYNAMITE_EXPLOSION_RADIUS,
        baseSpeed: DYNAMITE_MAX_PUSH_SPEED,
        minSpeedFactor: 0.25,
        verticalLift: DYNAMITE_VERTICAL_LIFT,
    })

    return { ...origin, damagedActors, pushedBodies }
}

interface ExplosionHit {
    distance: number
    proximity: number
    center: { x: number; y: number; z: number }
}

function playerExplosionHit(eid: number, origin: { x: number; y: number; z: number }): ExplosionHit | null {
    const minX = Position.x[eid] - BoxCollider.x[eid]
    const maxX = Position.x[eid] + BoxCollider.x[eid]
    const minY = Position.y[eid]
    const maxY = Position.y[eid] + BoxCollider.y[eid] * 2
    const minZ = Position.z[eid] - BoxCollider.z[eid]
    const maxZ = Position.z[eid] + BoxCollider.z[eid]
    return explosionAabbHit(origin, minX, maxX, minY, maxY, minZ, maxZ)
}

function npcExplosionHit(npc: NpcRuntimeState, origin: { x: number; y: number; z: number }): ExplosionHit | null {
    return explosionAabbHit(
        origin,
        npc.position.x - npc.colliderRadius,
        npc.position.x + npc.colliderRadius,
        npc.position.y,
        npc.position.y + npc.colliderHeight,
        npc.position.z - npc.colliderRadius,
        npc.position.z + npc.colliderRadius,
    )
}

function explosionAabbHit(
    origin: { x: number; y: number; z: number },
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
): ExplosionHit | null {
    const nx = Math.max(minX, Math.min(origin.x, maxX))
    const nz = Math.max(minZ, Math.min(origin.z, maxZ))
    const verticalGap = origin.y < minY ? minY - origin.y : origin.y > maxY ? origin.y - maxY : 0
    if (verticalGap > DYNAMITE_EXPLOSION_VERTICAL_REACH) return null
    const dx = origin.x - nx
    const dz = origin.z - nz
    const horizontal = Math.hypot(dx, dz)
    if (horizontal > DYNAMITE_EXPLOSION_RADIUS) return null
    const distance = Math.hypot(horizontal, verticalGap)
    if (distance > DYNAMITE_EXPLOSION_RADIUS) return null
    const proximity = Math.max(0, 1 - distance / DYNAMITE_EXPLOSION_RADIUS)
    return {
        distance,
        proximity,
        center: {
            x: (minX + maxX) * 0.5,
            y: (minY + maxY) * 0.5,
            z: (minZ + maxZ) * 0.5,
        },
    }
}

function explosionDamage(distance: number): number {
    const proximity = Math.max(0, 1 - distance / DYNAMITE_EXPLOSION_RADIUS)
    return Math.max(DYNAMITE_MIN_DAMAGE, Math.ceil(DYNAMITE_MAX_DAMAGE * (0.25 + proximity * 0.75)))
}

function applyPlayerExplosionPush(
    gw: GameWorld,
    eid: number,
    origin: { x: number; y: number; z: number },
    center: { x: number; y: number; z: number },
    proximity: number,
): void {
    if (!hasComponent(gw, eid, Velocity)) {
        addComponent(gw, eid, Velocity)
        Velocity.x[eid] = 0
        Velocity.y[eid] = 0
        Velocity.z[eid] = 0
    }
    const dir = horizontalDirection(origin, center)
    const speed = DYNAMITE_MAX_PUSH_SPEED * (0.25 + proximity * 0.75)
    Velocity.x[eid] += dir.x * speed
    Velocity.y[eid] += DYNAMITE_VERTICAL_LIFT * proximity
    Velocity.z[eid] += dir.z * speed
}

function applyNpcExplosionPush(
    npc: NpcRuntimeState,
    origin: { x: number; y: number; z: number },
    center: { x: number; y: number; z: number },
    proximity: number,
): void {
    const dir = horizontalDirection(origin, center)
    const speed = DYNAMITE_MAX_PUSH_SPEED * (0.25 + proximity * 0.75)
    npc.push = {
        vx: dir.x * speed,
        vz: dir.z * speed,
        seconds: 0.16,
    }
}

function horizontalDirection(
    origin: { x: number; z: number },
    center: { x: number; z: number },
): { x: number; z: number } {
    const dx = center.x - origin.x
    const dz = center.z - origin.z
    const dist = Math.hypot(dx, dz)
    if (dist < 0.001) return { x: 0, z: 1 }
    return { x: dx / dist, z: dz / dist }
}

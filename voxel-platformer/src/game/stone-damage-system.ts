import { hasComponent, query } from 'bitecs'
import { BoxCollider, Health, MovingObject, PlayerControlled, Position, Velocity } from '../engine/ecs/components'
import { applyDamage } from '../engine/ecs/combat'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import type { GameWorld } from '../engine/ecs/world'
import { MovingObjectKind } from './moving-objects'
import { damageNpc } from './npcs/npc-types'

// A stone slower than this reads as "settled" and can't hurt anyone.
const MIN_DAMAGE_SPEED = 5
const MIN_DAMAGE_SPEED_SQ = MIN_DAMAGE_SPEED * MIN_DAMAGE_SPEED

export interface StoneDamageOptions {
    /** Fired when a falling stone hurts a character (for an impact/grunt SFX). */
    onHit?: () => void
}

/**
 * Migrates the base game's falling-stone hazard: a stone moving fast enough that
 * overlaps a character deals damage to it — to the player and to NPCs alike
 * (invulnerable NPCs are skipped by `damageNpc`). Each stone hits a given target
 * at most once so a stone settling against someone doesn't grind their HP down.
 * Damage scales with impact speed (a plummeting boulder hurts more than a
 * trickling pebble).
 */
export function createStoneDamageSystem(opts: StoneDamageOptions = {}): System {
    // stone eid -> set of target keys it has already struck.
    const struck = new Map<number, Set<string>>()

    return {
        name: 'stoneDamage',
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world) {
            const gw = world as GameWorld
            const stones = query(world, [MovingObject, Position, Velocity, BoxCollider])
            const live = new Set<number>()

            for (let i = 0; i < stones.length; i++) {
                const eid = stones[i]!
                if (MovingObject.kind[eid] !== MovingObjectKind.Stone) continue
                const vx = Velocity.x[eid]!, vy = Velocity.y[eid]!, vz = Velocity.z[eid]!
                const speedSq = vx * vx + vy * vy + vz * vz
                if (speedSq < MIN_DAMAGE_SPEED_SQ) continue
                live.add(eid)
                const damage = stoneDamage(Math.sqrt(speedSq))

                // Stone is centre-anchored: Position is its centre, collider is a
                // half-extent on each axis.
                const sMinX = Position.x[eid]! - BoxCollider.x[eid]!
                const sMaxX = Position.x[eid]! + BoxCollider.x[eid]!
                const sMinY = Position.y[eid]! - BoxCollider.y[eid]!
                const sMaxY = Position.y[eid]! + BoxCollider.y[eid]!
                const sMinZ = Position.z[eid]! - BoxCollider.z[eid]!
                const sMaxZ = Position.z[eid]! + BoxCollider.z[eid]!

                const hitSet = struck.get(eid) ?? new Set<string>()

                // Players (foot-anchored AABB).
                const players = query(world, [PlayerControlled, Position, BoxCollider, Health])
                for (let p = 0; p < players.length; p++) {
                    const pe = players[p]!
                    const key = `p${pe}`
                    if (hitSet.has(key)) continue
                    if (!overlaps(
                        sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
                        Position.x[pe]! - BoxCollider.x[pe]!, Position.x[pe]! + BoxCollider.x[pe]!,
                        Position.y[pe]!, Position.y[pe]! + BoxCollider.y[pe]! * 2,
                        Position.z[pe]! - BoxCollider.z[pe]!, Position.z[pe]! + BoxCollider.z[pe]!,
                    )) continue
                    hitSet.add(key)
                    applyDamage(gw, pe, damage)
                    opts.onHit?.()
                }

                // NPCs (foot-anchored AABB from the runtime side-table).
                for (const npc of gw.npcRuntimeById.values()) {
                    if (npc.dying) continue
                    const key = `n${npc.id}`
                    if (hitSet.has(key)) continue
                    if (!overlaps(
                        sMinX, sMaxX, sMinY, sMaxY, sMinZ, sMaxZ,
                        npc.position.x - npc.colliderRadius, npc.position.x + npc.colliderRadius,
                        npc.position.y, npc.position.y + npc.colliderHeight,
                        npc.position.z - npc.colliderRadius, npc.position.z + npc.colliderRadius,
                    )) continue
                    hitSet.add(key)
                    if (damageNpc(npc, damage)) opts.onHit?.()
                    else if (!npc.invulnerable) opts.onHit?.()
                }

                if (hitSet.size > 0) struck.set(eid, hitSet)
            }

            // Forget stones that have settled or despawned so the map can't grow
            // unbounded (and a re-thrown stone can hit again).
            for (const eid of struck.keys()) {
                if (!live.has(eid)) struck.delete(eid)
            }
        },
    }
}

function stoneDamage(speed: number): number {
    return Math.min(3, 1 + Math.floor(speed / 10))
}

function overlaps(
    aMinX: number, aMaxX: number, aMinY: number, aMaxY: number, aMinZ: number, aMaxZ: number,
    bMinX: number, bMaxX: number, bMinY: number, bMaxY: number, bMinZ: number, bMaxZ: number,
): boolean {
    return aMaxX > bMinX && aMinX < bMaxX &&
        aMaxY > bMinY && aMinY < bMaxY &&
        aMaxZ > bMinZ && aMinZ < bMaxZ
}

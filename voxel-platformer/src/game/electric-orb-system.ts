import { query } from 'bitecs'
import { BoxCollider, Health, MovingObject, PlayerControlled, Position, Velocity } from '../engine/ecs/components'
import { applyDamage } from '../engine/ecs/combat'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import type { GameWorld } from '../engine/ecs/world'
import { MovingObjectKind } from './moving-objects'
import { damageNpc } from './npcs/npc-types'

const ZAP_DAMAGE = 1 // half a heart
const ZAP_RADIUS = 0.55 // generous contact radius around the orb
const ZAP_COOLDOWN = 0.45 // seconds before the same orb can re-zap a target
// Random sideways jolts that keep the orb's path lively/erratic.
const WOBBLE_INTERVAL = 0.12
const WOBBLE_STRENGTH = 5

export interface ElectricOrbOptions {
    /** Fired when an orb zaps a character, at the orb's position (for a
     *  spatial SFX). */
    onZap?: (position: { x: number; y: number; z: number }) => void
}

/**
 * Drives electric-orb spell projectiles: adds erratic velocity fluctuations on
 * top of the physics bounce, and zaps any character the orb is touching. Unlike
 * the one-shot bolt, an orb keeps bouncing and can re-zap a target after a short
 * cooldown, so a well-placed orb pinballs through a knot of enemies.
 */
export function createElectricOrbSystem(opts: ElectricOrbOptions = {}): System {
    let now = 0
    // orb eid -> wobble countdown.
    const wobbleTimers = new Map<number, number>()
    // orb eid -> (target key -> time the orb may zap it again).
    const zapReady = new Map<number, Map<string, number>>()

    return {
        name: 'electricOrb',
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world, dt) {
            now += dt
            const gw = world as GameWorld
            const orbs = query(world, [MovingObject, Position, Velocity, BoxCollider])
            const live = new Set<number>()

            for (let i = 0; i < orbs.length; i++) {
                const eid = orbs[i]!
                if (MovingObject.kind[eid] !== MovingObjectKind.ElectricOrb) continue
                live.add(eid)

                // Erratic fluctuation: periodic random horizontal jolts.
                let wobble = (wobbleTimers.get(eid) ?? 0) - dt
                if (wobble <= 0) {
                    wobble = WOBBLE_INTERVAL
                    Velocity.x[eid] += (Math.random() * 2 - 1) * WOBBLE_STRENGTH
                    Velocity.z[eid] += (Math.random() * 2 - 1) * WOBBLE_STRENGTH
                }
                wobbleTimers.set(eid, wobble)

                const ox = Position.x[eid]!, oy = Position.y[eid]!, oz = Position.z[eid]!
                const reach = BoxCollider.x[eid]! + ZAP_RADIUS
                const ready = zapReady.get(eid) ?? new Map<string, number>()

                // Player.
                const players = query(world, [PlayerControlled, Position, BoxCollider, Health])
                for (let p = 0; p < players.length; p++) {
                    const pe = players[p]!
                    const key = `p${pe}`
                    if ((ready.get(key) ?? 0) > now) continue
                    if (!nearBox(ox, oy, oz, reach,
                        Position.x[pe]! - BoxCollider.x[pe]!, Position.x[pe]! + BoxCollider.x[pe]!,
                        Position.y[pe]!, Position.y[pe]! + BoxCollider.y[pe]! * 2,
                        Position.z[pe]! - BoxCollider.z[pe]!, Position.z[pe]! + BoxCollider.z[pe]!)) continue
                    ready.set(key, now + ZAP_COOLDOWN)
                    applyDamage(gw, pe, ZAP_DAMAGE)
                    opts.onZap?.({ x: ox, y: oy, z: oz })
                }

                // NPCs.
                for (const npc of gw.npcRuntimeById.values()) {
                    if (npc.dying) continue
                    const key = `n${npc.id}`
                    if ((ready.get(key) ?? 0) > now) continue
                    if (!nearBox(ox, oy, oz, reach,
                        npc.position.x - npc.colliderRadius, npc.position.x + npc.colliderRadius,
                        npc.position.y, npc.position.y + npc.colliderHeight,
                        npc.position.z - npc.colliderRadius, npc.position.z + npc.colliderRadius)) continue
                    ready.set(key, now + ZAP_COOLDOWN)
                    if (!npc.invulnerable) {
                        damageNpc(npc, ZAP_DAMAGE)
                        opts.onZap?.({ x: ox, y: oy, z: oz })
                    }
                }

                if (ready.size > 0) zapReady.set(eid, ready)
            }

            // Drop bookkeeping for orbs that have expired.
            for (const eid of wobbleTimers.keys()) if (!live.has(eid)) wobbleTimers.delete(eid)
            for (const eid of zapReady.keys()) if (!live.has(eid)) zapReady.delete(eid)
        },
    }
}

/** True if the orb's reach sphere (centre + `reach`) overlaps the AABB. */
function nearBox(
    cx: number, cy: number, cz: number, reach: number,
    minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number,
): boolean {
    const nx = Math.max(minX, Math.min(cx, maxX))
    const ny = Math.max(minY, Math.min(cy, maxY))
    const nz = Math.max(minZ, Math.min(cz, maxZ))
    const dx = cx - nx, dy = cy - ny, dz = cz - nz
    return dx * dx + dy * dy + dz * dz <= reach * reach
}

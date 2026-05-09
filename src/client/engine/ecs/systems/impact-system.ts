import { hasComponent, query } from 'bitecs'
import {
    BoxCollider,
    Health,
    PlayerControlled,
    Position,
    RigidBody,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'
import { applyDamagePacket } from '../damage'

const DAMAGE_COEFF = 0.5

export interface ImpactSystemOptions {
    /** Maximum damage applied per single impact, regardless of mass·speed. */
    maxDamagePerImpact?: number
    /** Cooldown (sec) between damage ticks from the same body onto the same target. */
    perPairCooldown?: number
}

/**
 * Drains the per-frame impact-event queue produced by physics-system and
 * applies damage to any `Health` entity whose AABB overlaps the impacting
 * body. Damage scales with body mass and inbound speed, gated by the body's
 * `RigidBody.impactDamageScale` (0 = inert; falling stones use ~0.6).
 *
 * Health entities are queried each frame (cheap — typically <30 entities).
 */
export function createImpactSystem(opts: ImpactSystemOptions = {}): System {
    const maxDamage = opts.maxDamagePerImpact ?? 60
    const cooldown = opts.perPairCooldown ?? 0.4

    /** Map<"impactor|target", remainingCooldownSeconds> */
    const recent = new Map<string, number>()

    return {
        fixed: true,
        order: FixedOrder.impacts,
        update(world, dt) {
            // Tick down cooldowns.
            for (const [k, v] of recent) {
                const next = v - dt
                if (next <= 0) recent.delete(k)
                else recent.set(k, next)
            }

            const events = world.impactEvents
            if (events.length === 0) return

            const targets = query(world, [Position, BoxCollider, Health])

            for (let i = 0; i < events.length; i++) {
                const ev = events[i]
                const halfX = BoxCollider.x[ev.eid]
                const halfY = BoxCollider.y[ev.eid]
                const halfZ = BoxCollider.z[ev.eid]
                const eventCenterAnchored =
                    hasComponent(world, ev.eid, RigidBody) && RigidBody.centerAnchored[ev.eid] === 1
                const aMinX = ev.x - halfX
                const aMaxX = ev.x + halfX
                const aMinY = eventCenterAnchored ? ev.y - halfY : ev.y
                const aMaxY = eventCenterAnchored ? ev.y + halfY : ev.y + halfY * 2
                const aMinZ = ev.z - halfZ
                const aMaxZ = ev.z + halfZ

                for (let j = 0; j < targets.length; j++) {
                    const target = targets[j]
                    if (target === ev.eid) continue
                    if (Health.current[target] <= 0) continue

                    const tHalfX = BoxCollider.x[target]
                    const tHalfY = BoxCollider.y[target]
                    const tHalfZ = BoxCollider.z[target]
                    const targetCenterAnchored =
                        hasComponent(world, target, RigidBody) && RigidBody.centerAnchored[target] === 1
                    const tMinX = Position.x[target] - tHalfX
                    const tMaxX = Position.x[target] + tHalfX
                    const tMinY = targetCenterAnchored ? Position.y[target] - tHalfY : Position.y[target]
                    const tMaxY = targetCenterAnchored ? Position.y[target] + tHalfY : Position.y[target] + tHalfY * 2
                    const tMinZ = Position.z[target] - tHalfZ
                    const tMaxZ = Position.z[target] + tHalfZ

                    if (aMaxX <= tMinX || aMinX >= tMaxX) continue
                    if (aMaxY <= tMinY || aMinY >= tMaxY) continue
                    if (aMaxZ <= tMinZ || aMinZ >= tMaxZ) continue

                    const key = `${ev.eid}|${target}`
                    if (recent.has(key)) continue
                    recent.set(key, cooldown)

                    const damage = Math.min(maxDamage, ev.mass * ev.speed * DAMAGE_COEFF)
                    if (damage <= 0) continue

                    const result = applyDamagePacket(world, {
                        source: ev.eid,
                        target,
                        amount: damage,
                        type: 'impact',
                    })
                    if (!result.applied) continue

                    const message = formatImpactMessage(world, target, result.amount)
                    pushGameLog(world, { type: 'combat', message, eid: target })
                }
            }

            events.length = 0
        },
    }
}

function formatImpactMessage(
    world: Parameters<System['update']>[0],
    target: number,
    damage: number,
): string {
    const dmg = damage.toFixed(1)
    if (hasComponent(world, target, PlayerControlled)) {
        return `Falling debris hit you for ${dmg}.`
    }
    return `Falling debris struck ${world.interactionByEid.get(target)?.label ?? 'target'} for ${dmg}.`
}

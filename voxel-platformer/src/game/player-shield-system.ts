import { hasComponent, query } from 'bitecs'
import { Grounded, PlayerControlled, Shield, Velocity } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import type { GameWorld } from '../engine/ecs/world'

// Raise the shield only while nearly stationary, so blocking costs you movement
// rather than being free.
const GUARD_SPEED_SQ = 0.6 * 0.6

/**
 * Raises the player's shield while *guarding*: in melee stance, grounded, and
 * roughly stationary. A raised shield blocks frontal NPC melee within its arc
 * (see `blockedByShield` in npc-behaviour-system). Advancing, jumping, or
 * switching to the ranged stance lowers it, so the block isn't free.
 *
 * Runs just before the NPC brain so the guard state is current when NPCs decide
 * whether their hit lands this tick.
 */
export function createPlayerShieldSystem(): System {
    return {
        fixed: true,
        order: FixedOrder.npcBehaviour - 1,
        update(world) {
            const melee = (world as GameWorld).weaponStance === 'melee'
            const players = query(world, [PlayerControlled, Shield])
            for (let i = 0; i < players.length; i++) {
                const eid = players[i]!
                let stationary = true
                if (hasComponent(world, eid, Velocity)) {
                    const vx = Velocity.x[eid]!
                    const vz = Velocity.z[eid]!
                    stationary = vx * vx + vz * vz <= GUARD_SPEED_SQ
                }
                const guarding = melee && stationary && hasComponent(world, eid, Grounded)
                Shield.raised[eid] = guarding ? 1 : 0
            }
        },
    }
}

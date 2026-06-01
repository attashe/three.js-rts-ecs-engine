import { hasComponent, query } from 'bitecs'
import { Grounded, PlayerControlled, Position, Rotation, Shield, Stunned } from '../engine/ecs/components'
import { clearDebugHitbox, debugHitboxesEnabled, pushDebugHitbox } from '../engine/ecs/debug-hitboxes'
import type { ActionId, ActionMap } from '../engine/input/actions'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import type { GameWorld } from '../engine/ecs/world'
import { COMBAT_PARAM } from './anim/graph-defaults'

// Front guard: a deliberate ~120° cone aimed where the player faces.
const FRONT_ARC_COS = Math.cos((60 * Math.PI) / 180)
// Passive guard: a narrower ~90° cone covering the player's left flank, where
// the shield rides on the left arm.
const PASSIVE_ARC_COS = Math.cos((45 * Math.PI) / 180)
const LEFT_YAW_OFFSET = -Math.PI / 2
const FRONT_BLOCK_RANGE = 1.42
const PASSIVE_BLOCK_RANGE = 0.92
export const PERFECT_BLOCK_WINDOW_SECONDS = 0.22
export const BLOCK_RELOAD_SECONDS = 0.55

export interface PlayerShieldOptions {
    /** Action that raises the front guard while held. */
    actionId?: ActionId
}

/**
 * Drives the player's shield in the melee stance:
 *  - **T held → front block.** A wide frontal cone aimed where the player
 *    faces; deflects melee coming at the front (see `blockedByShield`).
 *  - **otherwise → passive left block.** While grounded the shield still rides
 *    the left arm, deflecting hits coming from the player's left flank.
 * Leaving the melee stance (or going airborne) lowers it entirely.
 *
 * Runs just before the NPC brain so the guard state is current when NPCs decide
 * whether their hit lands this tick.
 */
export function createPlayerShieldSystem(actions: ActionMap, opts: PlayerShieldOptions = {}): System {
    const raiseAction = opts.actionId ?? 'weapon.shield'
    return {
        fixed: true,
        order: FixedOrder.npcBehaviour - 1,
        update(world, dt) {
            const melee = (world as GameWorld).weaponStance === 'melee'
            const players = query(world, [PlayerControlled, Shield, Position, Rotation])
            const raising = actions.isHeld(raiseAction)
            const gw = world as GameWorld
            for (let i = 0; i < players.length; i++) {
                const eid = players[i]!
                const debugId = shieldDebugId(eid)
                const grounded = hasComponent(world, eid, Grounded)
                Shield.reloadSeconds[eid] = Math.max(0, Shield.reloadSeconds[eid]! - dt)
                if (!raising) Shield.heldSeconds[eid] = 0
                if (!melee || !grounded || hasComponent(world, eid, Stunned) || Shield.reloadSeconds[eid]! > 0) {
                    Shield.raised[eid] = 0
                    Shield.perfect[eid] = 0
                    gw.animControllerByEid.get(eid)?.machine.setParam(COMBAT_PARAM.shieldBlock, 0)
                    clearDebugHitbox(gw, debugId)
                    continue
                }
                Shield.raised[eid] = 1
                if (raising) {
                    Shield.heldSeconds[eid] += dt
                    Shield.perfect[eid] = Shield.heldSeconds[eid]! <= PERFECT_BLOCK_WINDOW_SECONDS ? 1 : 0
                    Shield.blockYawOffset[eid] = 0
                    Shield.blockArcCos[eid] = FRONT_ARC_COS
                } else {
                    Shield.perfect[eid] = 0
                    Shield.blockYawOffset[eid] = LEFT_YAW_OFFSET
                    Shield.blockArcCos[eid] = PASSIVE_ARC_COS
                }
                gw.animControllerByEid.get(eid)?.machine.setParam(COMBAT_PARAM.shieldBlock, raising ? 1 : 0)
                if (debugHitboxesEnabled()) {
                    pushDebugHitbox(gw, {
                        id: debugId,
                        kind: 'wedge',
                        ttl: 0.09,
                        color: raising ? [0.2, 0.88, 1.0] : [1.0, 0.78, 0.25],
                        origin: { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
                        yaw: Rotation.y[eid] + Shield.blockYawOffset[eid],
                        range: raising ? FRONT_BLOCK_RANGE : PASSIVE_BLOCK_RANGE,
                        arcRadians: Math.acos(Shield.blockArcCos[eid]) * 2,
                        minY: Shield.minY[eid],
                        maxY: Shield.maxY[eid],
                    })
                }
            }
        },
    }
}

function shieldDebugId(eid: number): string {
    return `player:${eid}:shield`
}

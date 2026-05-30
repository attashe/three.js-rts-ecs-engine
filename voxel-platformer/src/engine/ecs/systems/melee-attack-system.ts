// Player melee: on the Attack action, trigger the player's `attack` animation and
// apply a short forward-arc hit to nearby NPCs (light combat — NPCs are 1–2 HP;
// a lethal hit flags them to play `die` and despawn, handled by npc-render).

import { query } from 'bitecs'
import { PlayerControlled, Position, Rotation } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'

export interface MeleeAttackOptions {
    actionId?: ActionId
    /** Reach in world units (XZ). */
    range?: number
    /** Half-arc cosine threshold (`dot(forward, toTarget) ≥ this`). */
    arcCos?: number
    damage?: number
    /** Gate the swing (e.g. only when the melee weapon is drawn). */
    canUse?: (world: Parameters<System['update']>[0], player: number) => boolean
}

export function createMeleeAttackSystem(actions: ActionMap, opts: MeleeAttackOptions = {}): System {
    const actionId = opts.actionId ?? 'weapon.attack'
    const range = opts.range ?? 1.8
    const arcCos = opts.arcCos ?? 0.35
    const damage = opts.damage ?? 1

    return {
        fixed: true,
        order: FixedOrder.input + 25,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return
            const player = players[0]!
            if (opts.canUse && !opts.canUse(world, player)) return
            if (!actions.consumePressed(actionId, player)) return

            // Play the swing.
            world.animControllerByEid.get(player)?.machine.setParam('attack', 1)

            // Forward-arc hit against live NPCs.
            const yaw = Rotation.y[player]!
            const fx = Math.sin(yaw)
            const fz = Math.cos(yaw)
            const px = Position.x[player]!
            const pz = Position.z[player]!
            for (const npc of world.npcRuntimeById.values()) {
                if (npc.dying) continue
                const dx = npc.position.x - px
                const dz = npc.position.z - pz
                const dist = Math.hypot(dx, dz)
                if (dist > range || dist < 1e-3) continue
                if ((fx * dx + fz * dz) / dist < arcCos) continue
                npc.hp -= damage
                if (npc.hp <= 0) {
                    npc.requestDie = true
                    npc.dying = true
                }
            }
        },
    }
}

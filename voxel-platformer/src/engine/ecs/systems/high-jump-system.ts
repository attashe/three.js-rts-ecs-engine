import { hasComponent, query, removeComponent } from 'bitecs'
import { Grounded, PlayerControlled, Position, Velocity } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushLog } from '../world'

export interface HighJumpOptions {
    actionId?: ActionId
    jumpVelocity?: number
}

/**
 * High Jump: a strong upward impulse on the player while grounded. Useful for
 * reaching platforms a normal jump can't clear. Refuses to fire mid-air so it
 * isn't a free double-jump.
 *
 * The parent engine gated this on PlayerResources mana cost; the platformer
 * foundation has no resource layer, so the action map cooldown alone gates
 * use frequency.
 */
export function createHighJumpSystem(actions: ActionMap, opts: HighJumpOptions = {}): System {
    const actionId = opts.actionId ?? 'spell.highJump'
    const jumpVelocity = opts.jumpVelocity ?? 13.5

    return {
        fixed: true,
        order: FixedOrder.input + 10,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Velocity])
            if (players.length === 0) return

            const player = players[0]!
            if (!actions.consumePressed(actionId, player)) return

            if (!hasComponent(world, player, Grounded)) {
                pushLog(world, 'High Jump needs solid ground.')
                return
            }

            Velocity.y[player] = Math.max(Velocity.y[player], jumpVelocity)
            removeComponent(world, player, Grounded)
            pushLog(world, 'High Jump!')
        },
    }
}

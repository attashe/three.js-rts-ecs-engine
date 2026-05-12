import { hasComponent, query, removeComponent } from 'bitecs'
import { Grounded, PlayerControlled, PlayerResources, Position, Velocity } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'
import { activePlayerSpellCost } from '../../../game/items'

export interface HighJumpOptions {
    actionId?: ActionId
    jumpVelocity?: number
    canUse?: (world: Parameters<System['update']>[0], player: number) => boolean
    notify?: (message: string) => void
}

export function createHighJumpSystem(actions: ActionMap, opts: HighJumpOptions = {}): System {
    const actionId = opts.actionId ?? 'spell.highJump'
    const jumpVelocity = opts.jumpVelocity ?? 13.5

    return {
        fixed: true,
        order: FixedOrder.input + 10,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Velocity])
            if (players.length === 0) return

            const player = players[0]
            if (opts.canUse && !opts.canUse(world, player)) return
            if (!actions.consumePressed(actionId, player)) return

            if (!hasComponent(world, player, Grounded)) {
                const message = 'High Jump needs solid ground.'
                pushGameLog(world, { type: 'combat', message, eid: player })
                opts.notify?.(message)
                return
            }

            // Mana gate. See air-push-system for the same pattern — costs come
            // from the registry, PlayerResources is optional for test setups.
            const cost = activePlayerSpellCost(world)
            if (cost > 0 && hasComponent(world, player, PlayerResources)) {
                if (PlayerResources.mana[player] < cost) {
                    const message = 'Not enough mana for High Jump.'
                    pushGameLog(world, { type: 'combat', message, eid: player })
                    opts.notify?.(message)
                    return
                }
                PlayerResources.mana[player] -= cost
            }

            Velocity.y[player] = Math.max(Velocity.y[player], jumpVelocity)
            removeComponent(world, player, Grounded)
            const message = 'High Jump!'
            pushGameLog(world, { type: 'combat', message, eid: player })
            opts.notify?.(message)
        },
    }
}

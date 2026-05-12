import { hasComponent, query } from 'bitecs'
import { Health, PlayerControlled, PlayerResources, Position } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'
import { activePlayerSpellCost, activePlayerWeaponDef } from '../../../game/items'

export interface HealSpellOptions {
    actionId?: ActionId
    canUse?: (world: Parameters<System['update']>[0], player: number) => boolean
    notify?: (message: string) => void
}

/**
 * Active heal spell. Consumes the spell's mana cost from PlayerResources and
 * restores `spell.heal` health to the player, capped at maxHealth. Refuses to
 * fire when the player is already at full health (so the cast isn't wasted)
 * or when mana is below the cost.
 */
export function createHealSpellSystem(actions: ActionMap, opts: HealSpellOptions = {}): System {
    const actionId = opts.actionId ?? 'spell.heal'

    return {
        fixed: true,
        order: FixedOrder.input + 40,
        update(world) {
            const players = query(world, [PlayerControlled, Health, Position])
            if (players.length === 0) return
            const player = players[0]
            if (opts.canUse && !opts.canUse(world, player)) return
            if (!actions.consumePressed(actionId, player)) return

            const def = activePlayerWeaponDef(world)
            const heal = def?.spell?.heal ?? 0
            if (heal <= 0) return

            // Reject the cast (and refund the press notification) if the
            // player is already at full health — saves mana and avoids a
            // "Restore!" toast that did nothing visible.
            if (Health.current[player] >= Health.max[player]) {
                const message = 'Already at full health.'
                pushGameLog(world, { type: 'combat', message, eid: player })
                opts.notify?.(message)
                return
            }

            const cost = activePlayerSpellCost(world)
            if (cost > 0 && hasComponent(world, player, PlayerResources)) {
                if (PlayerResources.mana[player] < cost) {
                    const message = 'Not enough mana for Restore.'
                    pushGameLog(world, { type: 'combat', message, eid: player })
                    opts.notify?.(message)
                    return
                }
                PlayerResources.mana[player] -= cost
            }

            const before = Health.current[player]
            Health.current[player] = Math.min(Health.max[player], before + heal)
            const restored = Health.current[player] - before
            const message = `Restore: +${Math.round(restored)} HP.`
            pushGameLog(world, { type: 'combat', message, eid: player })
            opts.notify?.(message)
        },
    }
}

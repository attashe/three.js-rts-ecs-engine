import { query } from 'bitecs'
import { Interactable, InteractionRange, PlayerControlled, Position } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'

export interface InteractionSystemOptions {
    notify?: (message: string) => void
    actionId?: ActionId
}

export function createInteractionSystem(actions: ActionMap, opts: InteractionSystemOptions = {}): System {
    const actionId = opts.actionId ?? 'world.interact'
    return {
        fixed: true,
        order: FixedOrder.input,
        update(world) {
            const players = query(world, [PlayerControlled, Position])
            if (players.length === 0) return
            const player = players[0]
            if (!actions.consumePressed(actionId, player)) return
            const px = Position.x[player]
            const py = Position.y[player]
            const pz = Position.z[player]

            const targets = query(world, [Interactable, Position, InteractionRange])
            let best = -1
            let bestDistSq = Infinity
            for (let i = 0; i < targets.length; i++) {
                const eid = targets[i]
                const dx = Position.x[eid] - px
                const dy = Position.y[eid] - py
                const dz = Position.z[eid] - pz
                const distSq = dx * dx + dy * dy + dz * dz
                const range = InteractionRange.value[eid]
                if (distSq <= range * range && distSq < bestDistSq) {
                    best = eid
                    bestDistSq = distSq
                }
            }
            if (best < 0) {
                const message = 'Nothing close enough to interact with.'
                pushGameLog(world, { type: 'interaction', message })
                opts.notify?.(message)
                return
            }

            const state = world.interactionByEid.get(best)
            const message = state ? `${state.label}: ${state.message}` : 'You interact with it.'
            pushGameLog(world, { type: 'interaction', message, eid: best })
            opts.notify?.(message)
        },
    }
}

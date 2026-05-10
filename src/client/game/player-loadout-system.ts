import type { ActionMap } from '../engine/input/actions'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import { GameAction } from './actions'

const SELECT_ACTIONS = [
    GameAction.SelectWeapon1,
    GameAction.SelectWeapon2,
    GameAction.SelectWeapon3,
    GameAction.SelectWeapon4,
] as const

export function createPlayerLoadoutSystem(actions: ActionMap): System {
    return {
        fixed: true,
        order: FixedOrder.input - 20,
        update(world) {
            for (let i = 0; i < SELECT_ACTIONS.length; i++) {
                if (!actions.consumePressed(SELECT_ACTIONS[i], 'player-loadout')) continue
                if (!world.playerLoadout.weaponSlots[i]) continue
                world.playerLoadout.activeSlot = i
                return
            }
        },
    }
}

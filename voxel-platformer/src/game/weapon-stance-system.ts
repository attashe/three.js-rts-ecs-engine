// Weapon selector: toggles the player between melee (sword + shield) and ranged
// (bow) stances and swaps the in-hand loadout to match. The combat systems gate
// their action on the active stance (melee → swipe + hit, ranged → bow shot), so
// the attack you can perform — and the animation it plays — follows the weapon.

import { query } from 'bitecs'
import { PlayerControlled } from '../engine/ecs/components'
import type { ActionId, ActionMap } from '../engine/input/actions'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import { pushLog } from '../engine/ecs/world'
import { applyWeaponStance } from './player'

export interface WeaponStanceOptions {
    actionId?: ActionId
}

export function createWeaponStanceSystem(actions: ActionMap, opts: WeaponStanceOptions = {}): System {
    const actionId = opts.actionId ?? 'weapon.switch'
    return {
        fixed: true,
        // Before the launch (+20) and melee (+25) systems so a same-tick switch
        // takes effect immediately.
        order: FixedOrder.input + 10,
        update(world) {
            const players = query(world, [PlayerControlled])
            if (players.length === 0) return
            const player = players[0]!
            if (!actions.consumePressed(actionId, player)) return
            world.weaponStance = world.weaponStance === 'melee' ? 'ranged' : 'melee'
            applyWeaponStance(world, player, world.weaponStance)
            pushLog(world, world.weaponStance === 'melee' ? 'Drew sword & shield.' : 'Drew bow.')
        },
    }
}

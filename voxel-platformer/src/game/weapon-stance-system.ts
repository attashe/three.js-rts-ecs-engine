// Weapon selector: cycles the player between melee (sword + shield), ranged
// (bow), and magic (staff) stances and swaps the in-hand loadout to match. The
// universal attack (F) and the combat systems gate on the active stance
// (melee → swipe + hit, ranged → bow shot, magic → bolt), so the attack you can
// perform — and the animation it plays — follows the weapon. The Tab loadout
// menu can also set the stance directly.

import { query } from 'bitecs'
import { PlayerControlled } from '../engine/ecs/components'
import type { ActionId, ActionMap } from '../engine/input/actions'
import type { System } from '../engine/ecs/systems/system'
import { FixedOrder } from '../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type WeaponStance } from '../engine/ecs/world'
import { applyWeaponStance } from './player'
import { describeHandLoadout } from './anim/equipment-types'

/** Cycle order for the weapon-switch key. */
export const WEAPON_STANCE_CYCLE: readonly WeaponStance[] = ['melee', 'ranged', 'magic']

export function nextWeaponStance(stance: WeaponStance): WeaponStance {
    const i = WEAPON_STANCE_CYCLE.indexOf(stance)
    return WEAPON_STANCE_CYCLE[(i + 1) % WEAPON_STANCE_CYCLE.length]!
}

/** Set the player's stance and re-equip the matching loadout. Shared by the
 *  switch key and the Tab loadout menu. */
export function setWeaponStance(world: GameWorld, player: number, stance: WeaponStance): void {
    world.weaponStance = stance
    applyWeaponStance(world, player, stance)
    pushLog(world, `Drew ${describeHandLoadout(world.playerSettings.equipment[stance])}.`)
}

export interface WeaponStanceOptions {
    actionId?: ActionId
}

export function createWeaponStanceSystem(actions: ActionMap, opts: WeaponStanceOptions = {}): System {
    const actionId = opts.actionId ?? 'weapon.switch'
    return {
        fixed: true,
        // Before the launch (+20/+22) and melee (+25) systems so a same-tick
        // switch takes effect immediately.
        order: FixedOrder.input + 10,
        update(world) {
            const players = query(world, [PlayerControlled])
            if (players.length === 0) return
            const player = players[0]!
            if (!actions.consumePressed(actionId, player)) return
            setWeaponStance(world, player, nextWeaponStance(world.weaponStance))
        },
    }
}

// Plays the player's `die` animation when death is signalled. The death system
// sets `world.deathSignal`; restart-system reloads ~650ms later, so the `die`
// clip (~0.6s, clamped) reads in that window. Runs render-step, just before the
// animation tick that drives the controller.

import { query } from 'bitecs'
import { PlayerControlled } from '../../engine/ecs/components'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'

export function createPlayerDeathAnimSystem(): System {
    let triggered = false
    return {
        name: 'playerDeathAnim',
        order: RenderOrder.animation - 1,
        update(world) {
            // Re-arm once the death has cleared (restart spawns a fresh player).
            if (!world.deathSignal) { triggered = false; return }
            if (triggered) return
            const players = query(world, [PlayerControlled])
            if (players.length === 0) return
            // `dead` latches (not a trigger), so the die clip holds its last frame.
            world.animControllerByEid.get(players[0]!)?.machine.setParam('dead', 1)
            triggered = true
        },
    }
}

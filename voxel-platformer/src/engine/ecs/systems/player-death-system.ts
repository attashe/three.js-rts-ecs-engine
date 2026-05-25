import { query } from 'bitecs'
import { PlayerControlled, Position } from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushLog, type DeathReason, type GameWorld } from '../world'

export interface PlayerDeathSystemOptions {
    /** Players below this world-Y are considered to have fallen off the
     *  level and die. Default `-2` — below most demo / playtest terrain. */
    voidY?: number
    onDeath?: (reason: DeathReason) => void
}

/**
 * Watches every player entity for terminal conditions:
 *  - Falling below `voidY` (off the world).
 *
 * Sets `world.deathSignal` so `restart-system` can reload the level on the
 * render side. Bails out once the signal is set so the level doesn't churn
 * extra log lines while waiting for the reload.
 */
export function createPlayerDeathSystem(opts: PlayerDeathSystemOptions = {}): System {
    const voidY = opts.voidY ?? -2
    return {
        fixed: true,
        // After physics so we read the position physics resolved to this
        // tick (avoids signalling death from the pre-physics y).
        order: FixedOrder.postPhysics,
        update(world) {
            if ((world as GameWorld).deathSignal) return
            const eids = query(world, [Position, PlayerControlled])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]!
                if (Position.y[eid] < voidY) {
                    (world as GameWorld).deathSignal = 'fell-into-void'
                    pushLog(world as GameWorld, 'You fell into the void.')
                    opts.onDeath?.('fell-into-void')
                    return
                }
            }
        },
    }
}

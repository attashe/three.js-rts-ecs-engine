// Fires a one-shot "hurt" cue whenever the player's Health drops while still
// alive. Watching Health (rather than hooking each damage source) catches
// every cause — melee, arrows, hazards, spells, falling stones — in one
// place. The lethal blow is left to the death system (`current > 0` guard),
// and health gains (pickups, respawn) are ignored.

import { query } from 'bitecs'
import { Health, PlayerControlled } from '../components'
import type { GameWorld } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

export interface PlayerHurtAudioOptions {
    onHurt?: () => void
}

export function createPlayerHurtAudioSystem(opts: PlayerHurtAudioOptions = {}): System {
    let lastHealth: number | null = null
    return {
        fixed: true,
        order: FixedOrder.playerHurtAudio,
        update(world) {
            const players = query(world as GameWorld, [PlayerControlled, Health])
            if (players.length === 0) {
                lastHealth = null
                return
            }
            const current = Health.current[players[0]!]!
            if (lastHealth !== null && current < lastHealth && current > 0) {
                opts.onHurt?.()
            }
            lastHealth = current
        },
    }
}

import { query } from 'bitecs'
import { Pickup, PlayerControlled, Position } from '../components'
import { despawnEntity } from '../entity'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'

export interface PickupSystemOptions {
    radius?: number
    notify?: (message: string) => void
}

export function createPickupSystem(opts: PickupSystemOptions = {}): System {
    const radius = opts.radius ?? 0.75
    const radiusSq = radius * radius

    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world) {
            const players = query(world, [PlayerControlled, Position])
            if (players.length === 0) return
            const player = players[0]
            const px = Position.x[player]
            const py = Position.y[player]
            const pz = Position.z[player]

            const pickups = query(world, [Pickup, Position])
            for (let i = 0; i < pickups.length; i++) {
                const eid = pickups[i]
                const dx = Position.x[eid] - px
                const dy = Position.y[eid] - py
                const dz = Position.z[eid] - pz
                if (dx * dx + dy * dy + dz * dz > radiusSq) continue

                const state = world.pickupByEid.get(eid)
                const message = state?.message ?? 'Picked up an item.'
                pushGameLog(world, { type: 'pickup', message, eid })
                opts.notify?.(message)
                despawnEntity(world, eid)
            }
        },
    }
}

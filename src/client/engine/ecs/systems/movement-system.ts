import { query } from 'bitecs'
import { Position, Velocity } from '../components'
import type { System } from './system'

export const MovementSystem: System = {
    fixed: true,
    update(world, dt) {
        const eids = query(world, [Position, Velocity])
        for (let i = 0; i < eids.length; i++) {
            const eid = eids[i]
            Position.x[eid] += Velocity.x[eid] * dt
            Position.y[eid] += Velocity.y[eid] * dt
            Position.z[eid] += Velocity.z[eid] * dt
        }
    },
}

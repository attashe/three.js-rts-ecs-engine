import { query } from 'bitecs'
import { AngularVelocity, Rotation } from '../components'
import type { System } from './system'

export const SpinSystem: System = {
    fixed: true,
    update(world, dt) {
        const eids = query(world, [Rotation, AngularVelocity])
        for (let i = 0; i < eids.length; i++) {
            const eid = eids[i]
            Rotation.x[eid] += AngularVelocity.x[eid] * dt
            Rotation.y[eid] += AngularVelocity.y[eid] * dt
            Rotation.z[eid] += AngularVelocity.z[eid] * dt
        }
    },
}

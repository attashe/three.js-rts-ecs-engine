import { query } from 'bitecs'
import { MathUtils } from 'three'
import { PlayerControlled, Shield } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'

export interface ShieldSystemOptions {
    actionId?: ActionId
}

const LOWERED_POS = { x: -0.44, y: 0.68, z: 0.08 }
const RAISED_POS = { x: -0.34, y: 0.92, z: 0.38 }
const LOWERED_ROT = { x: 0.72, y: 0.12, z: -0.28 }
const RAISED_ROT = { x: 0, y: 0, z: -0.08 }
const VISUAL_LERP = 0.42

export function createShieldSystem(actions: ActionMap, opts: ShieldSystemOptions = {}): System {
    const actionId = opts.actionId ?? 'defense.shield'

    return {
        fixed: true,
        order: FixedOrder.input - 10,
        update(world) {
            const players = query(world, [PlayerControlled, Shield])
            if (players.length === 0) return

            const raised = actions.isHeld(actionId)
            for (let i = 0; i < players.length; i++) {
                const eid = players[i]
                Shield.raised[eid] = raised ? 1 : 0

                const root = world.object3DByEid.get(eid)
                const shield = root?.getObjectByName('PlayerShield')
                if (!shield) continue

                const pos = raised ? RAISED_POS : LOWERED_POS
                const rot = raised ? RAISED_ROT : LOWERED_ROT
                shield.position.x = MathUtils.lerp(shield.position.x, pos.x, VISUAL_LERP)
                shield.position.y = MathUtils.lerp(shield.position.y, pos.y, VISUAL_LERP)
                shield.position.z = MathUtils.lerp(shield.position.z, pos.z, VISUAL_LERP)
                shield.rotation.x = MathUtils.lerp(shield.rotation.x, rot.x, VISUAL_LERP)
                shield.rotation.y = MathUtils.lerp(shield.rotation.y, rot.y, VISUAL_LERP)
                shield.rotation.z = MathUtils.lerp(shield.rotation.z, rot.z, VISUAL_LERP)
            }
        },
    }
}

import { query } from 'bitecs'
import { PlayerControlled, Position, Rotation } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { spawnArrowProjectile } from '../../../game/moving-objects'

export interface ProjectileLaunchOptions {
    arrowSpeed?: number
    arrowLift?: number
    actionId?: ActionId
}

export function createProjectileLaunchSystem(actions: ActionMap, opts: ProjectileLaunchOptions = {}): System {
    const arrowSpeed = opts.arrowSpeed ?? 10.5
    const arrowLift = opts.arrowLift ?? 3.2
    const actionId = opts.actionId ?? 'weapon.bowShot'

    return {
        fixed: true,
        order: FixedOrder.input + 20,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return

            const player = players[0]
            if (!actions.consumePressed(actionId, player)) return
            const yaw = Rotation.y[player]
            const forwardX = Math.sin(yaw)
            const forwardZ = Math.cos(yaw)
            spawnArrowProjectile(
                world,
                {
                    x: Position.x[player] + forwardX * 0.55,
                    y: Position.y[player] + 1.05,
                    z: Position.z[player] + forwardZ * 0.55,
                },
                {
                    x: forwardX * arrowSpeed,
                    y: arrowLift,
                    z: forwardZ * arrowSpeed,
                },
            )
        },
    }
}

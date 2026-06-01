import { hasComponent, query } from 'bitecs'
import { Grounded, PlayerControlled, Position, Rotation, Stunned } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushLog } from '../world'
import { spawnArrowProjectile } from '../../../game/moving-objects'

export interface ProjectileLaunchOptions {
    arrowSpeed?: number
    arrowLift?: number
    actionId?: ActionId
    canUse?: (world: Parameters<System['update']>[0], player: number) => boolean
    onLaunch?: () => void
}

export function createProjectileLaunchSystem(actions: ActionMap, opts: ProjectileLaunchOptions = {}): System {
    const arrowSpeedOverride = opts.arrowSpeed
    const arrowLiftOverride = opts.arrowLift
    const actionId = opts.actionId ?? 'weapon.bowShot'

    return {
        fixed: true,
        order: FixedOrder.input + 20,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return

            const player = players[0]
            if (opts.canUse && !opts.canUse(world, player)) return
            if (hasComponent(world, player, Stunned)) return
            if (!hasComponent(world, player, Grounded)) return
            if (!actions.consumePressed(actionId, player)) return
            if (!world.playerSettings.abilities.bow) {
                pushLog(world, 'Bow is disabled.')
                return
            }
            if (world.inventory.arrows <= 0) {
                pushLog(world, 'No arrows.')
                return
            }
            world.inventory.arrows = Math.max(0, world.inventory.arrows - 1)
            world.playerSettings.inventory.arrows = world.inventory.arrows
            const yaw = Rotation.y[player]
            const forwardX = Math.sin(yaw)
            const forwardZ = Math.cos(yaw)
            const arrowSpeed = arrowSpeedOverride ?? world.playerSettings.arrowSpeed
            const arrowLift = arrowLiftOverride ?? world.playerSettings.arrowLift
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
            // Play the bow draw + release on the player's rig.
            world.animControllerByEid.get(player)?.machine.setParam('shoot', 1)
            pushLog(world, 'Arrow loosed.')
            opts.onLaunch?.()
        },
    }
}

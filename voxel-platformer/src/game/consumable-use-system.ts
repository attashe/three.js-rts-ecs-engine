import { hasComponent, query } from 'bitecs'
import { ClimbingLadder, Health, PlayerControlled, Position, Rotation, Stunned } from '../engine/ecs/components'
import type { ActionId, ActionMap } from '../engine/input/actions'
import { FixedOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import { pushLog } from '../engine/ecs/world'
import { spawnDynamiteProjectile } from './moving-objects'
import {
    CONSUMABLE_DEFS,
    DYNAMITE_ITEM_ID,
    consumeDirectConsumable,
    ensureSelectedConsumable,
    isThrowableConsumableItemId,
    syncConsumableInventory,
    updateDelayedConsumables,
} from './consumables'
import { inventoryItemCount, removeInventoryItem } from './inventory'

const DYNAMITE_THROW_SPEED = 6.25
const DYNAMITE_THROW_LIFT = 3.0

export interface ConsumableUseOptions {
    actionId?: ActionId
}

export function createConsumableUseSystem(actions: ActionMap, opts: ConsumableUseOptions = {}): System {
    const actionId = opts.actionId ?? 'consumable.use'

    return {
        name: 'consumableUse',
        fixed: true,
        order: FixedOrder.input + 25,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return
            const player = players[0]!
            if (!actions.consumePressed(actionId, player)) return
            if (hasComponent(world, player, Stunned)) {
                pushLog(world, 'Cannot use items while stunned.')
                return
            }
            if (hasComponent(world, player, Health) && Health.current[player]! <= 0) return

            const itemId = ensureSelectedConsumable(world)
            if (!itemId) {
                pushLog(world, 'No consumable selected.')
                return
            }
            const def = CONSUMABLE_DEFS[itemId]
            if (isThrowableConsumableItemId(itemId)) {
                if (hasComponent(world, player, ClimbingLadder)) {
                    pushLog(world, 'Cannot throw while climbing.')
                    return
                }
                throwDynamite(world, player)
                return
            }
            if (!consumeDirectConsumable(world, itemId)) {
                pushLog(world, `${def.name} cannot be used right now.`)
            }
        },
    }
}

export function createDelayedConsumableSystem(): System {
    return {
        name: 'delayedConsumables',
        fixed: true,
        order: FixedOrder.postPhysics + 15,
        update(world, dt) {
            updateDelayedConsumables(world, dt)
        },
    }
}

function throwDynamite(world: Parameters<System['update']>[0], player: number): boolean {
    if (inventoryItemCount(world.inventory.items, DYNAMITE_ITEM_ID) <= 0) {
        pushLog(world, 'No dynamite.')
        ensureSelectedConsumable(world)
        return false
    }
    if (!removeInventoryItem(world.inventory.items, DYNAMITE_ITEM_ID, 1)) return false
    syncConsumableInventory(world)
    const yaw = Rotation.y[player]
    const forwardX = Math.sin(yaw)
    const forwardZ = Math.cos(yaw)
    spawnDynamiteProjectile(
        world,
        {
            x: Position.x[player] + forwardX * 0.55,
            y: Position.y[player] + 1.0,
            z: Position.z[player] + forwardZ * 0.55,
        },
        {
            x: forwardX * DYNAMITE_THROW_SPEED,
            y: DYNAMITE_THROW_LIFT,
            z: forwardZ * DYNAMITE_THROW_SPEED,
        },
    )
    pushLog(world, 'Dynamite lit.')
    ensureSelectedConsumable(world)
    return true
}

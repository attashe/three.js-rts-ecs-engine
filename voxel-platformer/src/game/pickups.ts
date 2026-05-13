import { addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    Pickup,
    PickupValue,
    Position,
    Renderable,
    Rotation,
    StaticRenderable,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { PickupKind } from '../engine/ecs/systems/pickup-system'
import { createCoinPile, mergeGroupByMaterial } from './assets'

export interface CoinPileOptions {
    /** World-space position; the pile's base sits at this Y. */
    position: { x: number; y: number; z: number }
    /** Yaw in radians applied to the pile (purely visual). */
    yaw?: number
    /** Gold amount granted on collection. Default 12. */
    amount?: number
}

/**
 * Drop a collectable coin pile into the world. Picks up via the pickup-system
 * proximity check; on collection it adds `amount` to `world.inventory.gold`
 * and disposes the entity.
 */
export function spawnCoinPile(world: GameWorld, opts: CoinPileOptions): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, StaticRenderable, Pickup, PickupValue])
    Position.x[eid] = opts.position.x
    Position.y[eid] = opts.position.y
    Position.z[eid] = opts.position.z
    Rotation.y[eid] = opts.yaw ?? 0

    PickupValue.kind[eid] = PickupKind.Gold
    PickupValue.amount[eid] = opts.amount ?? 12

    world.object3DByEid.set(eid, mergeGroupByMaterial(createCoinPile()))
    return eid
}

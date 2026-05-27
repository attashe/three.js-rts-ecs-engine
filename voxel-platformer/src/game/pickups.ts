import { addComponents, hasComponent } from 'bitecs'
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
import { createCoinPile, createQuestShard, mergeGroupByMaterial } from './assets'

export interface CoinPileOptions {
    /** World-space position; the pile's base sits at this Y. */
    position: { x: number; y: number; z: number }
    /** Yaw in radians applied to the pile (purely visual). */
    yaw?: number
    /** Gold amount granted on collection. Default 12. */
    amount?: number
}

export interface ScriptPickupOptions {
    /** World-space position; the pickup's base sits at this Y. */
    position: { x: number; y: number; z: number }
    /** Script-facing kind, e.g. `coin`, `sun-shard`. */
    kind: string
    /** Stable script id. Reusing it returns the existing live pickup. */
    id?: string
    /** Stack amount for coin pickups. Ignored by custom quest items. */
    amount?: number
    /** Human-readable item name used in pickup log lines. */
    label?: string
}

let nextScriptPickupId = 1

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

export function spawnScriptPickup(world: GameWorld, opts: ScriptPickupOptions): string {
    const scriptId = opts.id ?? `pickup:${opts.kind}:${nextScriptPickupId++}`
    const existing = world.pickupEntityByScriptId.get(scriptId)
    if (existing !== undefined && hasComponent(world, existing, Pickup)) {
        return scriptId
    }
    if (existing !== undefined) world.pickupEntityByScriptId.delete(scriptId)

    const kind = normalizeScriptKind(opts.kind)
    const eid = kind === 'coin'
        ? spawnCoinPile(world, { position: opts.position, amount: opts.amount })
        : spawnQuestItem(world, opts.position)

    world.pickupMetaByEid.set(eid, {
        kind,
        pickupId: scriptId,
        label: opts.label ?? defaultPickupLabel(kind),
    })
    world.pickupEntityByScriptId.set(scriptId, eid)
    return scriptId
}

function spawnQuestItem(world: GameWorld, position: { x: number; y: number; z: number }): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, StaticRenderable, Pickup, PickupValue])
    Position.x[eid] = position.x
    Position.y[eid] = position.y
    Position.z[eid] = position.z
    Rotation.y[eid] = 0

    PickupValue.kind[eid] = PickupKind.ScriptItem
    PickupValue.amount[eid] = 1

    world.object3DByEid.set(eid, mergeGroupByMaterial(createQuestShard()))
    return eid
}

function normalizeScriptKind(kind: string): string {
    const trimmed = kind.trim()
    return trimmed.length > 0 ? trimmed : 'item'
}

function defaultPickupLabel(kind: string): string | undefined {
    if (kind === 'coin') return undefined
    if (kind === 'sun-shard') return 'Sun Shard'
    return kind
        .split(/[-_.\s]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

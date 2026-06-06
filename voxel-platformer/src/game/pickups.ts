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
import { createEntity, despawnEntity } from '../engine/ecs/entity'
import { PickupKind } from '../engine/ecs/systems/pickup-system'
import {
    createCoinPile,
    createDynamiteBundle,
    createFoodPickupProp,
    createHighJumpBootsProp,
    createQuestShard,
    createSpellbookPickupProp,
    createSword,
    mergeGroupByMaterial,
} from './assets'
import type { InventoryCategoryId, InventoryIconId } from './inventory'
import { BOOT_EQUIPMENT_ITEM_OPTIONS, isBootEquipmentItemId } from './high-jump-boots'
import {
    DYNAMITE_ITEM_ID,
    FOOD_APPLE_ITEM_ID,
    FOOD_FISH_ITEM_ID,
    FOOD_MEAT_ITEM_ID,
    FOOD_PIE_ITEM_ID,
} from './consumables'
import { SWORD_ITEM_ID } from './equipment-items'
import { ARCANE_BOLT_SPELLBOOK_PICKUP_KIND } from './spellbook'

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
    /** Stack amount for coin pickups, or durable item quantity for custom pickups. */
    amount?: number
    /** Human-readable item name used in pickup log lines. */
    label?: string
    /** Durable inventory item written when a custom pickup is collected.
     *  Omit to use `kind` as the item id and `label` as the item name. */
    inventoryItem?: {
        id?: string
        name?: string
        description?: string
        category?: InventoryCategoryId
        icon?: InventoryIconId
    }
    /** Defaults to true. False keeps the pickup script-only. */
    grantInventory?: boolean
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
    const coinAmount = opts.amount === undefined ? undefined : safePickupAmount(opts.amount)
    const itemAmount = safePickupAmount(opts.amount)
    const bootDefaults = isBootEquipmentItemId(kind) ? BOOT_EQUIPMENT_ITEM_OPTIONS[kind] : undefined
    const eid = kind === 'coin'
        ? spawnCoinPile(world, { position: opts.position, amount: coinAmount })
        : spawnQuestItem(world, opts.position, itemAmount, kind)

    world.pickupMetaByEid.set(eid, {
        kind,
        pickupId: scriptId,
        label: opts.label ?? defaultPickupLabel(kind),
        grantInventory: opts.grantInventory !== false,
        inventoryItem: kind === 'coin'
            ? undefined
            : opts.grantInventory === false
                ? undefined
            : {
                id: opts.inventoryItem?.id ?? kind,
                quantity: itemAmount,
                options: {
                    name: opts.inventoryItem?.name ?? opts.label ?? bootDefaults?.name ?? defaultPickupLabel(kind),
                    description: opts.inventoryItem?.description ?? bootDefaults?.description,
                    category: opts.inventoryItem?.category ?? bootDefaults?.category ?? 'quest',
                    icon: opts.inventoryItem?.icon ?? bootDefaults?.icon ?? 'quest-shard',
                },
            },
    })
    world.pickupEntityByScriptId.set(scriptId, eid)
    return scriptId
}

/** Remove a live script-spawned pickup by its stable id. Returns `true` if
 *  an entity was found and removed, `false` if no live pickup carries this
 *  id (already collected, never spawned, or a stale id). No `pickup-taken`
 *  event fires — despawn is a clean removal, distinct from player collection. */
export function despawnScriptPickup(world: GameWorld, scriptId: string): boolean {
    const eid = world.pickupEntityByScriptId.get(scriptId)
    if (eid === undefined) return false
    world.pickupEntityByScriptId.delete(scriptId)
    if (!hasComponent(world, eid, Pickup)) {
        // Map entry outlived the entity (e.g. pickup-system collected it
        // mid-frame). Treat as "nothing to remove" so authors get the
        // false signal a follow-up despawn deserves.
        world.pickupMetaByEid.delete(eid)
        return false
    }
    world.pickupMetaByEid.delete(eid)
    despawnEntity(world, eid)
    return true
}

/** True iff a script-spawned pickup with this id is currently live. Stale
 *  map entries (post-collection but pre-cleanup) are filtered out so the
 *  return value matches what `pickups.spawn(..., { id })` would re-spawn. */
export function scriptPickupExists(world: GameWorld, scriptId: string): boolean {
    const eid = world.pickupEntityByScriptId.get(scriptId)
    if (eid === undefined) return false
    return hasComponent(world, eid, Pickup)
}

function spawnQuestItem(
    world: GameWorld,
    position: { x: number; y: number; z: number },
    amount = 1,
    kind = 'item',
): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Renderable, StaticRenderable, Pickup, PickupValue])
    Position.x[eid] = position.x
    Position.y[eid] = position.y
    Position.z[eid] = position.z
    Rotation.y[eid] = 0

    PickupValue.kind[eid] = PickupKind.ScriptItem
    PickupValue.amount[eid] = safePickupAmount(amount)

    const visual = createPickupVisual(kind)
    world.object3DByEid.set(eid, kind === ARCANE_BOLT_SPELLBOOK_PICKUP_KIND
        ? mergeGroupByMaterial(visual, { preserveObjectNames: ['SpellbookSpin'] })
        : mergeGroupByMaterial(visual))
    return eid
}

function createPickupVisual(kind: string): ReturnType<typeof createQuestShard> {
    if (isBootEquipmentItemId(kind)) return createHighJumpBootsProp()
    if (kind === SWORD_ITEM_ID) {
        const sword = createSword({ bladeLength: 0.92, bladeWidth: 0.14, hiltLength: 0.28 })
        sword.name = 'SwordPickup'
        sword.scale.setScalar(0.72)
        sword.rotation.set(0, Math.PI * 0.18, Math.PI * 0.5)
        return sword
    }
    if (kind === DYNAMITE_ITEM_ID) return createDynamiteBundle()
    if (kind === FOOD_APPLE_ITEM_ID) return createFoodPickupProp('apple')
    if (kind === FOOD_FISH_ITEM_ID) return createFoodPickupProp('fish')
    if (kind === FOOD_PIE_ITEM_ID) return createFoodPickupProp('pie')
    if (kind === FOOD_MEAT_ITEM_ID) return createFoodPickupProp('meat')
    if (kind === ARCANE_BOLT_SPELLBOOK_PICKUP_KIND) return createSpellbookPickupProp()
    return createQuestShard()
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

function safePickupAmount(amount: unknown): number {
    const n = Number(amount)
    if (!Number.isFinite(n)) return 1
    return Math.max(1, Math.floor(n))
}

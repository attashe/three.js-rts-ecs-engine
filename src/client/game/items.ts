import type {
    GameWorld,
    PlayerArmorySlot,
    PlayerEquipmentSlot,
    PlayerInventory,
    PlayerInventoryItem,
    PlayerItemCategory,
    PlayerLoadoutSlotKind,
} from '../engine/ecs/world'
import { loadoutSlot } from '../engine/ecs/world'

/** Weight units removed from the player's move-speed multiplier per unit. */
export const WEIGHT_TO_SPEED_PENALTY = 0.025
/** Hard floor on the player move-speed multiplier so heavy kits stay playable. */
export const MIN_MOVE_SPEED_MULT = 0.6

export interface WeaponStats {
    /** Damage applied per strike or per projectile hit. */
    readonly damage: number
    /** Melee reach in world units. Only honoured by melee weapons. */
    readonly range?: number
    /** Melee swing arc in radians. Only honoured by melee weapons. */
    readonly arcRadians?: number
    /** Additional damage scaled by `speedFactor` on projectile hits. */
    readonly speedBonus?: number
    /** Per-action cooldown in milliseconds (0 = unlimited rate from the system). */
    readonly cooldownMs?: number
}

export interface ArmorStats {
    /** Flat damage reduction applied to incoming player damage. */
    readonly defense: number
    /** Cumulative weight; full set drives the player move-speed multiplier. */
    readonly weight: number
}

export interface SpellStats {
    /** Mana cost per cast. */
    readonly cost: number
    /** Cooldown in milliseconds between casts. */
    readonly cooldownMs: number
    /** Health restored on cast — used by heal-type spells. Distinct from
     *  ConsumableStats.heal (which fires on item use, not on cast). */
    readonly heal?: number
}

export interface ConsumableStats {
    /** Health restored when this item is used. */
    readonly heal?: number
    /** Mana restored when this item is used. */
    readonly restoreMana?: number
}

/**
 * Authored item record. Items in the world (`PlayerInventoryItem`) carry only
 * `id`/`count`-ish snapshot fields needed to render quickly; all the
 * gameplay-numeric stats live here keyed by item id. Adding a new weapon or
 * armor piece is a one-entry append, not a hunt across systems.
 */
export interface ItemDef {
    readonly id: string
    readonly label: string
    readonly icon: string
    readonly category: PlayerItemCategory
    readonly equipSlot?: PlayerEquipmentSlot
    readonly loadoutKind?: PlayerLoadoutSlotKind
    /** Stackable items can carry a `count` > 1 in a single backpack slot.
     *  Currency, ammo, and consumables stack; weapons, armor, and spells do
     *  not. `createInventoryItem` enforces this. */
    readonly stackable?: boolean
    readonly weapon?: WeaponStats
    readonly armor?: ArmorStats
    readonly spell?: SpellStats
    readonly consumable?: ConsumableStats
}

const ITEM_DEFS = new Map<string, ItemDef>()

function defineItem(def: ItemDef): ItemDef {
    if (ITEM_DEFS.has(def.id)) throw new Error(`Duplicate item id: ${def.id}`)
    ITEM_DEFS.set(def.id, def)
    return def
}

export function getItemDef(id: string): ItemDef | null {
    return ITEM_DEFS.get(id) ?? null
}

export function getAllItemDefs(): readonly ItemDef[] {
    return Array.from(ITEM_DEFS.values())
}

/**
 * Build a PlayerInventoryItem from the registry. Carries the def's display
 * fields plus optional `count` for stacking. Throws if the id is unknown so
 * we catch typos at the call site instead of populating dead slots.
 */
export function createInventoryItem(id: string, count?: number): PlayerInventoryItem {
    const def = ITEM_DEFS.get(id)
    if (!def) throw new Error(`Unknown item id: ${id}`)
    if (count !== undefined && count > 1 && !def.stackable) {
        throw new Error(`Item "${id}" is not stackable; count=${count} is not allowed`)
    }
    const item: PlayerInventoryItem = {
        id: def.id,
        category: def.category,
        label: def.label,
        icon: def.icon,
    }
    if (def.equipSlot !== undefined) item.equipSlot = def.equipSlot
    if (def.loadoutKind !== undefined) item.loadoutKind = def.loadoutKind
    // Carry `count` only for stackable items; otherwise it would show up as
    // a meaningless "1" badge next to single-instance gear in the HUD.
    if (count !== undefined && def.stackable) item.count = count
    return item
}

// ---- Weapons --------------------------------------------------------------

defineItem({
    id: 'training-sword',
    label: 'Sword',
    icon: 'SW',
    category: 'weapon',
    equipSlot: 'weapon',
    loadoutKind: 'sword',
    weapon: { damage: 25, range: 1.35, arcRadians: Math.PI * 0.65 },
})

defineItem({
    id: 'iron-sword',
    label: 'Iron sword',
    icon: 'SW',
    category: 'weapon',
    equipSlot: 'weapon',
    loadoutKind: 'sword',
    weapon: { damage: 38, range: 1.4, arcRadians: Math.PI * 0.7 },
})

defineItem({
    id: 'spare-sword',
    label: 'Spare sword',
    icon: 'SW',
    category: 'weapon',
    equipSlot: 'weapon',
    loadoutKind: 'sword',
    weapon: { damage: 18, range: 1.3, arcRadians: Math.PI * 0.6 },
})

defineItem({
    id: 'hunter-bow',
    label: 'Bow',
    icon: 'BW',
    category: 'weapon',
    equipSlot: 'weapon',
    loadoutKind: 'bow',
    weapon: { damage: 18, speedBonus: 6 },
})

defineItem({
    id: 'practice-bow',
    label: 'Practice bow',
    icon: 'BW',
    category: 'weapon',
    equipSlot: 'weapon',
    loadoutKind: 'bow',
    weapon: { damage: 12, speedBonus: 4 },
})

// ---- Spells ---------------------------------------------------------------
// Spell stats are recorded here so the mana/cooldown rework (track D) can
// read them without another sweep. The combat behaviour of Air Push / High
// Jump remains driven by their respective systems for now.

defineItem({
    id: 'air-push',
    label: 'Air Push',
    icon: 'AP',
    category: 'spell',
    equipSlot: 'weapon',
    loadoutKind: 'airPush',
    spell: { cost: 20, cooldownMs: 1500 },
})

defineItem({
    id: 'high-jump',
    label: 'High Jump',
    icon: 'HJ',
    category: 'spell',
    equipSlot: 'weapon',
    loadoutKind: 'highJump',
    spell: { cost: 12, cooldownMs: 800 },
})

defineItem({
    id: 'restore',
    label: 'Restore',
    icon: 'RS',
    category: 'spell',
    equipSlot: 'weapon',
    loadoutKind: 'heal',
    spell: { cost: 25, cooldownMs: 2000, heal: 30 },
})

// ---- Armor ----------------------------------------------------------------

defineItem({
    id: 'tunic',
    label: 'Tunic',
    icon: 'CH',
    category: 'armor',
    equipSlot: 'chest',
    armor: { defense: 3, weight: 2 },
})

defineItem({
    id: 'iron-helm',
    label: 'Iron helm',
    icon: 'HD',
    category: 'armor',
    equipSlot: 'head',
    armor: { defense: 2, weight: 1.5 },
})

defineItem({
    id: 'gloves',
    label: 'Gloves',
    icon: 'HN',
    category: 'armor',
    equipSlot: 'hands',
    armor: { defense: 1, weight: 0.5 },
})

defineItem({
    id: 'boots',
    label: 'Boots',
    icon: 'BT',
    category: 'armor',
    equipSlot: 'boots',
    armor: { defense: 1, weight: 0.8 },
})

defineItem({
    id: 'round-shield',
    label: 'Round shield',
    icon: 'SH',
    category: 'armor',
    equipSlot: 'shield',
    armor: { defense: 2, weight: 1.5 },
})

defineItem({
    id: 'wind-charm',
    label: 'Wind charm',
    icon: 'CR',
    category: 'armor',
    equipSlot: 'charm',
    // Charm pieces have no defense but also no weight — pure flavour for now.
    armor: { defense: 0, weight: 0 },
})

// ---- Consumables / currency / ammo ----------------------------------------

defineItem({
    id: 'health-potion',
    label: 'Potion',
    icon: '+',
    category: 'consumable',
    stackable: true,
    consumable: { heal: 25 },
})

defineItem({
    id: 'arrows',
    label: 'Arrows',
    icon: 'AR',
    category: 'ammo',
    stackable: true,
})

defineItem({
    id: 'gold',
    label: 'Gold',
    icon: 'G',
    category: 'currency',
    stackable: true,
})

// ---- Loadout seeding + derived stats --------------------------------------

const DEFAULT_BACKPACK = [
    () => createInventoryItem('health-potion', 2),
    () => createInventoryItem('arrows', 12),
    () => createInventoryItem('iron-helm'),
    () => createInventoryItem('wind-charm'),
    () => createInventoryItem('spare-sword'),
    () => createInventoryItem('practice-bow'),
]

const DEFAULT_ARMORY: Array<{ slot: PlayerEquipmentSlot; label: string; icon: string; itemId?: string }> = [
    { slot: 'head', label: 'Head', icon: 'HD' },
    { slot: 'chest', label: 'Chest', icon: 'CH', itemId: 'tunic' },
    { slot: 'hands', label: 'Hands', icon: 'HN', itemId: 'gloves' },
    { slot: 'boots', label: 'Boots', icon: 'BT', itemId: 'boots' },
    { slot: 'shield', label: 'Shield', icon: 'SH', itemId: 'round-shield' },
    { slot: 'charm', label: 'Charm', icon: 'CR' },
]

/**
 * Replace the world's loadout in place with the default starting kit. Called
 * by spawnPlayer; idempotent. After mutating the loadout you must call
 * `recomputePlayerStats(world)` to refresh the cached defense / weight.
 */
export function populateDefaultPlayerLoadout(world: GameWorld): void {
    const loadout = world.playerLoadout
    loadout.activeSlot = 0
    loadout.weaponSlots = [
        loadoutSlot(createInventoryItem('training-sword')),
        loadoutSlot(createInventoryItem('hunter-bow')),
        loadoutSlot(createInventoryItem('air-push')),
        loadoutSlot(createInventoryItem('high-jump')),
    ]
    loadout.armorySlots = DEFAULT_ARMORY.map<PlayerArmorySlot>((entry) => ({
        slot: entry.slot,
        label: entry.label,
        icon: entry.icon,
        item: entry.itemId ? createInventoryItem(entry.itemId) : null,
    }))
    const seeded = DEFAULT_BACKPACK.map((factory) => factory())
    loadout.backpackSlots = [
        ...seeded,
        ...Array.from({ length: Math.max(0, 24 - seeded.length) }, () => null),
    ]
    loadout.spellSlots = [
        createInventoryItem('air-push'),
        createInventoryItem('high-jump'),
        createInventoryItem('restore'),
    ]
    recomputePlayerStats(world)
}

/**
 * Refresh `world.playerStats` from the currently equipped armor. Should be
 * called after every loadout mutation that swaps an armory slot — pickups,
 * UI swaps, and drops.
 */
export function recomputePlayerStats(world: GameWorld): void {
    let defense = 0
    let weight = 0
    for (const slot of world.playerLoadout.armorySlots) {
        if (!slot.item) continue
        const def = ITEM_DEFS.get(slot.item.id)
        if (!def?.armor) continue
        defense += def.armor.defense
        weight += def.armor.weight
    }
    world.playerStats.defense = defense
    world.playerStats.weight = weight
    world.playerStats.moveSpeedMult = Math.max(MIN_MOVE_SPEED_MULT, 1 - weight * WEIGHT_TO_SPEED_PENALTY)
}

/**
 * Sum stacked counts in the backpack for the three displayable currencies/
 * consumables. Backpack stacks are the single source of truth now; the HUD
 * derives this snapshot every frame instead of reading a duplicate counter.
 */
export function aggregateInventoryCounts(world: GameWorld): PlayerInventory {
    let gold = 0
    let potions = 0
    let arrows = 0
    for (const slot of world.playerLoadout.backpackSlots) {
        if (!slot) continue
        const count = slot.count ?? 1
        if (slot.id === 'gold') gold += count
        else if (slot.id === 'health-potion') potions += count
        else if (slot.id === 'arrows') arrows += count
    }
    return { gold, potions, arrows }
}

/**
 * Look up the def of the player's currently active loadout slot. Returns
 * `null` if the slot is empty or holds an item not in the registry (e.g. a
 * test-only item).
 */
export function activePlayerWeaponDef(world: GameWorld): ItemDef | null {
    const slot = world.playerLoadout.weaponSlots[world.playerLoadout.activeSlot]
    if (!slot?.item) return null
    return ITEM_DEFS.get(slot.item.id) ?? null
}

/**
 * Mana cost of the active spell, or 0 if the active slot isn't a spell.
 * Spell systems debit this from `PlayerResources.mana` at cast time.
 */
export function activePlayerSpellCost(world: GameWorld): number {
    return activePlayerWeaponDef(world)?.spell?.cost ?? 0
}

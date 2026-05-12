import { createWorld, type World } from 'bitecs'
import type { Object3D, Vector3 } from 'three'
import { ObstacleRegistry } from './obstacle-registry'
import type { ActorBlackboard } from './behaviour'
import type { AiSchedule, AiScheduleAssignment, AiZone } from './ai'
import { EngineMetrics } from '../metrics'

export interface VoxelCoord {
    x: number
    y: number
    z: number
}

export interface PathState {
    /** World-space waypoints, including the start (index 0). */
    points: Vector3[]
    /** Index of the next waypoint to walk toward. */
    index: number
    /** World-units per second. */
    speed: number
    /** Seconds spent blocked while trying to follow this path. */
    blockedTime?: number
    /** Number of local waypoint skips already tried for the current path. */
    blockedSkips?: number
}

export interface InteractionState {
    label: string
    message: string
}

export interface PickupState {
    label: string
    message: string
    item?: PlayerInventoryItem
}

/**
 * Aggregated counts of stackable consumables, surfaced by the HUD. This is
 * no longer a stored field on the world — it's derived from the backpack on
 * demand by `aggregateInventoryCounts` in game/items.ts. Kept as a type so
 * HUD code and the UI layer can share the shape.
 */
export interface PlayerInventory {
    gold: number
    potions: number
    arrows: number
}

export type PlayerLoadoutSlotKind = 'sword' | 'bow' | 'airPush' | 'highJump' | 'heal' | 'empty'
export type PlayerItemCategory = 'weapon' | 'armor' | 'spell' | 'consumable' | 'currency' | 'ammo'
export type PlayerEquipmentSlot = 'weapon' | 'head' | 'chest' | 'hands' | 'boots' | 'shield' | 'charm'

export interface PlayerInventoryItem {
    id: string
    category: PlayerItemCategory
    label: string
    icon: string
    count?: number
    equipSlot?: PlayerEquipmentSlot
    loadoutKind?: PlayerLoadoutSlotKind
}

export interface PlayerLoadoutSlot {
    kind: PlayerLoadoutSlotKind
    label: string
    icon: string
    item?: PlayerInventoryItem
}

export interface PlayerArmorySlot {
    slot: PlayerEquipmentSlot
    label: string
    icon: string
    item: PlayerInventoryItem | null
}

export interface PlayerLoadout {
    activeSlot: number
    weaponSlots: PlayerLoadoutSlot[]
    armorySlots: PlayerArmorySlot[]
    backpackSlots: Array<PlayerInventoryItem | null>
    spellSlots: PlayerInventoryItem[]
}

/**
 * Cached aggregate of the player's equipped armor. Recomputed by
 * `recomputePlayerStats` (game/items.ts) whenever the loadout mutates so
 * combat and movement systems can read the totals in O(1) instead of
 * walking the armory each tick.
 */
export interface PlayerStats {
    defense: number
    weight: number
    /** Movement speed multiplier, in (0, 1]. 1.0 = unarmored baseline. */
    moveSpeedMult: number
}

export interface DoorBlock {
    pos: VoxelCoord
    block: number
}

export interface DoorMechanism {
    kind: 'door'
    blocks: DoorBlock[]
    open: boolean
}

export interface PistonMechanism {
    kind: 'piston'
    from: VoxelCoord
    to: VoxelCoord
    block: number
    occupied: 'from' | 'to'
    interval: number
    timer: number
    characterPolicy: 'block' | 'push'
}

export type VoxelMechanism = DoorMechanism | PistonMechanism

export interface GameLogEntry {
    time: number
    type: 'interaction' | 'pickup' | 'combat' | 'path'
    message: string
    eid?: number
}

/** Emitted by physics-system when a body's downward sweep was hard-blocked.
 *  Drained each fixed step by impact-system. */
export interface ImpactEvent {
    eid: number
    /** Inbound speed along the ground normal (m/s, always positive). */
    speed: number
    /** Body mass at the moment of impact. */
    mass: number
    /** Body position (foot-anchored) at the moment of impact. */
    x: number
    y: number
    z: number
}

// Side-tables. bitecs components hold only numeric data; anything that's a
// reference type (Object3D, path arrays, palette indices for level metadata)
// lives here keyed by entity id.
export interface GameContext {
    metrics: EngineMetrics
    object3DByEid: Map<number, Object3D>
    pathByEid: Map<number, PathState>
    behaviourByEid: Map<number, ActorBlackboard>
    aiZones: Map<string, AiZone>
    aiSchedules: Map<string, AiSchedule>
    aiScheduleByEid: Map<number, AiScheduleAssignment>
    hostilityByEid: Map<number, Set<number>>
    projectileOwnerByEid: Map<number, number>
    interactionByEid: Map<number, InteractionState>
    pickupByEid: Map<number, PickupState>
    playerLoadout: PlayerLoadout
    playerStats: PlayerStats
    mechanismByEid: Map<number, VoxelMechanism>
    voxelMechanisms: VoxelMechanism[]
    log: GameLogEntry[]
    /** Per-frame queue of high-energy impacts produced by physics-system. */
    impactEvents: ImpactEvent[]
    /** AABBs of settled rigid bodies the voxel-sweep treats as solid. */
    obstacles: ObstacleRegistry
}

export type GameWorld = World<GameContext>

export function createGameWorld(): GameWorld {
    return createWorld<GameContext>({
        metrics: new EngineMetrics(),
        object3DByEid: new Map<number, Object3D>(),
        pathByEid: new Map<number, PathState>(),
        behaviourByEid: new Map<number, ActorBlackboard>(),
        aiZones: new Map<string, AiZone>(),
        aiSchedules: new Map<string, AiSchedule>(),
        aiScheduleByEid: new Map<number, AiScheduleAssignment>(),
        hostilityByEid: new Map<number, Set<number>>(),
        projectileOwnerByEid: new Map<number, number>(),
        interactionByEid: new Map<number, InteractionState>(),
        pickupByEid: new Map<number, PickupState>(),
        playerLoadout: createEmptyPlayerLoadout(),
        playerStats: { defense: 0, weight: 0, moveSpeedMult: 1 },
        mechanismByEid: new Map<number, VoxelMechanism>(),
        voxelMechanisms: [],
        log: [],
        impactEvents: [],
        obstacles: new ObstacleRegistry(),
    })
}

/**
 * World-side bootstrap: the loadout is created empty so the world module
 * doesn't have to import the item registry. `game/items.populateDefault
 * PlayerLoadout(world)` fills it with the starting kit during spawnPlayer.
 */
export function createEmptyPlayerLoadout(): PlayerLoadout {
    return {
        activeSlot: 0,
        weaponSlots: [
            { kind: 'empty', label: 'Empty', icon: '.' },
            { kind: 'empty', label: 'Empty', icon: '.' },
            { kind: 'empty', label: 'Empty', icon: '.' },
            { kind: 'empty', label: 'Empty', icon: '.' },
        ],
        armorySlots: [
            { slot: 'head', label: 'Head', icon: 'HD', item: null },
            { slot: 'chest', label: 'Chest', icon: 'CH', item: null },
            { slot: 'hands', label: 'Hands', icon: 'HN', item: null },
            { slot: 'boots', label: 'Boots', icon: 'BT', item: null },
            { slot: 'shield', label: 'Shield', icon: 'SH', item: null },
            { slot: 'charm', label: 'Charm', icon: 'CR', item: null },
        ],
        backpackSlots: Array.from({ length: 24 }, () => null),
        spellSlots: [],
    }
}

export function activePlayerLoadoutKind(world: GameWorld): PlayerLoadoutSlotKind {
    return world.playerLoadout.weaponSlots[world.playerLoadout.activeSlot]?.kind ?? 'empty'
}

export function addItemToBackpack(world: GameWorld, itemToAdd: PlayerInventoryItem): boolean {
    const slots = world.playerLoadout.backpackSlots
    const stack = itemToAdd.count !== undefined
        ? slots.find((slot) => slot?.id === itemToAdd.id)
        : undefined
    if (stack) {
        stack.count = (stack.count ?? 1) + (itemToAdd.count ?? 1)
        return true
    }

    const index = slots.findIndex((slot) => slot === null)
    if (index < 0) return false
    slots[index] = { ...itemToAdd }
    return true
}

export function loadoutSlot(itemToEquip: PlayerInventoryItem | null): PlayerLoadoutSlot {
    if (!itemToEquip?.loadoutKind) return { kind: 'empty', label: 'Empty', icon: '.' }
    return {
        kind: itemToEquip.loadoutKind,
        label: itemToEquip.label,
        icon: itemToEquip.icon,
        item: { ...itemToEquip },
    }
}

export function pushGameLog(world: GameWorld, entry: Omit<GameLogEntry, 'time'>): void {
    world.log.push({ ...entry, time: performance.now() })
    if (world.log.length > 64) world.log.splice(0, world.log.length - 64)
}

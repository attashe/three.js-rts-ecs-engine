import { createWorld, type World } from 'bitecs'
import type { Object3D } from 'three'
import { ObstacleRegistry } from './obstacle-registry'
import { EngineMetrics } from '../metrics'
import type { Zone, ZoneTriggerEvent, ZoneTriggerSource } from './zones'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../../game/player-settings'

export interface VoxelCoord {
    x: number
    y: number
    z: number
}

/** Aggregated counts of collected pickups. Pickup-system increments these;
 *  consumers (debug overlay, eventual HUD) read them. */
export interface PickupInventory {
    gold: number
    arrows: number
}

export interface PickupScriptMeta {
    /** Script-facing pickup kind, e.g. `coin`, `arrow`, `sun-shard`. */
    kind: string
    /** Stable author id. Lets scripts filter `pickup-taken` by `pickupId`. */
    pickupId?: string
    /** Human-readable item name for pickup log lines. */
    label?: string
}

export interface PopupMessage {
    id: number
    targetId: string
    message: string
    seconds: number
}

export interface PopupClearRequest {
    id: number
    /** When null, drain bubbles for every target. */
    targetId: string | null
}

/**
 * A voxel-shaped block that teleports between two cells on a fixed timer.
 * Used for moving platforms / stepping stones. Driven by piston-system.
 *
 * Scheduling is absolute — `nextFlipAt` is a simulation-time stamp, not a
 * countdown. After a successful flip the system does
 * `nextFlipAt += delay` (monotonic), which keeps every piston created in
 * the same tick locked to the same global delay grid even when some
 * individual flips run a tick or two late because they were blocked.
 */
export interface PistonMechanism {
    /** Stable author id (`'piston.elevator'`, `'piston-3'`, ...). Optional —
     *  pistons without an id are still simulated but are invisible to
     *  scripts (no entry in `pistonsById`, `pistons.list()` skips them). */
    id?: string
    /** Runtime gate honoured by piston-system. `false` freezes the piston
     *  in place: teleport pistons skip the next flip attempt; physical
     *  pistons stop their motion update. Voxel + obstacle state stays
     *  consistent because teleport writes are atomic via `applyBulk` and
     *  physical pistons keep their AABB in the obstacle registry.
     *  Session-only — not persisted in the level binary. */
    enabled: boolean
    /** Script-driven "fire on the next tick" request. Set by
     *  `pistons.flip(id)`; the piston-system consumes it next update. */
    pendingFlip: boolean
    from: VoxelCoord
    to: VoxelCoord
    /** Palette index placed at the currently-occupied cell. */
    block: number
    /** Teleport pistons rewrite voxels at endpoints; physical pistons are
     *  renderable/collidable block entities that move continuously between
     *  endpoints. Missing field defaults to `'teleport'` for old saves. */
    motion: 'teleport' | 'physical'
    /** Which side currently holds the block. */
    occupied: 'from' | 'to'
    /** Seconds spent waiting at each endpoint before moving/flipping.
     *  0 means start the next move as soon as the previous one finishes. */
    delay: number
    /** Seconds spent travelling between endpoints for physical pistons. */
    travelTime: number
    /** Absolute sim-time of the next flip attempt. */
    nextFlipAt: number
    /** Physical-piston entity id. `-1` for teleport pistons. */
    eid: number
    /** Physical-piston movement state. */
    moving: 0 | 1
    /** Normalized [0, 1] travel progress for the active physical move. */
    moveT: number
    /** Endpoint occupied before the active physical move started. */
    moveFrom: 'from' | 'to'
    /**
     * What to do when a character is standing in the target cell at flip time.
     * - `block`: don't flip until the cell is clear (hazard / locked door
     *   style).
     * - `push`: nudge the character along the flip direction so the block
     *   can take its spot. Good for elevator-style platforms that should
     *   carry the player. For *downward* pistons, a failed push (player
     *   crushed against a floor) signals death instead of refusing the
     *   flip — see `player-death-system`.
     */
    characterPolicy: 'block' | 'push'
    /** Asset id played on each flip via the piston-system's `onFlip`
     *  callback. Undefined or empty string ⇒ no flip sound. */
    moveSoundId?: string
    /** Per-piston gain multiplier for the move sound. Defaults to 1. */
    moveSoundVolume?: number
}

export interface StoneSpawnerRuntime {
    id: string
    setEnabled(enabled: boolean): void
    isEnabled(): boolean
    /** Spawn immediately, bypassing the timer but still honoring enabled
     *  state and live-count caps. Returns the number actually spawned. */
    trigger(count?: number): number
}

/** Why the level should restart. Set by gameplay systems; consumed by
 *  `restart-system` which calls `location.reload()`. */
export type DeathReason =
    | 'fell-into-void'
    | 'crushed-by-piston'
    | 'manual-restart'
    | 'killed-by-zone-script'
    | 'burned-by-lava'

const MAX_LOG_ENTRIES = 12
const MAX_ZONE_EVENTS = 64

// Side-tables. bitecs components hold only numeric data; anything that's a
// reference type (Object3D, registry side tables) lives here keyed by entity id.
export interface GameContext {
    metrics: EngineMetrics
    object3DByEid: Map<number, Object3D>
    /** AABBs of settled rigid bodies the voxel-sweep treats as solid. */
    obstacles: ObstacleRegistry
    inventory: PickupInventory
    /** Optional script-facing metadata for pickup entities. ECS components
     *  keep only numeric kind/amount; this side table carries author ids and
     *  custom item names for script-driven quests. */
    pickupMetaByEid: Map<number, PickupScriptMeta>
    /** Stable script id -> live pickup entity. Used by `pickups.spawn` to make
     *  quest item spawning idempotent across script Apply / level-start runs. */
    pickupEntityByScriptId: Map<string, number>
    /** Active piston mechanisms — voxel-toggling moving platforms. */
    pistons: PistonMechanism[]
    /** Stable script id -> live piston. Populated by `registerPistonMechanism`
     *  when the config carries `id`. Used by the `pistons.*` script bindings
     *  for O(1) lookup. Pistons without an id never appear here. */
    pistonsById: Map<string, PistonMechanism>
    /** Stable script id -> live physics stone entity. Used by `stones.spawn`
     *  to make scripted/direct stones idempotent and removable. */
    stoneEntityByScriptId: Map<string, number>
    /** Stable editor/script id -> live falling-stone spawner controller. */
    stoneSpawnersById: Map<string, StoneSpawnerRuntime>
    /** Named AABB regions placed by the editor (or seeded by `level.ts`).
     *  Gameplay can query these via `isPointInZone` / `findZoneAtPoint`. */
    zones: Map<string, Zone>
    /** Trigger activations emitted by zone-trigger-system. Consumers may read
     *  and drain this array in insertion order. Capped to the most recent
     *  `MAX_ZONE_EVENTS` entries via `pushZoneEvent` so it can't grow
     *  unbounded if no consumer is wired up. */
    zoneEvents: ZoneTriggerEvent[]
    /** Capped ring of recent gameplay messages — pickup notifications, spell
     *  casts, etc. Rendered by debug-overlay-system. */
    log: string[]
    /** Short world-anchored UI messages, usually script-authored NPC lines. */
    popupMessages: PopupMessage[]
    nextPopupMessageId: number
    /** Pending `ui.clear(targetId?)` requests. Consumers drain by id and
     *  drop active bubbles whose `targetId` matches (or all bubbles when
     *  `targetId === null`). Lets scripts dismiss popups early without
     *  having to wait for the `seconds` timer to expire. */
    popupClears: PopupClearRequest[]
    nextPopupClearId: number
    /** Mutable runtime player defaults/current settings. Level metadata
     *  seeds this before spawn; scripts may patch it while the level runs. */
    playerSettings: PlayerSettings
    /** When non-null, the level should restart. `restart-system` reads
     *  this each render frame and triggers a page reload. */
    deathSignal: DeathReason | null
    /** Last script-set respawn point. Used by the script API
     *  `player.checkpoint` getter and read at client startup (after a
     *  death-triggered reload) to override `meta.spawn`. Mirrored to
     *  a session-scoped store so the value survives `location.reload()`. */
    lastCheckpoint: VoxelCoord | null
    /** Queue of trigger events for the script engine to drain each
     *  fixed tick. Producer systems (zone trigger, pickup, death) push
     *  events here; `script-engine-system` consumes + emits via
     *  `runtime.emit(...)`. Unlike `zoneEvents` (a capped history),
     *  this is an *unbounded queue that's expected to be drained every
     *  tick* — if no script engine is registered, events accumulate
     *  briefly but the script engine is always registered alongside
     *  the producers in production.
     *
     *  See `voxel-platformer/docs/script-engine.md` §3.1 for the
     *  built-in event taxonomy these correspond to. */
    scriptTriggerEvents: ScriptTriggerEvent[]
}

/** Tagged union of trigger events the script engine dispatches. Each
 *  variant corresponds to one of the built-in event names in §3.1 of
 *  the design doc — the script engine maps `kind` → name when emitting. */
export type ScriptTriggerEvent =
    | {
        kind: 'zone-enter' | 'zone-exit'
        zoneId: string
        source: ZoneTriggerSource
        point: VoxelCoord
        entityId: number
    }
    | {
        kind: 'pickup-taken'
        /** Script-facing pickup kind: `coin`, `arrow`, or a custom item kind. */
        pickupKind: string
        /** Stable author id when the pickup was spawned with one. */
        pickupId?: string
        amount: number
        position: VoxelCoord
        entityId: number
    }
    | {
        kind: 'player.died'
        reason: DeathReason
    }
    | {
        kind: 'input'
        action: string
        edge: 'pressed' | 'held' | 'released'
        targetId?: string
        zoneId?: string
        point?: VoxelCoord
        entityId?: number
    }

export type GameWorld = World<GameContext>

export function createGameWorld(): GameWorld {
    return createWorld<GameContext>({
        metrics: new EngineMetrics(),
        object3DByEid: new Map<number, Object3D>(),
        obstacles: new ObstacleRegistry(),
        inventory: { gold: 0, arrows: 0 },
        pickupMetaByEid: new Map<number, PickupScriptMeta>(),
        pickupEntityByScriptId: new Map<string, number>(),
        pistons: [],
        pistonsById: new Map<string, PistonMechanism>(),
        stoneEntityByScriptId: new Map<string, number>(),
        stoneSpawnersById: new Map<string, StoneSpawnerRuntime>(),
        zones: new Map<string, Zone>(),
        zoneEvents: [],
        log: [],
        popupMessages: [],
        nextPopupMessageId: 1,
        popupClears: [],
        nextPopupClearId: 1,
        playerSettings: copyPlayerSettings(DEFAULT_PLAYER_SETTINGS),
        deathSignal: null,
        lastCheckpoint: null,
        scriptTriggerEvents: [],
    })
}

/** Append a one-line debug/log message, evicting oldest entries past the cap. */
export function pushLog(world: GameWorld, message: string): void {
    world.log.push(message)
    if (world.log.length > MAX_LOG_ENTRIES) {
        world.log.splice(0, world.log.length - MAX_LOG_ENTRIES)
    }
}

export function pushPopupMessage(
    world: GameWorld,
    message: Omit<PopupMessage, 'id' | 'seconds'> & { seconds?: number },
): void {
    const text = message.message.trim()
    if (!text) return
    world.popupMessages.push({
        id: world.nextPopupMessageId++,
        targetId: message.targetId,
        message: text,
        seconds: Number.isFinite(message.seconds) ? Math.max(0.5, message.seconds ?? 3.5) : 3.5,
    })
    if (world.popupMessages.length > 24) {
        world.popupMessages.splice(0, world.popupMessages.length - 24)
    }
}

/** Queue a clear request for the interaction-system to drain. `targetId
 *  === null` clears every active bubble; a specific id clears only that
 *  target's queue + current bubble. Same edge-triggered consumption
 *  pattern as `popupMessages`: the renderer tracks a `lastClearId`
 *  cursor and only acts on entries newer than that. */
export function pushPopupClear(world: GameWorld, targetId: string | null): void {
    world.popupClears.push({
        id: world.nextPopupClearId++,
        targetId,
    })
    // Bounded to avoid unbounded growth if no consumer is wired up
    // (e.g. headless test runs). Same 24-cap as popupMessages so the
    // ratio matches one clear per say.
    if (world.popupClears.length > 24) {
        world.popupClears.splice(0, world.popupClears.length - 24)
    }
}

/** Append a zone trigger event, evicting oldest entries past the cap.
 *  Use this instead of pushing onto `world.zoneEvents` directly so the
 *  queue stays bounded even when no consumer is draining it. */
export function pushZoneEvent(world: GameWorld, event: ZoneTriggerEvent): void {
    world.zoneEvents.push(event)
    if (world.zoneEvents.length > MAX_ZONE_EVENTS) {
        world.zoneEvents.splice(0, world.zoneEvents.length - MAX_ZONE_EVENTS)
    }
}

/** Push a trigger event for the script engine to dispatch on the next
 *  `script-engine-system` update. Producer systems call this from their
 *  detection code; the script engine drains the queue per tick. */
export function pushScriptTriggerEvent(world: GameWorld, event: ScriptTriggerEvent): void {
    world.scriptTriggerEvents.push(event)
}

/** Drain the trigger queue. Returns the previous contents and replaces
 *  the queue with a fresh empty array — cheaper than `splice(0)` for
 *  long bursts because we hand back the existing array instead of
 *  copying. Returns an empty array if the queue is already empty. */
export function consumeScriptTriggerEvents(world: GameWorld): readonly ScriptTriggerEvent[] {
    if (world.scriptTriggerEvents.length === 0) return EMPTY_TRIGGER_QUEUE
    const out = world.scriptTriggerEvents
    world.scriptTriggerEvents = []
    return out
}

const EMPTY_TRIGGER_QUEUE: readonly ScriptTriggerEvent[] = Object.freeze([])

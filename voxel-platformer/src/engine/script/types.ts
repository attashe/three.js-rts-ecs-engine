/**
 * Script engine — shared types.
 *
 * Authoritative shapes for ScriptEntry (the persistable string-blob the
 * editor writes into the level binary), the ScriptContext (the bag of
 * primitives we destructure into a script's locals), and the small
 * supporting types every layer agrees on.
 *
 * See `voxel-platformer/docs/script-engine.md` §3 for the design
 * contract these types implement.
 */

import type { VoxelCoord } from '../ecs/world'
import type { PlayerAbilityKey, PlayerSettings, PlayerSettingsPatch } from '../../game/player-settings'
import type { StoneSpawnOptions, StoneTierId } from '../../game/moving-objects'
import type { InventoryCategoryId, InventoryItemOptions, InventorySnapshotItem } from '../../game/inventory'

export type { VoxelCoord }

/** A persistable script. Lives inside `EditorLevelMeta.scripts` and is
 *  written to disk verbatim — the source string is the source of truth,
 *  not a compiled IR. */
export interface ScriptEntry {
    /** Stable id, generated at first save. Used as a Map key by the
     *  runtime so handlers registered by this script can be torn down
     *  individually. */
    id: string
    /** Display name (filename or user-chosen). */
    name: string
    /** Raw JS / TS text. The engine compiles this with
     *  `new AsyncFunction(...)` at load time. */
    source: string
    /** True for entries loaded from a real file on disk. The Logic
     *  tab's "Reload" button only appears for these. */
    fromFile?: boolean
    /** Path hint for the reload button. Best-effort — some browsers
     *  don't surface real paths through the file picker. */
    sourcePath?: string
    /** Default true. Disabled entries are skipped at compile time. */
    enabled?: boolean
}

/** Returned by `on(...)` so the caller (or the editor's Apply path) can
 *  unregister a single handler without tearing the whole script down. */
export type Disposer = () => void

/** Every event handler is `(event) => void | Promise<void>`. The engine
 *  doesn't await Promise return values — handlers can run for many ticks
 *  via `wait(...)` — but rejected Promises are caught and logged so a
 *  thrown handler doesn't kill the engine loop. */
export type EventHandler<E = unknown> = (event: E) => void | Promise<void>

/** Per-event payload shapes. Custom (author-named) events have whatever
 *  shape the emitter passed; the built-in events listed here are the
 *  ones the engine itself produces. */
export interface LevelStartEvent { kind: 'level-start' }
export interface LevelResetEvent { kind: 'level.reset' }
export interface TimerEvent { kind: 'timer'; tick: number }

// Built-in event payloads are intentionally kept loose at the public
// facade boundary. Producer systems own the concrete queue payloads;
// scripts filter by ordinary object properties through runtime.ts.

// ─── Narrow host facades ──────────────────────────────────────────────
// The bindings layer talks to these interfaces instead of importing
// AudioEngine / ChunkManager directly. Tests pass stubs; production
// wraps the real instances. This is the seam between "script runtime"
// and "rest of the engine".

export interface AudioFacade {
    play(soundId: string, opts?: { volume?: number; loop?: boolean; fade?: number }): unknown
    stop(handleOrSoundId: unknown, opts?: { fade?: number }): void
}

export interface ChunksFacade {
    getBlock(x: number, y: number, z: number): number
    setBlock(x: number, y: number, z: number, block: number): void
    fillBlocks(min: VoxelCoord, max: VoxelCoord, block: number): void
}

export interface PlayerFacade {
    /** Returns null when the player entity doesn't exist (mid-respawn,
     *  pre-spawn). The binding layer translates null to a sentinel
     *  position so scripts don't have to null-check. */
    getPosition(): VoxelCoord | null
    getGold(): number
    getArrows(): number
    getInventoryItemCount?(itemId: string): number
    getInventoryItems?(category?: InventoryCategoryId): InventorySnapshotItem[]
    addInventoryItem?(itemId: string, quantity?: number, opts?: InventoryItemOptions): boolean
    removeInventoryItem?(itemId: string, quantity?: number): boolean
    getSettings(): PlayerSettings
    setSettings(patch: PlayerSettingsPatch): PlayerSettings
    setAbility(ability: PlayerAbilityKey, enabled: boolean): void
    setGold(amount: number): void
    setArrows(amount: number): void
    teleport(x: number, y: number, z: number): void
    kill(reason?: string): void
    /** Returns the current respawn point, or null when none is set this
     *  session. The binding layer surfaces this as `player.checkpoint`. */
    getCheckpoint(): VoxelCoord | null
    /** Set the respawn point. Callers (the binding layer) are responsible
     *  for choosing between an explicit `pos` and the player's current
     *  position. */
    setCheckpoint(pos: VoxelCoord): void
    clearCheckpoint(): void
}

export interface PickupsFacade {
    spawn(kind: string, pos: VoxelCoord, opts?: PickupSpawnOptions): string
    /** Remove a live script-spawned pickup by id. Returns true on success. */
    despawn(id: string): boolean
    /** True if a script-spawned pickup with this id is currently live. */
    exists(id: string): boolean
}

export interface PistonsFacade {
    /** Toggle the piston's runtime gate. Returns true on a successful
     *  change, false when the id is unknown. No-op (still true) when the
     *  current state already matches. */
    setEnabled(id: string, enabled: boolean): boolean
    isEnabled(id: string): boolean
    /** Trigger a flip on the next fixed tick. Returns false for unknown
     *  ids, disabled pistons, and physical pistons that are currently
     *  mid-travel; true otherwise. */
    flip(id: string): boolean
    /** Enumerate every id-bearing piston. Order matches registration. */
    list(): string[]
}

export interface StonesFacade {
    spawn(pos: VoxelCoord, opts?: StoneScriptSpawnOptions): string
    remove(id: string): boolean
    exists(id: string): boolean
    setSpawnerEnabled(id: string, enabled: boolean): boolean
    isSpawnerEnabled(id: string): boolean
    triggerSpawner(id: string, count?: number): number
    listSpawners(): string[]
}

export interface CartsFacade {
    setEnabled(id: string, enabled: boolean): boolean
    isEnabled(id: string): boolean
    isOccupied(id: string): boolean
    list(): string[]
}

export interface NpcFacade {
    /** Play the NPC's attack swing. Returns false for unknown / dead ids. */
    attack(id: string): boolean
    /** Mark the NPC dead — it plays `die`, settles, then despawns. Returns
     *  false for unknown ids or one already dying. */
    die(id: string): boolean
    /** True iff a live (not yet despawned) NPC with this id exists. */
    exists(id: string): boolean
    /** Snapshot of every live NPC id in this level. */
    list(): string[]
}

export interface ZoneFacade {
    contains(zoneId: string, who: 'player' | VoxelCoord): boolean
    exists(zoneId: string): boolean
    isActive(zoneId: string): boolean
    /** Returns true on a successful change, false if the zone doesn't
     *  exist. No-op when the current state already matches. */
    setActive(zoneId: string, active: boolean): boolean
}

export interface LogFacade {
    log(message: string, kind?: 'info' | 'warn' | 'error'): void
}

export interface UiFacade {
    say(targetId: string, message: string, opts?: { seconds?: number }): void
    /** Dismiss any active popup bubbles. `targetId` clears that target's
     *  queue + current bubble; omitting it clears every bubble in flight.
     *  No-op when nothing matches. */
    clear?(targetId?: string): void
    dialogue?(request: DialogueRequest): Promise<DialogueResult>
}

export interface TradeFacade {
    open(request: TradeRequest): Promise<TradeResult>
}

/** Read-only snapshot of the level the script engine was started against.
 *  Implementations return fresh copies of mutable fields (e.g. spawn) so
 *  scripts can't mutate level metadata by writing to the returned object. */
export interface LevelMetaFacade {
    getSpawn(): VoxelCoord
    getSize(): number
    getName(): string
}

/** Drives the sky clock. Hour is in [0, 24); the underlying
 *  `AmbientWeather` state wraps. Setting any of these mutates state in
 *  place; the sun controller picks the new value up on the next
 *  render frame. */
export interface DayCycleFacade {
    getHour(): number
    /** Set the in-world hour (0..24, wraps). */
    setHour(hour: number): void
    /** Pause the cycle so `getHour()` stays put — `setHour` still
     *  works. Useful for cinematics that need a fixed-time backdrop. */
    setEnabled(enabled: boolean): void
    isEnabled(): boolean
    /** Real-time seconds per in-game day. Larger = slower cycle. */
    setSpeed(secondsPerDay: number): void
}

/** Ambient weather + named-preset application. Weather *zones*
 *  (rain volumes, fire pits, etc.) are still authored statically in
 *  level metadata for now — `setZoneEnabled` could be added later,
 *  but in v1 scripts can change global rain/snow/lightning toggles
 *  via this binding. */
export interface WeatherFacade {
    setRain(on: boolean): void
    setSnow(on: boolean): void
    setLightning(on: boolean): void
    /** Apply a named preset from `WEATHER_PRESETS` (e.g. 'clear',
     *  'rain', 'storm', 'dawn'). Returns true on success, false if
     *  the preset id isn't registered. */
    applyPreset(presetId: string): boolean
    /** Toggle a named weather zone (rain volumes, magic columns, …)
     *  authored in the level. Adds or removes from the live
     *  WeatherSystem in place. Returns true on a successful change,
     *  false if the zone id isn't known. */
    setZoneEnabled(zoneId: string, enabled: boolean): boolean
    isZoneEnabled(zoneId: string): boolean
    /** Re-spawn an authored weather zone with a different preset
     *  overlay (e.g. swap a 'rain' zone to 'storm'). Returns false if
     *  either id is unknown. */
    setZonePreset(zoneId: string, presetId: string): boolean
}

export interface TravelFacade {
    to(levelId: string, opts?: TravelOptions): void
    reload(opts?: { arrivalId?: string }): void
}

// ─── ScriptContext ────────────────────────────────────────────────────

/** What every compiled script sees, destructured into its locals. */
export interface ScriptContext {
    /** Register a handler. Returns a Disposer that unregisters it. The
     *  two overloads cover (filter, handler) for built-in events with a
     *  filter object, and (handler) for custom string-named events. */
    on(event: string, filter: object, handler: EventHandler, opts?: { once?: boolean }): Disposer
    on(event: string, handler: EventHandler, opts?: { once?: boolean }): Disposer

    /** Emit a custom event. Built-in events are emitted by the engine
     *  itself; authors emit only their own named events. Wakes every
     *  matching `on(...)` listener and resolves every matching
     *  `once(...)` Promise. */
    emit(event: string, data?: unknown): void

    /** Sugar for "wait for the next firing of this event." Returns the
     *  event payload. Disposes itself after resolving. */
    once<E = unknown>(event: string, filter?: object): Promise<E>

    /** Yield until `seconds` of sim-time has passed. Driven by the
     *  fixed-step clock, not wall-clock. Pausing the engine pauses the
     *  wait. */
    wait(seconds: number): Promise<void>

    /** Push a message into the in-game log. Same surface as the
     *  existing `pushLog(world, msg)` helper. */
    log(message: string, kind?: 'info' | 'warn' | 'error'): void

    player: PlayerApi
    chunks: ChunksApi
    audio: AudioApi
    pickups: PickupsApi
    pistons: PistonsApi
    stones: StonesApi
    carts: CartsApi
    npc: NpcApi
    flags: FlagsApi
    time: TimeApi
    zone: ZoneApi
    geom: GeomApi
    ui: UiApi
    trade: TradeApi
    dayCycle: DayCycleApi
    weather: WeatherApi
    travel: TravelApi
    level: LevelApi
    random(min: number, max: number): number
}

export interface TravelOptions {
    /** Optional destination-zone id in the target level. */
    arrivalId?: string
}

export interface LevelApi {
    /** Author-named spawn coords for the current level. Returned as a fresh
     *  object on every read; mutating it does not change level state. */
    readonly spawn: VoxelCoord
    /** XZ extent of the level (block units). */
    readonly size: number
    /** Editor-authored level name, or 'demo' for the procedural fallback. */
    readonly name: string
}

export interface DayCycleApi {
    /** Current hour of the in-world day, `[0, 24)`. */
    readonly hour: number
    /** True while the clock is advancing on its own; false when
     *  paused by `setEnabled(false)`. */
    readonly enabled: boolean
    setHour(hour: number): void
    setEnabled(enabled: boolean): void
    setSpeed(secondsPerDay: number): void
}

export interface WeatherApi {
    setRain(on: boolean): void
    setSnow(on: boolean): void
    setLightning(on: boolean): void
    applyPreset(presetId: string): boolean
    setZoneEnabled(zoneId: string, enabled: boolean): boolean
    isZoneEnabled(zoneId: string): boolean
    setZonePreset(zoneId: string, presetId: string): boolean
}

export interface TravelApi {
    /** Hot-swap to a project-library level. `arrivalId` is a zone id in
     *  the destination level; when omitted, the destination spawn is used. */
    to(levelId: string, opts?: TravelOptions): void
    /** Restart the current location without a browser reload. */
    reload(opts?: { arrivalId?: string }): void
}

export interface PlayerApi {
    /** Live getter — always returns the current player foot position,
     *  or a sentinel `{ x: NaN, y: NaN, z: NaN }` when no player
     *  entity exists right now. Sentinel coords make every AABB check
     *  return false naturally, so handlers don't need null guards. */
    readonly position: VoxelCoord
    /** True iff there's a live player entity. Use for explicit
     *  "skip while dead" gates: `if (!player.alive) return`. */
    readonly alive: boolean
    readonly inventory: PlayerInventoryApi
    readonly settings: PlayerSettings
    /** Current respawn point set via `setCheckpoint`, or `null` when none
     *  is set this session. Survives a death-triggered reload but not a
     *  full browser restart. */
    readonly checkpoint: VoxelCoord | null
    teleport(x: number, y: number, z: number): void
    kill(reason?: string): void
    /** Save a respawn point. With no argument, uses the current player
     *  position; called while dead, the call is a no-op. The next
     *  `player.died` reload spawns the player here instead of
     *  `level.spawn`. */
    setCheckpoint(pos?: VoxelCoord): void
    /** Forget the current checkpoint. Subsequent respawns use
     *  `level.spawn`. */
    clearCheckpoint(): void
    setSettings(patch: PlayerSettingsPatch): PlayerSettings
    setAbility(ability: PlayerAbilityKey, enabled: boolean): void
    setGold(amount: number): void
    setArrows(amount: number): void
    addInventoryItem(itemId: string, quantity?: number, opts?: InventoryItemOptions): boolean
    removeInventoryItem(itemId: string, quantity?: number): boolean
}

export interface PlayerInventoryApi {
    readonly gold: number
    readonly arrows: number
    count(itemId: string): number
    has(itemId: string, quantity?: number): boolean
    list(category?: InventoryCategoryId): readonly InventorySnapshotItem[]
}

export interface ChunksApi {
    getBlock(x: number, y: number, z: number): number
    setBlock(x: number, y: number, z: number, block: number): void
    fillBlocks(min: VoxelCoord, max: VoxelCoord, block: number): void
}

export interface AudioApi {
    play(soundId: string, opts?: { volume?: number; loop?: boolean; fade?: number }): unknown
    stop(handleOrSoundId: unknown, opts?: { fade?: number }): void
}

export interface PickupsApi {
    spawn(kind: string, pos: VoxelCoord, opts?: PickupSpawnOptions): string
    /** Remove a live script-spawned pickup by id. Returns `true` if a live
     *  pickup with this id existed and was removed, `false` otherwise. Does
     *  not fire `pickup-taken` — that event is reserved for player
     *  collection. */
    despawn(id: string): boolean
    /** True iff `pickups.spawn(..., { id })` would currently return the
     *  same id (rather than re-spawning a fresh entity). */
    exists(id: string): boolean
}

export interface PistonsApi {
    /** Toggle a level-authored piston's runtime gate. Returns true on a
     *  successful change, false when the id is unknown to scripts. */
    setEnabled(id: string, enabled: boolean): boolean
    isEnabled(id: string): boolean
    /** Request a flip on the next fixed tick. Returns false for unknown
     *  ids, disabled pistons, and physical pistons mid-travel — the
     *  authored cycle stays untouched in those cases. */
    flip(id: string): boolean
    /** Snapshot of every script-targetable piston id in the current
     *  level. Pistons without an `id` are intentionally excluded. */
    list(): string[]
}

export interface StoneScriptSpawnOptions extends StoneSpawnOptions {
    /** Stable author id. Re-spawning with the same id returns the existing
     *  live stone instead of creating a duplicate. */
    id?: string
    /** Initial velocity. Defaults to still. */
    velocity?: VoxelCoord
    /** Named gameplay/visual preset. */
    tier?: StoneTierId
    /** Radius override in world units. */
    size?: number
}

export interface StonesApi {
    spawn(pos: VoxelCoord, opts?: StoneScriptSpawnOptions): string
    /** Remove a live script/direct stone by id. Returns true on success. */
    remove(id: string): boolean
    /** True iff a script/direct stone with this id currently exists. */
    exists(id: string): boolean
    /** Toggle an editor-authored spawner. Unknown ids return false. */
    setSpawnerEnabled(id: string, enabled: boolean): boolean
    isSpawnerEnabled(id: string): boolean
    /** Emit immediately from an editor-authored spawner. Returns spawned count. */
    triggerSpawner(id: string, count?: number): number
    /** Snapshot of every script-targetable stone spawner id in this level. */
    listSpawners(): string[]
}

export interface CartsApi {
    /** Toggle a level-authored rail cart. Unknown ids return false. */
    setEnabled(id: string, enabled: boolean): boolean
    isEnabled(id: string): boolean
    /** True while a player is mounted in this cart. */
    isOccupied(id: string): boolean
    /** Snapshot of every script-targetable rail cart id in this level. */
    list(): string[]
}

export interface NpcApi {
    /** Play the NPC's attack swing. Returns false for unknown / dead ids. */
    attack(id: string): boolean
    /** Kill the NPC — it plays `die`, settles on the ground, then despawns.
     *  Returns false for unknown ids or one already dying. */
    die(id: string): boolean
    /** True iff a live (not yet despawned) NPC with this id exists. */
    exists(id: string): boolean
    /** Snapshot of every live NPC id in this level. */
    list(): string[]
}

export interface PickupSpawnOptions {
    amount?: number
    /** Stable author id. Re-spawning with the same id returns the existing
     *  live pickup instead of creating a duplicate. */
    id?: string
    /** Human-readable item name for pickup logs. */
    label?: string
    /** Durable inventory metadata for custom pickups. Coins keep using gold. */
    inventoryItem?: InventoryItemOptions & { id?: string }
}

export type FlagValue = number | string | boolean

export interface FlagsApi {
    get(name: string): FlagValue | undefined
    set(name: string, value: FlagValue): void
}

export interface TimeApi {
    /** Sim-seconds since the engine started (or the last `apply()`). */
    readonly now: number
    /** Integer fixed-tick count since `now` was last reset. */
    readonly tick: number
    /** Seconds elapsed during the most recent fixed-step tick. Use
     *  for smooth interpolation inside a script (e.g. raising a door
     *  by `0.5 * delta` per tick). Zero before the first tick. */
    readonly delta: number
}

export interface ZoneApi {
    contains(zoneId: string, who?: 'player' | VoxelCoord): boolean
    /** True if a zone with this id is currently registered. */
    exists(zoneId: string): boolean
    /** True for registered + active zones; false for missing or
     *  deactivated ones. */
    isActive(zoneId: string): boolean
    /** Toggle a zone on/off. Returns true on success, false if the
     *  zone doesn't exist. Deactivating mid-overlap synthesises a
     *  `zone-exit` event next tick. */
    setActive(zoneId: string, active: boolean): boolean
}

export interface UiApi {
    /** Show a short world-anchored popup near an NPC/item target. `targetId`
     *  usually matches an interact zone id. Multiple targets render in
     *  parallel; back-to-back calls to the same target queue and play
     *  sequentially. */
    say(targetId: string, message: string, opts?: { seconds?: number }): void
    /** Dismiss popup bubbles early. With a `targetId`, drops that
     *  target's current bubble + queued messages. With no argument,
     *  clears every active bubble. Use to interrupt a long-lived
     *  message (e.g. when the player walks away from an NPC). */
    clear(targetId?: string): void
    /** Show a centered modal conversation. Resolves after the final line,
     *  or after the player chooses a reply and advances past it. */
    dialogue(request: DialogueRequest): Promise<DialogueResult>
}

export interface TradeApi {
    /** Open an NPC trade menu. The engine validates the selected
     *  transaction and mutates player inventory atomically before the
     *  Promise resolves. */
    open(request: TradeRequest): Promise<TradeResult>
}

export type TradeCurrency = 'gold'
export type TradeResource = 'arrows'
export type TradeMode = 'buy' | 'sell'

export interface TradeInventorySnapshot {
    gold: number
    arrows: number
}

export interface TradeItem {
    /** Stable id returned in TradeResult and used by UI selection. */
    id: string
    name: string
    description?: string
    /** Player inventory resource granted/removed by this item. */
    resource: TradeResource
    /** Resource units per trade quantity. Defaults to 1. */
    unitSize?: number
    /** Gold cost per quantity. Omit to disable buying this item. */
    buyPrice?: number
    /** Gold paid to the player per quantity. Omit to disable selling. */
    sellPrice?: number
    /** Optional per-open buy stock in quantities, not resource units. */
    stock?: number
    disabled?: boolean
}

export interface TradeRequest {
    id?: string
    title?: string
    npc?: DialogueSpeaker
    currency?: TradeCurrency
    items: readonly TradeItem[]
}

export type TradeResult =
    | {
        status: 'bought'
        itemId: string
        itemName: string
        quantity: number
        unitSize: number
        spent: { gold: number }
        gained: Partial<Record<TradeResource, number>>
        inventory: TradeInventorySnapshot
    }
    | {
        status: 'sold'
        itemId: string
        itemName: string
        quantity: number
        unitSize: number
        gained: { gold: number }
        removed: Partial<Record<TradeResource, number>>
        inventory: TradeInventorySnapshot
    }
    | { status: 'cancelled'; inventory?: TradeInventorySnapshot }
    | { status: 'unavailable'; reason?: string; inventory?: TradeInventorySnapshot }

export interface DialogueSpeaker {
    /** Stable speaker id used by lines, e.g. `keeper`, `player`. */
    id?: string
    name: string
    /** Built-in PNG avatar key (`keeper`, `player`, `sundial`, `book`, `npc`),
     *  an image path, or any author string. Unknown strings render as a
     *  labelled portrait badge. */
    avatar?: string
    /** Visual side in the dialogue panel. Defaults to NPC left, player right. */
    side?: 'left' | 'right'
}

export interface DialogueChoice {
    id: string
    text: string
    disabled?: boolean
}

export interface DialogueLine {
    /** Speaker id, `npc`, or `player`. Defaults to `npc`. */
    speaker?: string
    /** Per-line override when no speaker registry entry is convenient. */
    name?: string
    avatar?: string
    text: string
    /** When present, the line waits for a player reply instead of advancing
     *  by click. The selected choice is shown as a player line before resolve. */
    choices?: DialogueChoice[]
}

export interface DialogueRequest {
    id?: string
    title?: string
    npc?: DialogueSpeaker
    player?: DialogueSpeaker
    /** Extra named speakers for books/items/secondary NPCs. */
    speakers?: DialogueSpeaker[]
    lines: DialogueLine[]
}

export interface DialogueResult {
    choiceId?: string
    choiceIndex?: number
    text?: string
}

export interface GeomApi {
    /** Inclusive-min, exclusive-max AABB test. Matches the convention
     *  zones use (`isPointInZone`) so a script can compute "near a
     *  cell range" without authoring a real zone. */
    box(min: VoxelCoord, max: VoxelCoord, point: VoxelCoord): boolean
    /** Squared distance between two points. Cheaper than `Math.hypot`
     *  for "is closer than R" checks: `geom.distSq(a, b) < R * R`. */
    distSq(a: VoxelCoord, b: VoxelCoord): number
}

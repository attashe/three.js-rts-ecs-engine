/**
 * Voxel-platformer in-game script API — ambient declarations.
 *
 * Drop this file into the workspace where you author level scripts (or
 * reference it from a `jsconfig.json` / `tsconfig.json`) and every script
 * gets autocomplete, hover docs, and type-checking for the globals the
 * engine injects — without importing anything.
 *
 *   // <reference path="./script-api.d.ts" />   // if not picked up automatically
 *
 * These globals are the *only* contract a script may rely on. The engine
 * destructures them out of the script context at compile time
 * (see `src/engine/script/compile.ts` → `PRELUDE_LOCALS`); the
 * authoritative runtime shapes live in `src/engine/script/types.ts`. Keep
 * this file in sync with that one — there is no codegen.
 *
 * Authoring guide: docs/script-engine.md. Gotchas worth knowing up front:
 *   - `once` belongs on registration (4th arg OR inside the filter object,
 *     they're equivalent); it is NOT a data-match key.
 *   - Use `wait()`, `time.now`, and `random()` for anything time- or
 *     chance-driven. `Date.now()` / `Math.random()` break determinism.
 *   - `on('level-start', ...)` re-fires on the editor's Apply; prefer it
 *     over top-level body code for one-shot bootstrap that should re-run
 *     on hot-reload.
 */

// ─── Core value types ─────────────────────────────────────────────────

/** A point or cell in the voxel grid. Block coords are integers; entity
 *  positions (e.g. `player.position`) are continuous. */
interface VoxelCoord {
    x: number
    y: number
    z: number
}

/** Returned by `on(...)`. Call it to unregister that single handler.
 *  Apply tears every handler down anyway, so explicit disposal is only
 *  needed for handlers a script wants to retire mid-run. */
type Disposer = () => void

/** Every handler is `(event) => void | Promise<void>`. Async handlers may
 *  run for many ticks via `wait(...)`; the engine never awaits them, but a
 *  rejected promise is caught and surfaced in the Logic tab rather than
 *  killing the engine. */
type EventHandler<E = unknown> = (event: E) => void | Promise<void>

type FlagValue = number | string | boolean

// ─── Built-in event payloads ──────────────────────────────────────────

/** Who/what tripped a zone trigger. */
type ZoneTriggerSource = 'player' | 'arrow'

interface ZoneEvent {
    entityId: number
    zoneId: string
    source: ZoneTriggerSource
    point: VoxelCoord
}

interface PickupTakenEvent {
    pickupId: string
    kind: string
    position: VoxelCoord
    amount?: number
}

interface InputEvent {
    /** Currently only `'interact'` is emitted (the interaction key). */
    action: string
    /** Press/release edge. */
    edge?: 'pressed' | 'released'
    targetId?: string
    zoneId?: string
    point?: VoxelCoord
    entityId?: number
}

interface TimerEvent {
    tick: number
}

interface PlayerDiedEvent {
    reason?: string
}

interface FlagChangedEvent {
    name: string
    value: FlagValue
    previousValue: FlagValue | undefined
}

// ─── Registration / events ────────────────────────────────────────────

interface OnOptions {
    /** Fire the handler exactly once, then dispose the registration.
     *  Equivalent to passing `{ once: true }` inside the filter object. */
    once?: boolean
}

/** Register a handler for a built-in event with a filter object.
 *  The filter is matched by strict equality on each key against the
 *  event payload. `once` is a reserved key — it is lifted onto
 *  registration rather than matched against the payload. */
declare function on(event: 'level-start', handler: EventHandler<void>, opts?: OnOptions): Disposer
declare function on(event: 'level.reset', handler: EventHandler<void>, opts?: OnOptions): Disposer
declare function on(
    event: 'zone-enter' | 'zone-exit',
    filter: { zoneId?: string; source?: ZoneTriggerSource; once?: boolean },
    handler: EventHandler<ZoneEvent>,
    opts?: OnOptions,
): Disposer
declare function on(
    event: 'pickup-taken',
    filter: { pickupId?: string; kind?: string; once?: boolean },
    handler: EventHandler<PickupTakenEvent>,
    opts?: OnOptions,
): Disposer
declare function on(
    event: 'input',
    filter: { action?: string; edge?: 'pressed' | 'released'; targetId?: string; once?: boolean },
    handler: EventHandler<InputEvent>,
    opts?: OnOptions,
): Disposer
declare function on(
    event: 'timer',
    filter: { periodSeconds: number; oneshot?: boolean },
    handler: EventHandler<TimerEvent>,
    opts?: OnOptions,
): Disposer
declare function on(event: 'player.died', handler: EventHandler<PlayerDiedEvent>, opts?: OnOptions): Disposer
declare function on(
    event: 'flag.changed',
    filter: { name?: string; once?: boolean },
    handler: EventHandler<FlagChangedEvent>,
    opts?: OnOptions,
): Disposer
/** Custom (author-named) event, no filter. The payload is whatever the
 *  emitter passed. */
declare function on<E = unknown>(event: string, handler: EventHandler<E>, opts?: OnOptions): Disposer
/** Custom event with a plain filter object. */
declare function on<E = unknown>(event: string, filter: object, handler: EventHandler<E>, opts?: OnOptions): Disposer

/** Emit a custom event. Wakes every matching `on(...)` listener and
 *  resolves every matching `once(...)` promise. Built-in events are
 *  emitted by the engine — authors emit only their own names. */
declare function emit(event: string, data?: unknown): void

/** Resolve on the next firing of `event`, with the event payload. Sugar
 *  for a self-disposing one-shot `on(...)`. */
declare function once<E = unknown>(event: string, filter?: object): Promise<E>

/** Yield until `seconds` of *sim-time* has elapsed. Driven by the
 *  fixed-step clock — pausing the engine pauses the wait, and replay
 *  stays in lockstep. */
declare function wait(seconds: number): Promise<void>

/** Push a line into the in-game log / console. */
declare function log(message: string, kind?: 'info' | 'warn' | 'error'): void

/** Seeded uniform in `[min, max)`. Same seed → same sequence; use this
 *  instead of `Math.random()` to keep scripts deterministic. */
declare function random(min: number, max: number): number

// ─── player ───────────────────────────────────────────────────────────

type PlayerAbilityKey = 'movement' | 'jump' | 'bow' | 'highJump' | 'airPush' | 'interact' | 'torch'
type PlayerModelKind = 'player' | 'keeper'
type HandEquipmentKind = 'sword' | 'shield' | 'bow' | 'staff' | 'book'
type InventoryCategoryId = 'resources' | 'quest' | 'consumables' | 'accessories' | 'tools'
type InventoryIconId = 'gold' | 'arrows' | 'quest-shard' | 'consumable' | 'accessory' | 'tool' | 'item'

interface PlayerAbilitySettings {
    movement: boolean
    jump: boolean
    bow: boolean
    highJump: boolean
    airPush: boolean
    interact: boolean
    torch: boolean
}

interface PlayerInventorySettings {
    gold: number
    arrows: number
    items: Record<string, InventoryItemRecord>
}

interface EquipmentHandLoadout {
    handR: HandEquipmentKind | null
    handL: HandEquipmentKind | null
}

interface PlayerEquipmentSettings {
    melee: EquipmentHandLoadout
    ranged: EquipmentHandLoadout
}

interface InventoryItemRecord {
    quantity: number
    name?: string
    description?: string
    category?: InventoryCategoryId
    icon?: InventoryIconId
}

interface InventoryItemOptions {
    name?: string
    description?: string
    category?: InventoryCategoryId
    icon?: InventoryIconId
}

interface InventorySnapshotItem {
    id: string
    quantity: number
    name: string
    description?: string
    category: InventoryCategoryId
    icon: InventoryIconId
}

interface PlayerTorchSettings {
    intensity: number
    distance: number
    castsShadow: boolean
}

interface PlayerSettings {
    model: PlayerModelKind
    abilities: PlayerAbilitySettings
    inventory: PlayerInventorySettings
    equipment: PlayerEquipmentSettings
    moveSpeed: number
    jumpVelocity: number
    highJumpVelocity: number
    arrowSpeed: number
    arrowLift: number
    airPushRange: number
    airPushPower: number
    airPushLift: number
    torch: PlayerTorchSettings
    indoorCutEnabled: boolean
    indoorCutMode: 'corridor' | 'ybox'
}

type PlayerSettingsPatch = Partial<Omit<PlayerSettings, 'abilities' | 'inventory' | 'equipment' | 'torch'>> & {
    abilities?: Partial<PlayerAbilitySettings>
    inventory?: Partial<PlayerInventorySettings>
    equipment?: {
        melee?: Partial<EquipmentHandLoadout>
        ranged?: Partial<EquipmentHandLoadout>
    }
    torch?: Partial<PlayerTorchSettings>
}

interface PlayerApi {
    /** Live foot position. When no player entity exists right now
     *  (mid-respawn, pre-spawn) the coords are `NaN`, so AABB / distance
     *  tests return false without explicit null guards. */
    readonly position: VoxelCoord
    /** True iff a live player entity exists. */
    readonly alive: boolean
    readonly inventory: PlayerInventoryApi
    readonly settings: PlayerSettings
    /** Current respawn point, or null when unset this session. */
    readonly checkpoint: VoxelCoord | null
    teleport(x: number, y: number, z: number): void
    kill(reason?: string): void
    /** Save a respawn point. Omit `pos` to use the current position; a
     *  no-op while dead. */
    setCheckpoint(pos?: VoxelCoord): void
    clearCheckpoint(): void
    setSettings(patch: PlayerSettingsPatch): PlayerSettings
    setAbility(ability: PlayerAbilityKey, enabled: boolean): void
    setGold(amount: number): void
    setArrows(amount: number): void
    addInventoryItem(itemId: string, quantity?: number, opts?: InventoryItemOptions): boolean
    removeInventoryItem(itemId: string, quantity?: number): boolean
}

interface PlayerInventoryApi {
    readonly gold: number
    readonly arrows: number
    count(itemId: string): number
    has(itemId: string, quantity?: number): boolean
    list(category?: InventoryCategoryId): readonly InventorySnapshotItem[]
}

declare const player: PlayerApi

// ─── chunks (voxel grid) ──────────────────────────────────────────────

interface ChunksApi {
    getBlock(x: number, y: number, z: number): number
    setBlock(x: number, y: number, z: number, block: number): void
    /** Inclusive-min, exclusive-max box fill. */
    fillBlocks(min: VoxelCoord, max: VoxelCoord, block: number): void
}

declare const chunks: ChunksApi

// ─── audio ────────────────────────────────────────────────────────────

interface AudioApi {
    /** `fade` cross-fades over N seconds. Returns a handle you can pass to
     *  `stop`. Music ids cross-fade; sfx defer until audio is unlocked. */
    play(soundId: string, opts?: { volume?: number; loop?: boolean; fade?: number }): unknown
    stop(handleOrSoundId: unknown, opts?: { fade?: number }): void
}

declare const audio: AudioApi

// ─── cinematic (camera/text/character sequences) ──────────────────────

interface CinematicApi {
    /** Play an authored cinematic by id. `await` it to continue the script
     *  after the cinematic ends; an unknown id resolves immediately.
     *  Example: `await cinematic.play('intro')` */
    play(id: string): Promise<void>
    /** Skip the active cinematic. Returns false if none was playing. */
    stop(): boolean
    /** Whether a cinematic is currently playing. */
    readonly isPlaying: boolean
}

declare const cinematic: CinematicApi

// ─── pickups ──────────────────────────────────────────────────────────

interface PickupSpawnOptions {
    amount?: number
    /** Stable author id — re-spawning with the same id returns the
     *  existing live pickup instead of duplicating. */
    id?: string
    label?: string
    /** Durable item metadata for custom pickups. Coins keep using gold. */
    inventoryItem?: InventoryItemOptions & { id?: string }
}

interface PickupsApi {
    spawn(kind: string, pos: VoxelCoord, opts?: PickupSpawnOptions): string
    /** Remove a live script-spawned pickup. Does NOT fire `pickup-taken`. */
    despawn(id: string): boolean
    exists(id: string): boolean
}

declare const pickups: PickupsApi

// ─── pistons ──────────────────────────────────────────────────────────

interface PistonsApi {
    /** Toggle the runtime gate. False if the id is unknown to scripts. */
    setEnabled(id: string, enabled: boolean): boolean
    isEnabled(id: string): boolean
    /** Queue a flip for the next fixed tick. False for unknown / disabled
     *  pistons and physical pistons mid-travel. */
    flip(id: string): boolean
    /** Deploy or hide a physical piston's entity. Hidden pistons are not
     *  rendered or collidable. False for unknown, teleport, or moving pistons. */
    setDeployed(id: string, deployed: boolean): boolean
    /** Ids in registration order. Pistons authored without an id are
     *  invisible to scripts and excluded here. */
    list(): string[]
}

declare const pistons: PistonsApi

// ─── props ───────────────────────────────────────────────────────────

type EditorPropKind =
    | 'flower'
    | 'flower-2'
    | 'flower-3'
    | 'bush'
    | 'bush-2'
    | 'bush-3'
    | 'mushroom'
    | 'mushroom-2'
    | 'mushroom-3'
    | 'table'
    | 'table-2'
    | 'chair'
    | 'chair-2'
    | 'book'
    | 'book-2'
    | 'npc-keeper'
    | 'sundial'
    | 'haste-shrine'
    | 'portal-shrine'
    | 'high-jump-boots'
    | 'lift-cabin-broken'
    | 'lift-cabin-repaired'

interface PropsApi {
    exists(id: string): boolean
    isVisible(id: string): boolean
    setVisible(id: string, visible: boolean): boolean
    setKind(id: string, kind: EditorPropKind | string): boolean
    list(): string[]
}

declare const props: PropsApi

// ─── stones ───────────────────────────────────────────────────────────

type StoneTierId = 'pebble' | 'cobble' | 'stone' | 'rock' | 'boulder'

interface StoneSpawnOptions {
    radius?: number
    mass?: number
    restitution?: number
    linearDamping?: number
    sleepThresholdSq?: number
    sleepDelay?: number
    gravityScale?: number
    maxFallSpeed?: number
    color?: number
    chipColor?: number
}

interface StoneScriptSpawnOptions extends StoneSpawnOptions {
    /** Stable author id — re-spawning with the same id returns the
     *  existing live stone. */
    id?: string
    velocity?: VoxelCoord
    tier?: StoneTierId
    /** Radius override in world units. */
    size?: number
}

interface StonesApi {
    spawn(pos: VoxelCoord, opts?: StoneScriptSpawnOptions): string
    remove(id: string): boolean
    exists(id: string): boolean
    setSpawnerEnabled(id: string, enabled: boolean): boolean
    isSpawnerEnabled(id: string): boolean
    /** Emit immediately from an editor-authored spawner. Returns the
     *  spawned count. */
    triggerSpawner(id: string, count?: number): number
    listSpawners(): string[]
}

declare const stones: StonesApi

// ─── npc (combat: attack / die) ───────────────────────────────────────

interface NpcApi {
    /** Play the NPC's attack swing. Returns false for unknown / dead ids. */
    attack(id: string): boolean
    /** Kill the NPC — it plays `die`, settles on the ground, then despawns.
     *  Returns false for unknown ids or one already dying. */
    die(id: string): boolean
    /** True iff a live (not yet despawned) NPC with this id exists. */
    exists(id: string): boolean
    /** Snapshot of every live NPC id in this level. */
    list(): string[]
    /** Set a patrol route: empty = hold post, one point = guard/stand, many =
     *  walk in a loop. While patrolling the NPC engages the nearest enemy in
     *  perception range, then returns to its route. */
    setWaypoints(id: string, points: VoxelCoord[]): boolean
    /** Walk to a single point and hold there (one-point patrol). */
    goTo(id: string, point: VoxelCoord): boolean
    /** Clear the route so the NPC holds its current spot. */
    stop(id: string): boolean
    /** Radius (world units) within which the NPC notices enemies. */
    setPerceptionRadius(id: string, radius: number): boolean
    /** Mark `target` (`'player'` or another NPC id) as an enemy or not. There is
     *  no faction system — hostility is whatever scripts set. */
    setHostile(id: string, target: string, hostile: boolean): boolean
}

declare const npc: NpcApi

/** Fired once when an NPC first spots an enemy and begins engaging. */
interface NpcSpottedEnemyEvent {
    npcId: string
    /** The enemy: `'player'` or another NPC id. */
    targetId: string
}

/** Fired when a patrolling NPC reaches one of its waypoints. */
interface NpcReachedEvent {
    npcId: string
    waypointIndex: number
}

declare function on(event: 'npc-spotted-enemy', handler: EventHandler<NpcSpottedEnemyEvent>, opts?: OnOptions): Disposer
declare function on(event: 'npc-reached', handler: EventHandler<NpcReachedEvent>, opts?: OnOptions): Disposer

// ─── flags (persistent level state) ───────────────────────────────────

interface FlagsApi {
    get(name: string): FlagValue | undefined
    /** Writes are live — handlers in the same tick see each other's
     *  writes. Changing a value emits `flag.changed`. */
    set(name: string, value: FlagValue): void
}

declare const flags: FlagsApi

// ─── time ─────────────────────────────────────────────────────────────

interface TimeApi {
    /** Sim-seconds since level start (or last Apply). */
    readonly now: number
    /** Integer fixed-tick count since `now` was last reset. */
    readonly tick: number
    /** Seconds elapsed in the most recent tick; use for interpolation. */
    readonly delta: number
}

declare const time: TimeApi

// ─── zone ─────────────────────────────────────────────────────────────

interface ZoneApi {
    contains(zoneId: string, who?: 'player' | VoxelCoord): boolean
    exists(zoneId: string): boolean
    isActive(zoneId: string): boolean
    /** Toggle a zone. Deactivating mid-overlap synthesises a `zone-exit`
     *  next tick. False if the zone doesn't exist. */
    setActive(zoneId: string, active: boolean): boolean
}

declare const zone: ZoneApi

// ─── geom (pure helpers) ──────────────────────────────────────────────

interface GeomApi {
    /** Inclusive-min, exclusive-max AABB test — same convention as zones. */
    box(min: VoxelCoord, max: VoxelCoord, point: VoxelCoord): boolean
    /** Squared distance; cheaper than hypot for radius checks:
     *  `geom.distSq(a, b) < R * R`. */
    distSq(a: VoxelCoord, b: VoxelCoord): number
}

declare const geom: GeomApi

// ─── ui (popups + dialogue) ───────────────────────────────────────────

type DialogueVoicePreset =
    | 'tiny'
    | 'dwarf'
    | 'troll'
    | 'goblin'
    | 'orc'
    | 'elf'
    | 'lizard'
    | 'undead'
    | 'demon'
    | 'gnome'
    | 'player'

interface DialogueVoiceRef {
    preset?: DialogueVoicePreset
    seed?: string
    volume?: number
    rate?: number
    pitchOffset?: number
    enabled?: boolean
}

interface DialogueSpeaker {
    id?: string
    name: string
    /** Built-in PNG key (`keeper`, `player`, `sundial`, `book`, `npc`), an
     *  image path (`/avatars/merchant.png`), or any string (falls back to
     *  a labelled badge). */
    avatar?: string
    side?: 'left' | 'right'
    /** Generated fantasy-babble voice for this speaker. */
    voice?: DialogueVoiceRef
}

interface DialogueChoice {
    id: string
    text: string
    disabled?: boolean
}

interface DialogueLine {
    /** Speaker id, `npc`, or `player`. Defaults to `npc`. */
    speaker?: string
    name?: string
    avatar?: string
    voice?: DialogueVoiceRef
    text: string
    /** When present, the line waits for a player reply instead of
     *  advancing on click. */
    choices?: DialogueChoice[]
}

interface DialogueRequest {
    id?: string
    title?: string
    npc?: DialogueSpeaker
    player?: DialogueSpeaker
    speakers?: DialogueSpeaker[]
    lines: DialogueLine[]
}

interface DialogueResult {
    choiceId?: string
    choiceIndex?: number
    text?: string
}

interface UiApi {
    /** World-anchored popup near a target (usually an interact-zone id).
     *  Different targets render in parallel; back-to-back calls to the
     *  same target queue and play sequentially. */
    say(targetId: string, message: string, opts?: { seconds?: number }): void
    /** Dismiss bubbles early — a target's queue, or all of them with no
     *  argument. */
    clear(targetId?: string): void
    /** Centered modal conversation. Resolves after the final line (or the
     *  player's choice). */
    dialogue(request: DialogueRequest): Promise<DialogueResult>
}

declare const ui: UiApi

// ─── trade (NPC shop transactions) ───────────────────────────────────

type TradeCurrency = 'gold'
type TradeResource = 'arrows'

interface TradeInventorySnapshot {
    gold: number
    arrows: number
}

interface TradeItem {
    id: string
    name: string
    description?: string
    /** Player inventory resource granted by buying or removed by selling. */
    resource: TradeResource
    /** Resource units per selected quantity. Defaults to 1. */
    unitSize?: number
    /** Gold cost per quantity. Omit to disable buying. */
    buyPrice?: number
    /** Gold paid to the player per quantity. Omit to disable selling. */
    sellPrice?: number
    /** Per-open buy stock in quantities, not resource units. */
    stock?: number
    disabled?: boolean
}

interface TradeRequest {
    id?: string
    title?: string
    npc?: DialogueSpeaker
    currency?: TradeCurrency
    items: readonly TradeItem[]
}

type TradeResult =
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

interface TradeApi {
    /** Open a shop menu and apply the validated buy/sell transaction. */
    open(request: TradeRequest): Promise<TradeResult>
}

declare const trade: TradeApi

// ─── dayCycle ─────────────────────────────────────────────────────────

interface DayCycleApi {
    /** Current in-world hour, `[0, 24)`. */
    readonly hour: number
    /** True while the clock advances on its own. */
    readonly enabled: boolean
    setHour(hour: number): void
    /** Pause/resume the clock; `setHour` still works while paused. */
    setEnabled(enabled: boolean): void
    /** Real-time seconds per in-game day. Larger = slower. */
    setSpeed(secondsPerDay: number): void
}

declare const dayCycle: DayCycleApi

// ─── weather ──────────────────────────────────────────────────────────

/** Ambient presets registered in `WEATHER_PRESETS`. */
type WeatherPresetId = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'dawn'

interface WeatherApi {
    setRain(on: boolean): void
    setSnow(on: boolean): void
    setLightning(on: boolean): void
    /** Apply a named ambient preset. False if the id isn't registered. */
    applyPreset(presetId: WeatherPresetId | string): boolean
    /** Toggle a level-authored weather zone (rain volume, magic column…). */
    setZoneEnabled(zoneId: string, enabled: boolean): boolean
    isZoneEnabled(zoneId: string): boolean
    /** Re-spawn a weather zone with a different preset overlay. */
    setZonePreset(zoneId: string, presetId: string): boolean
}

declare const weather: WeatherApi

// ─── travel ───────────────────────────────────────────────────────────

interface TravelOptions {
    /** Destination-zone id in the target level; omitted ⇒ destination
     *  spawn. */
    arrivalId?: string
}

interface TravelApi {
    /** Hot-swap to a project-library level. */
    to(levelId: string, opts?: TravelOptions): void
    /** Restart the current location without a browser reload. */
    reload(opts?: { arrivalId?: string }): void
}

declare const travel: TravelApi

// ─── level (read-only metadata) ───────────────────────────────────────

interface LevelApi {
    /** Author-named spawn. Fresh object per read; mutating it is inert. */
    readonly spawn: VoxelCoord
    /** XZ extent in block units. */
    readonly size: number
    /** Editor-authored name, or 'demo' for the procedural fallback. */
    readonly name: string
}

declare const level: LevelApi

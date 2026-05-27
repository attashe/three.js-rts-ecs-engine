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
    teleport(x: number, y: number, z: number): void
    kill(reason?: string): void
}

export interface PickupsFacade {
    spawn(kind: string, pos: VoxelCoord, opts?: PickupSpawnOptions): string
}

export interface ZoneFacade {
    contains(zoneId: string, who: 'player' | VoxelCoord): boolean
}

export interface LogFacade {
    log(message: string, kind?: 'info' | 'warn' | 'error'): void
}

export interface UiFacade {
    say(targetId: string, message: string, opts?: { seconds?: number }): void
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
    flags: FlagsApi
    time: TimeApi
    zone: ZoneApi
    geom: GeomApi
    ui: UiApi
    random(min: number, max: number): number
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
    readonly inventory: { readonly gold: number }
    teleport(x: number, y: number, z: number): void
    kill(reason?: string): void
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
}

export interface PickupSpawnOptions {
    amount?: number
    /** Stable author id. Re-spawning with the same id returns the existing
     *  live pickup instead of creating a duplicate. */
    id?: string
    /** Human-readable item name for pickup logs. */
    label?: string
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
}

export interface UiApi {
    /** Show a short world-anchored popup near an NPC/item target. `targetId`
     *  usually matches an interact zone id. */
    say(targetId: string, message: string, opts?: { seconds?: number }): void
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

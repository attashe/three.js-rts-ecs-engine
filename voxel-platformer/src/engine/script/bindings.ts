/**
 * Script engine — host bindings.
 *
 * Builds the `ScriptContext` object every compiled script sees,
 * stitching the runtime kernel (on / emit / once / wait / time / random)
 * to thin adapters over the engine's existing subsystems
 * (audio, chunks, world, pickups). Tests inject narrow facade stubs;
 * production wraps the real ChunkManager / AudioEngine / GameWorld via
 * the system factory.
 *
 * No gameplay logic lives here. Each adapter is glue — one call
 * forwarded, occasionally a coordinate normalised, never new behaviour.
 */

import type {
    AudioFacade,
    ChunksFacade,
    DayCycleFacade,
    Disposer,
    EventHandler,
    FlagsApi,
    FlagValue,
    GeomApi,
    LogFacade,
    PickupsFacade,
    PlayerFacade,
    ScriptContext,
    UiFacade,
    VoxelCoord,
    WeatherFacade,
    ZoneFacade,
} from './types'
import type { ScriptRuntime } from './runtime'

/** Returned by `player.position` when the player entity doesn't
 *  exist. Every AABB / distance check using these coords yields false
 *  (NaN propagates through comparisons), so script handlers don't
 *  need explicit null guards. Authors who want to know explicitly
 *  whether the player exists can read `player.alive`. */
const NULL_POSITION: VoxelCoord = Object.freeze({ x: NaN, y: NaN, z: NaN }) as VoxelCoord

export interface BindingsDeps {
    runtime: ScriptRuntime
    audio: AudioFacade
    chunks: ChunksFacade
    player: PlayerFacade
    pickups: PickupsFacade
    zone: ZoneFacade
    log: LogFacade
    ui?: UiFacade
    dayCycle?: DayCycleFacade
    weather?: WeatherFacade
    /** Backing store for `flags.get / set`. Owned by the script engine
     *  system so it can persist into level metadata on save. */
    flags: Map<string, FlagValue>
}

export function buildScriptContext(deps: BindingsDeps): ScriptContext {
    const { runtime, audio, chunks, player, pickups, zone, log, flags } = deps
    const ui = deps.ui ?? NOOP_UI
    const dayCycle = deps.dayCycle ?? NOOP_DAY_CYCLE
    const weather = deps.weather ?? NOOP_WEATHER

    // `on(...)` has two shapes: with filter object, or without (for
    // string-named custom events). Detect by checking arg 2's type —
    // the runtime itself only cares about (event, filter, handler).
    function on(
        event: string,
        filterOrHandler: object | EventHandler,
        handlerOrOpts?: EventHandler | { once?: boolean },
        maybeOpts?: { once?: boolean },
    ): Disposer {
        if (typeof filterOrHandler === 'function') {
            // on(event, handler, opts?)
            return runtime.on(event, undefined, filterOrHandler as EventHandler,
                handlerOrOpts as { once?: boolean } | undefined)
        }
        // on(event, filter, handler, opts?)
        return runtime.on(event, filterOrHandler, handlerOrOpts as EventHandler, maybeOpts)
    }

    const flagsApi: FlagsApi = {
        get(name) {
            return flags.get(name)
        },
        set(name, value) {
            const previousValue = flags.get(name)
            flags.set(name, value)
            // Cheap cross-script observability: any script can listen
            // for `on('flag.changed', { name: 'quest.x' }, ...)`
            // instead of polling `flags.get` each tick. Skip emission
            // when the value is unchanged so a handler that writes the
            // current value back doesn't fire a noisy self-event.
            if (previousValue !== value) {
                runtime.emit('flag.changed', { name, value, previousValue })
            }
        },
    }

    const ctx: ScriptContext = {
        on: on as ScriptContext['on'],
        emit: (event, data) => runtime.emit(event, data),
        once: <E = unknown>(event: string, filter?: object) => runtime.once<E>(event, filter),
        wait: (seconds) => runtime.wait(seconds),
        log: (msg, kind) => log.log(msg, kind),

        player: {
            get position() { return player.getPosition() ?? NULL_POSITION },
            get alive() { return player.getPosition() !== null },
            get inventory() {
                return {
                    get gold() { return player.getGold() },
                }
            },
            teleport(x, y, z) { player.teleport(x, y, z) },
            kill(reason) { player.kill(reason) },
        },

        chunks: {
            getBlock: (x, y, z) => chunks.getBlock(x, y, z),
            setBlock: (x, y, z, b) => chunks.setBlock(x, y, z, b),
            fillBlocks: (min, max, b) => chunks.fillBlocks(min, max, b),
        },

        audio: {
            play: (id, opts) => audio.play(id, opts),
            stop: (handleOrId, opts) => audio.stop(handleOrId, opts),
        },

        pickups: {
            spawn: (kind, pos, opts) => pickups.spawn(kind, pos, opts),
        },

        flags: flagsApi,

        time: {
            get now() { return runtime.now },
            get tick() { return runtime.tick },
            get delta() { return runtime.delta },
        },

        zone: {
            contains(zoneId, who = 'player') {
                return zone.contains(zoneId, who)
            },
            exists(zoneId) { return zone.exists(zoneId) },
            isActive(zoneId) { return zone.isActive(zoneId) },
            setActive(zoneId, active) { return zone.setActive(zoneId, active) },
        },

        geom: makeGeomApi(),

        ui: {
            say: (targetId, message, opts) => ui.say(targetId, message, opts),
        },

        dayCycle: {
            get hour() { return dayCycle.getHour() },
            get enabled() { return dayCycle.isEnabled() },
            setHour(h) { dayCycle.setHour(h) },
            setEnabled(on) { dayCycle.setEnabled(on) },
            setSpeed(sec) { dayCycle.setSpeed(sec) },
        },

        weather: {
            setRain(on) { weather.setRain(on) },
            setSnow(on) { weather.setSnow(on) },
            setLightning(on) { weather.setLightning(on) },
            applyPreset(id) { return weather.applyPreset(id) },
            setZoneEnabled(zoneId, on) { return weather.setZoneEnabled(zoneId, on) },
            isZoneEnabled(zoneId) { return weather.isZoneEnabled(zoneId) },
        },

        random: (min, max) => runtime.random(min, max),
    }

    return ctx
}

const NOOP_UI: UiFacade = {
    say() {},
}

const NOOP_DAY_CYCLE: DayCycleFacade = {
    getHour() { return 12 },
    setHour() {},
    setEnabled() {},
    isEnabled() { return false },
    setSpeed() {},
}

const NOOP_WEATHER: WeatherFacade = {
    setRain() {},
    setSnow() {},
    setLightning() {},
    applyPreset() { return false },
    setZoneEnabled() { return false },
    isZoneEnabled() { return false },
}

function makeGeomApi(): GeomApi {
    return {
        box(min, max, point) {
            // Inclusive min, exclusive max — same convention zones use.
            return point.x >= min.x && point.x < max.x
                && point.y >= min.y && point.y < max.y
                && point.z >= min.z && point.z < max.z
        },
        distSq(a, b) {
            const dx = a.x - b.x
            const dy = a.y - b.y
            const dz = a.z - b.z
            return dx * dx + dy * dy + dz * dz
        },
    }
}

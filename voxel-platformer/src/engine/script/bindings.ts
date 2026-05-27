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
    Disposer,
    EventHandler,
    FlagsApi,
    FlagValue,
    LogFacade,
    PickupsFacade,
    PlayerFacade,
    ScriptContext,
    ZoneFacade,
} from './types'
import type { ScriptRuntime } from './runtime'

export interface BindingsDeps {
    runtime: ScriptRuntime
    audio: AudioFacade
    chunks: ChunksFacade
    player: PlayerFacade
    pickups: PickupsFacade
    zone: ZoneFacade
    log: LogFacade
    /** Backing store for `flags.get / set`. Owned by the script engine
     *  system so it can persist into level metadata on save. */
    flags: Map<string, FlagValue>
}

export function buildScriptContext(deps: BindingsDeps): ScriptContext {
    const { runtime, audio, chunks, player, pickups, zone, log, flags } = deps

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
            flags.set(name, value)
        },
    }

    const ctx: ScriptContext = {
        on: on as ScriptContext['on'],
        emit: (event, data) => runtime.emit(event, data),
        once: <E = unknown>(event: string, filter?: object) => runtime.once<E>(event, filter),
        wait: (seconds) => runtime.wait(seconds),
        log: (msg, kind) => log.log(msg, kind),

        player: {
            get position() { return player.getPosition() },
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
        },

        zone: {
            contains(zoneId, who = 'player') {
                return zone.contains(zoneId, who)
            },
        },

        random: (min, max) => runtime.random(min, max),
    }

    return ctx
}

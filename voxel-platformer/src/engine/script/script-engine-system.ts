/**
 * Script engine — ECS system + top-level factory.
 *
 * Stitches the four other files in this directory into one System the
 * `Engine` can register:
 *
 *   - `runtime.ts`   ↪ the event / wait / timer kernel
 *   - `bindings.ts`  ↪ the `ScriptContext` glue
 *   - `compile.ts`   ↪ `AsyncFunction` wrapper
 *   - `types.ts`     ↪ shared shapes
 *
 * `init()` compiles every enabled script and emits `level-start`.
 * `update()` advances sim-time + ticks the runtime (which drains the
 * wait queue and fires due timer subscriptions). The factory's
 * returned object also exposes `apply()` for the editor's re-run
 * button (Slice 2 wiring) and `state` for tests / introspection.
 *
 * Slice 1 deliberately does not wire `zone-enter / zone-exit / input
 * / pickup-taken / player.died` — those become emitter calls from
 * the respective systems in Slice 3. Custom (string-named) events,
 * `level-start`, `level.reset`, and `timer` work today.
 */

import { FixedOrder } from '../ecs/systems/orders'
import type { System } from '../ecs/systems/system'
import { consumeScriptTriggerEvents, type GameWorld, type ScriptTriggerEvent } from '../ecs/world'
import { buildScriptContext } from './bindings'
import { compileScript, type CompileFailure, type CompileSuccess } from './compile'
import { createRuntime, type ScriptRuntime } from './runtime'
import type {
    AudioFacade,
    ChunksFacade,
    DayCycleFacade,
    FlagValue,
    LogFacade,
    PickupsFacade,
    PlayerFacade,
    ScriptContext,
    ScriptEntry,
    UiFacade,
    WeatherFacade,
    ZoneFacade,
} from './types'

export interface ScriptEngineSystemOptions {
    audio: AudioFacade
    chunks: ChunksFacade
    player: PlayerFacade
    pickups: PickupsFacade
    zone: ZoneFacade
    log: LogFacade
    ui?: UiFacade
    /** Optional. When omitted, scripts call `dayCycle.*` and see
     *  bindings.ts's NOOP_DAY_CYCLE (returns midday, ignores writes). */
    dayCycle?: DayCycleFacade
    /** Optional. When omitted, `weather.*` is a noop returning false. */
    weather?: WeatherFacade
    /** Pulled fresh on every `apply()` / `init()` so the editor can mutate
     *  the script list without re-creating the system. */
    getScripts: () => readonly ScriptEntry[]
    /** Optional seed for the deterministic RNG. Defaults to a fixed
     *  number so two runs of the same level emit the same `random()`
     *  sequence. */
    rngSeed?: number
    /** Where to bubble script errors. Defaults to `console.error`. The
     *  editor's Logic tab (Slice 2) will plug in a richer reporter. */
    onScriptError?: (entry: ScriptEntry, where: string, err: unknown) => void
}

/** What the factory returns. Implements `System` so the engine can
 *  schedule it; adds `apply()` and a small introspection bag for the
 *  editor + tests. */
export interface ScriptEngineSystem extends System {
    /** Tear down every handler, cancel every wait, re-compile every
     *  enabled script, re-emit `level-start`. Idempotent. */
    apply(): void
    /** Read-only handles useful from tests + the editor's status
     *  panel. */
    readonly runtime: ScriptRuntime
    readonly flags: ReadonlyMap<string, FlagValue>
    readonly broken: ReadonlyMap<string, BrokenScriptInfo>
}

export interface BrokenScriptInfo {
    entry: ScriptEntry
    /** 'parse' = `new AsyncFunction` threw on bad syntax;
     *  'runtime' = the body's Promise rejected. Two phases the editor
     *  shows differently. */
    phase: 'parse' | 'runtime'
    error: Error
}

export function createScriptEngineSystem(opts: ScriptEngineSystemOptions): ScriptEngineSystem {
    const runtime = createRuntime(opts.rngSeed ?? 0xdeadbeef)
    const flags = new Map<string, FlagValue>()
    const broken = new Map<string, BrokenScriptInfo>()
    const onScriptError = opts.onScriptError ?? defaultScriptError
    runtime.onError((where, err) => onScriptError(syntheticEntry(where), where, err))

    // Single shared context. `apply()` resets the runtime in place;
    // closures inside ctx that read runtime state automatically pick up
    // the new sim-time / RNG without rebuilding.
    const ctx: ScriptContext = buildScriptContext({
        runtime,
        audio: opts.audio,
        chunks: opts.chunks,
        player: opts.player,
        pickups: opts.pickups,
        zone: opts.zone,
        log: opts.log,
        ui: opts.ui,
        dayCycle: opts.dayCycle,
        weather: opts.weather,
        flags,
    })

    function compileAll(): void {
        broken.clear()
        for (const entry of opts.getScripts()) {
            if (entry.enabled === false) continue
            const result: CompileSuccess | CompileFailure = compileScript(
                entry,
                ctx,
                (broken_entry, err) => {
                    broken.set(broken_entry.id, {
                        entry: broken_entry,
                        phase: 'runtime',
                        error: err instanceof Error ? err : new Error(String(err)),
                    })
                    onScriptError(broken_entry, 'compile.runtime', err)
                },
            )
            if (!result.ok) {
                broken.set(entry.id, { entry, phase: 'parse', error: result.error })
                onScriptError(entry, 'compile.parse', result.error)
            }
        }
    }

    // Death watchdog. `world.deathSignal` is set-once and never
    // cleared until page reload, so we detect the transition by
    // remembering the value we last observed and firing exactly once
    // when it goes from null → set. apply() resets this so a fresh
    // load doesn't suppress the next death event.
    let lastDeathSignal: string | null = null

    function apply(): void {
        // Emit level.reset BEFORE clearing subs so any currently-
        // registered handler can react (e.g. stop a music loop).
        runtime.emit('level.reset')
        runtime.reset(opts.rngSeed ?? 0xdeadbeef)
        lastDeathSignal = null
        compileAll()
        runtime.emit('level-start')
    }

    function dispatchScriptTriggers(world: GameWorld | null | undefined): void {
        if (!world) return
        const events = consumeScriptTriggerEvents(world)
        for (let i = 0; i < events.length; i++) emitTriggerEvent(events[i]!)
        // Death watchdog: emit once when the signal transitions to set.
        const ds = world.deathSignal ?? null
        if (ds && ds !== lastDeathSignal) {
            runtime.emit('player.died', { reason: ds })
        }
        lastDeathSignal = ds
    }

    function emitTriggerEvent(evt: ScriptTriggerEvent): void {
        switch (evt.kind) {
            case 'zone-enter':
            case 'zone-exit':
                runtime.emit(evt.kind, {
                    zoneId: evt.zoneId,
                    source: evt.source,
                    point: evt.point,
                    entityId: evt.entityId,
                })
                return
            case 'pickup-taken':
                runtime.emit('pickup-taken', {
                    // Spelled `kind` here (not `pickupKind`) so the
                    // filter shape `on('pickup-taken', { kind: 'coin' })`
                    // matches naturally — the queue-level payload uses
                    // `pickupKind` to avoid colliding with the
                    // discriminator.
                    kind: evt.pickupKind,
                    pickupId: evt.pickupId,
                    amount: evt.amount,
                    position: evt.position,
                    entityId: evt.entityId,
                })
                return
            case 'player.died':
                runtime.emit('player.died', { reason: evt.reason })
                return
            case 'input':
                runtime.emit('input', {
                    action: evt.action,
                    edge: evt.edge,
                    targetId: evt.targetId,
                    zoneId: evt.zoneId,
                    point: evt.point,
                    entityId: evt.entityId,
                })
                return
        }
    }

    const system: ScriptEngineSystem = {
        name: 'scriptEngine',
        fixed: true,
        // After everything else has settled in a tick: physics done,
        // pickups collected, pistons stepped, deaths registered.
        // Scripts read final state and react to it.
        order: FixedOrder.postPhysics + 5,
        init(world: GameWorld): void {
            compileAll()
            runtime.emit('level-start')
            // Producer systems may have already pushed events in init
            // (rare but possible). Drain whatever's there.
            dispatchScriptTriggers(world)
        },
        update(world: GameWorld, dt: number): void {
            runtime.advance(dt)
            dispatchScriptTriggers(world)
        },
        dispose(): void {
            runtime.reset()
            flags.clear()
            broken.clear()
            lastDeathSignal = null
        },
        apply,
        runtime,
        flags,
        broken,
    }
    return system
}

function defaultScriptError(entry: ScriptEntry, where: string, err: unknown): void {
    // eslint-disable-next-line no-console
    console.error(`[script ${entry.name} @ ${where}]`, err)
}

/** When the runtime's `onError` fires it doesn't know which entry the
 *  handler came from (subscriptions are anonymous in the runtime).
 *  Wrap into a synthetic entry so the unified error path has a name to
 *  print. The editor's Slice 2 reporter will replace this with a real
 *  lookup once handlers are tagged by source. */
function syntheticEntry(where: string): ScriptEntry {
    return { id: `runtime:${where}`, name: `runtime ${where}`, source: '' }
}

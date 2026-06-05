/**
 * Script runtime — the dispatcher.
 *
 * Owns the event subscription list, the wait queue, the sim-time clock,
 * the seeded RNG. Knows nothing about the world, the editor, or the
 * game — it's a small reactive kernel that the bindings + ECS system
 * compose around.
 *
 * Cross-script messaging, the `level-start` / `level.reset` lifecycle
 * events, the `timer` recurring event, and the `wait(seconds)`
 * coroutine all live here. Built-in events that need engine state
 * (`zone-enter`, `pickup-taken`, `input`, `player.died`) are emitted
 * from the systems that detect them — the runtime just forwards.
 */

import type { Disposer, EventHandler } from './types'

interface Subscription {
    id: number
    event: string
    filter?: Record<string, unknown>
    handler: EventHandler
    /** `once: true` removes the subscription after the first matching
     *  firing. Used for both author-facing `opts.once` and for `once()`
     *  Promise resolution. */
    once: boolean
    /** Set when the subscription has been disposed; we mark instead of
     *  splicing eagerly so the in-flight `emit` walk doesn't shift the
     *  iteration window. The next sweep removes them. */
    cancelled: boolean
    /** Per-event scratch. `timer` uses this to remember its next firing
     *  deadline. Other event kinds leave it empty. */
    state: { nextFireAt?: number; period?: number; oneshot?: boolean }
}

interface WaitEntry {
    deadline: number
    resolve: () => void
    /** Set on Apply / runtime reset so the resolver short-circuits
     *  instead of waking the script after its closures have been
     *  invalidated. */
    cancelled: boolean
}

/** What `createRuntime()` returns. The ECS system calls `tick()` each
 *  fixed step; the bindings expose `on / emit / once / wait` to
 *  scripts; the system calls `reset()` on Apply. */
export interface ScriptRuntime {
    on(event: string, filter: object | undefined, handler: EventHandler, opts?: { once?: boolean }): Disposer
    emit(event: string, data?: unknown): void
    once<E = unknown>(event: string, filter?: object): Promise<E>
    wait(seconds: number): Promise<void>

    /** Sim-time getter; bindings expose this via `time.now`. */
    readonly now: number
    /** Integer tick count since last reset. */
    readonly tick: number
    /** Seconds elapsed during the most recent `advance(dt)` call.
     *  Zero before the first tick. */
    readonly delta: number

    /** Seeded uniform in `[min, max)`. */
    random(min: number, max: number): number

    /** Called by the ECS system each fixed step. Advances `simTime`,
     *  drains the wait queue, fires due timer subscriptions. */
    advance(dt: number): void

    /** Called by the ECS system on Apply (and at construction). Cancels
     *  every in-flight wait, drops every subscription, resets sim-time
     *  + RNG. Emits `level.reset` for any listener registered *after*
     *  the reset to react to. */
    reset(seed?: number): void

    /** Diagnostic — `console.error("[script ...]")` by default, but
     *  overridable so tests can capture errors. */
    onError(handler: (where: string, err: unknown) => void): void
}

export function createRuntime(initialSeed: number = 0xdeadbeef): ScriptRuntime {
    const subs: Subscription[] = []
    const waits: WaitEntry[] = []
    let simTime = 0
    let simTick = 0
    let lastDt = 0
    let nextSubId = 1
    let rng = mulberry32(initialSeed)
    let errorHandler: (where: string, err: unknown) => void = (where, err) => {
        // Default: bubble to the console with a clear prefix. We don't
        // throw — a single broken handler must not kill the loop.
        // eslint-disable-next-line no-console
        console.error(`[script ${where}]`, err)
    }

    function on(
        event: string,
        filter: object | undefined,
        handler: EventHandler,
        opts?: { once?: boolean },
    ): Disposer {
        const sub: Subscription = {
            id: nextSubId++,
            event,
            filter: filter as Record<string, unknown> | undefined,
            handler,
            once: opts?.once === true,
            cancelled: false,
            state: {},
        }
        if (event === 'timer' && sub.filter) {
            const period = Number((sub.filter as { periodSeconds?: number }).periodSeconds ?? 0)
            sub.state.period = period > 0 ? period : 0
            sub.state.nextFireAt = simTime + sub.state.period
            sub.state.oneshot = (sub.filter as { oneshot?: boolean }).oneshot === true
        }
        subs.push(sub)
        return () => { sub.cancelled = true }
    }

    function emit(event: string, data?: unknown): void {
        // Walk a snapshot — handlers may register / dispose / emit more
        // during dispatch; we don't want to revisit those mid-loop.
        const snapshot = subs.slice()
        for (const sub of snapshot) {
            if (sub.cancelled) continue
            if (sub.event !== event) continue
            if (!matchFilter(sub.filter, data)) continue
            if (sub.once) sub.cancelled = true
            invoke(sub, data, event)
        }
        sweepCancelled()
    }

    function once<E = unknown>(event: string, filter?: object): Promise<E> {
        return new Promise<E>((resolve) => {
            on(event, filter, (e) => resolve(e as E), { once: true })
        })
    }

    function wait(seconds: number): Promise<void> {
        const deadline = simTime + Math.max(0, seconds)
        return new Promise<void>((resolve) => {
            waits.push({ deadline, resolve, cancelled: false })
        })
    }

    function advance(dt: number): void {
        if (!Number.isFinite(dt) || dt <= 0) return
        lastDt = dt
        simTime += dt
        simTick += 1

        // 1. Drain wait queue. The list isn't sorted (cheap to append,
        //    expensive to sort); a linear scan is fine while N is
        //    small. If wait counts explode later we can switch to a
        //    sorted heap.
        for (let i = waits.length - 1; i >= 0; i--) {
            const w = waits[i]!
            if (w.cancelled) {
                waits.splice(i, 1)
                continue
            }
            if (w.deadline <= simTime) {
                waits.splice(i, 1)
                w.resolve()
            }
        }

        // 2. Fire any timer subscriptions whose deadline has passed.
        const snapshot = subs.slice()
        for (const sub of snapshot) {
            if (sub.cancelled || sub.event !== 'timer') continue
            const period = sub.state.period ?? 0
            if (period <= 0) continue
            let next = sub.state.nextFireAt ?? simTime
            while (next <= simTime) {
                invoke(sub, { tick: simTick }, 'timer')
                if (sub.state.oneshot) {
                    sub.cancelled = true
                    break
                }
                next += period
            }
            sub.state.nextFireAt = next
        }
        sweepCancelled()
    }

    function reset(seed?: number): void {
        // Cancel waits so any awaiter that was suspended doesn't wake
        // into a stale closure. The Promises stay unresolved forever —
        // GC reclaims them once the script source is re-evaluated and
        // the closures drop their references.
        for (const w of waits) w.cancelled = true
        waits.length = 0

        // Same story for subscriptions. The fresh compile will
        // re-register every handler the new source asks for.
        for (const sub of subs) sub.cancelled = true
        subs.length = 0

        simTime = 0
        simTick = 0
        lastDt = 0
        if (seed !== undefined) rng = mulberry32(seed)

        // Emit AFTER clearing so handlers registered during the reset
        // (rare but legal) still see a clean queue. We don't dispatch
        // here — by definition there are no subscribers yet.
        // The system layer calls `emit('level-start')` after compiling
        // the fresh source; nothing in the runtime needs to fire
        // 'level.reset' itself.
    }

    function onError(handler: (where: string, err: unknown) => void): void {
        errorHandler = handler
    }

    function invoke(sub: Subscription, data: unknown, where: string): void {
        try {
            const result = sub.handler(data)
            if (result && typeof (result as Promise<unknown>).then === 'function') {
                ;(result as Promise<unknown>).catch((err) => errorHandler(`${where}#${sub.id}`, err))
            }
        } catch (err) {
            errorHandler(`${where}#${sub.id}`, err)
        }
    }

    function sweepCancelled(): void {
        for (let i = subs.length - 1; i >= 0; i--) {
            if (subs[i]!.cancelled) subs.splice(i, 1)
        }
    }

    return {
        on,
        emit,
        once,
        wait,
        get now() { return simTime },
        get tick() { return simTick },
        get delta() { return lastDt },
        random: (min, max) => min + rng() * (max - min),
        advance,
        reset,
        onError,
    }
}

function matchFilter(filter: Record<string, unknown> | undefined, data: unknown): boolean {
    if (!filter) return true
    if (data === null || typeof data !== 'object') return false
    for (const key in filter) {
        if ((data as Record<string, unknown>)[key] !== filter[key]) return false
    }
    return true
}

/** mulberry32 — small, well-distributed seeded PRNG. The same family
 *  the scatter brush already uses, so the codebase is consistent. */
function mulberry32(seed: number): () => number {
    let t = seed >>> 0
    return () => {
        t = (t + 0x6d2b79f5) >>> 0
        let r = t
        r = Math.imul(r ^ (r >>> 15), r | 1)
        r ^= r + Math.imul(r ^ (r >>> 7), r | 61)
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
}

# Script Engine — Design Doc

Status: **Slices 1, 1.5, 1.6, 2 implemented** on `feature/surface-improve`.
Authors can now (a) load `.js` files or paste snippets into the editor's
**Logic** tab, (b) react to zone enter/exit, pickup-taken, player-died,
and input events, (c) call into world state via the host bindings
(`chunks`, `audio`, `pickups`, `pistons`, `stones`, `player`, `flags`,
`ui`, `dayCycle`, `weather`, `zone`, `geom`). See `script-engine-slice-1-5-review.md`
and the §11 implementation status below.

Scripts are how the editor authors quests, cinematics, and event-driven
gameplay logic on top of the existing zone / pickup / piston systems.
An earlier draft of this doc proposed a JSON IR plus a rule-sheet UI;
that draft has been replaced after a planning-pass redirect:

- Scripts are **plain JavaScript files**, written in any IDE.
- The engine compiles them at level load with `new AsyncFunction(...)`
  and runs them in the same realm as everything else.
- The editor only **loads files from disk or accepts pasted source** —
  no in-engine code editor, no node graphs, no rule sheets.
- We trust the author. This is single-player offline content authored
  by the level designer, running on their own machine. The same code
  could be pasted into the browser devtools console with the same
  effect. No sandbox.
- Determinism is **best-effort**, not strict. Sufficient for quests
  and cinematics, not necessarily for a frame-exact replay recorder
  (revisit if and when replay ships).

The rest of this doc covers the runtime, the API surface, the two
editor authoring affordances, and the migration path from
`ZoneScriptAction`.

---

## 1. Why this shape

The first proposal centred on a JSON IR + rule-sheet UI. It was right
about three things:

- Scripts need conditions, loops, time, and side state.
- Triggers (zone enter / exit / timer / pickup / input) are a finite
  list worth keeping as named registration sites.
- The host-binding registry is the contract every script ultimately
  talks to.

It was wrong about two:

- **Sandboxing.** Scripts are written by the same person who runs
  them. The threat model that justifies a custom interpreter doesn't
  apply.
- **Authoring UI.** Building a node graph or rule-sheet editor inside
  the engine is a major project on its own, and we don't want either
  — VSCode is already the right tool, and `<textarea>` is fine for
  short snippets.

Throwing both out collapses the design from ~4 weeks of work to
~1.5 weeks. The interesting parts — the API surface, the coroutine
model, the trigger taxonomy — survive intact.

---

## 2. Runtime architecture

### 2.1 Overall flow

```
   .js text  ──load──▶  level binary  ──load──▶  AsyncFunction(...)
                            │                          │
                            │                          ▼
                            │              registers handlers via
                            │                   on(trigger, fn)
                            ▼                          │
                       ScriptEngineSystem  ◀───────────┘
                            │
                            ├──▶ each tick: drain ready waits
                            ├──▶ each tick: dispatch trigger events
                            └──▶ exposes engine API via `ctx`
```

### 2.2 Compilation

One `AsyncFunction` call per script per level load. The wrapper
destructures `ctx` into locals so scripts can write natural code with
no `ctx.` prefix everywhere.

```ts
async function compileScript(entry: ScriptEntry, ctx: ScriptContext): Promise<void> {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
    const fn = new AsyncFunction('ctx', `
        "use strict";
        const { on, once, emit, wait, log,
                player, chunks, pickups, pistons, stones, audio,
                flags, time, zone, geom, ui,
                dayCycle, weather, travel, level, random } = ctx;
        ${entry.source}
    `)
    try {
        await fn(ctx)
    } catch (err) {
        markBroken(entry, err)
    }
}
```

`AsyncFunction` lets the script use top-level `await`, including
`await wait(...)` at module body level if a script wants to do its
work entirely synchronously instead of through handlers. The common
shape is still: top-level body registers handlers, handlers do the
work.

### 2.3 The coroutine model

`wait(seconds)` returns a Promise the engine resolves once sim-time
catches up.

```ts
function wait(seconds: number): Promise<void> {
    const deadline = world.simTime + Math.max(0, seconds)
    return new Promise(resolve => waitQueue.push({ deadline, resolve }))
}
```

On every fixed-step tick, after the engine advances `simTime`, it
walks `waitQueue` (sorted by deadline) and resolves any pending wait
whose deadline has passed. Because waits are driven by `world.simTime`
— the fixed-step clock — scripts pause / step / replay in lockstep
with the simulation. Pausing the engine pauses every wait in flight.
`performance.now()` is never read by the engine API.

### 2.4 Trigger dispatch

A single `ScriptEngineSystem` lives in the fixed-step graph. Per tick:

1. Drain `waitQueue` for any deadlines that fired.
2. Drain `world.scriptTriggerEvents` (filled by `ZoneTriggerSystem`,
   the input system, the timer scheduler, the pickup-collected hook).
3. For each event, look up matching handlers and kick them off as
   async invocations. Multiple handlers per trigger fire in
   registration order.
4. The microtask queue drains naturally between system updates.

Handlers are async functions; the engine doesn't `await` them
(handlers may run for many ticks via `wait`). It kicks them off and
lets them resolve in their own time. Exceptions surface as
`console.error("[script <name>] ...")` and do not kill the engine.

### 2.5 Determinism — what we have and what we don't

A real `AsyncFunction` runs on the JS microtask queue. Microtasks
inside a tick run in well-defined order, so two runs from the same
state with the same inputs produce the same observable events — **as
long as scripts only use the engine API**. Specifically, the API
guarantees:

- `time.now` / `time.tick` are driven by `world.simTime`.
- `random(min, max)` uses a seeded RNG; same seed → same sequence.
- `wait` deadlines are sim-time deadlines.

A script that calls `Math.random()` or `Date.now()` directly breaks
determinism. We document this; we don't enforce it. For frame-exact
replay we'd additionally need to snapshot the wait queue + handler
state into the replay log — out of scope for v1.

### 2.6 Apply vs. flags — what resets and what survives

When the editor presses **Apply** (or a test calls
`sys.apply()`), the runtime tears down every handler and re-compiles
every enabled script. The Apply path is *not* a level reload — it's
a hot-reload of the script logic on top of the same simulation. The
explicit contract:

- **Reset on Apply**: subscriptions, in-flight `wait()` promises,
  `time.now`, `time.tick`, `time.delta`, the seeded RNG, the
  "last death signal" watchdog.
- **Preserved across Apply**: `flags` (persistent authoring state),
  the world (chunks, entities, positions, inventory), `level.reset`
  is emitted *before* clearing subs so currently-registered handlers
  can run final cleanup. `level-start` is emitted *after* the fresh
  compile so the new handlers see the start signal.

A script that does `if (time.now < 0.5) doStartupStuff()` will
re-fire its startup work on Apply — that's why we say "Apply IS the
restart event," and why `on('level-start', ...)` is the safer hook
for one-shot bootstrap code that should re-run on hot-reload.

---

## 3. The engine API

The full surface exposed on `ctx`. The script wrapper destructures
the common bits into locals so the source reads naturally.

### 3.1 Trigger registration: `on`, `emit`, `once`

Three top-level primitives. Built-in events (zone enter, pickup
taken, level start, etc.) and author-defined custom events share the
same name space — `on('quest.amulet.complete', ...)` is registered
and dispatched the same way as `on('zone-enter', ...)`.

```ts
// Register a handler. Returns a Disposer — call it to unregister.
on(event: string, filter?: object, handler: Handler,
   opts?: { once?: boolean }): Disposer

// Emit a custom event. Wakes every matching `on` listener and
// resolves every matching `once` Promise.
emit(event: string, data?: unknown): void

// Sugar for "wait for the next firing." Returns the event payload.
// Disposes itself after resolving.
once(event: string, filter?: object): Promise<Event>
```

The `once: true` opt-in on `on(...)` is the common case for
first-visit zones, intro cinematics, and other one-shot scripts. It
fires the handler exactly once and disposes the registration —
saving the author from writing `if (flags.get('foo')) return; flags.set('foo', true);`
at the top of every body.

`once` may be passed two equivalent ways — as the 4th `opts` argument,
or co-located inside the filter object — and the binding layer lifts it
onto registration either way:

```js
on('zone-enter', { zoneId: 'grove' }, h, { once: true })  // opts arg
on('zone-enter', { zoneId: 'grove', once: true }, h)      // in the filter
```

Because the runtime matches every *other* filter key by strict equality
against the event payload, `once` is a **reserved filter key**: it is
never matched against payload data. (Before this was lifted, the
second form silently never fired — `event.once` doesn't exist, so the
strict-equality match failed. See `script-engine-syntax-review.md`.)
That same constraint — filters carry data-match keys only, never
registration/throttle options — is why there is no `zone-inside`
`{ everyTicks }` trigger: a per-subscription throttle can't live in the
filter object. The `await wait(n)` + `zone.contains(...)` pattern covers
the "still inside N seconds later" case without one.

#### Built-in events

| Event | Filter | Handler receives |
| ----- | ------ | ---------------- |
| `level-start` | — | — |
| `zone-enter` | `{ zoneId, source? }` | `{ entityId, zoneId, source, point }` |
| `zone-exit` | `{ zoneId, source? }` | same as `zone-enter` |
| `timer` | `{ periodSeconds, oneshot? }` | `{ tick }` |
| `pickup-taken` | `{ pickupId?, kind? }` | `{ pickupId, kind, position, amount? }` |
| `input` | `{ action, edge, targetId? }` | `{ action, edge, targetId?, zoneId?, point?, entityId? }` |
| `player.died` | — | `{ reason? }` |
| `flag.changed` | `{ name }` | `{ name, value, previousValue }` |
| `level.reset` | — | — fires when **Apply** re-runs scripts |

Custom events: any string the author picks. `emit(name, data)` from
one script wakes `on(name, ...)` in another. `once(name)` resolves on
the next emission. No filter object for custom events — the `data`
payload is whatever the emitter passed.

#### Cancellation pattern

Long-running handlers (cinematics, trap chains) can lose meaning if
the player dies mid-sequence or the editor presses **Apply**. The
recommended pattern uses `Promise.race` against the built-in
lifecycle events:

```js
on('zone-enter', { zoneId: 'trap.east' }, async () => {
    const aborted = Promise.race([once('player.died'), once('level.reset')])
    const sequence = (async () => {
        for (let i = 0; i < 5; i++) {
            await wait(0.15)
            chunks.setBlock(30 + i, 5, 14, 0)
        }
    })()
    await Promise.race([sequence, aborted])
})
```

**Apply also calls every Disposer** returned by `on(...)`, so most
scripts don't need explicit cleanup — Apply tears down handlers and
re-runs each script's top-level body, which re-registers fresh
handlers. The race pattern above only matters when a single handler
spans many seconds and might be interrupted mid-run.

### 3.2 World API

```ts
// Player
player.position             // { x, y, z } — getter, always fresh.
                            //   When no player entity exists right now
                            //   (mid-respawn, pre-spawn), the coords
                            //   are NaN so AABB / distance tests return
                            //   false without explicit null guards.
player.alive                // boolean — explicit "is there a player"
                            //   flag for handlers that need it.
player.teleport(x, y, z)
player.kill(reason?: string)
player.checkpoint           // VoxelCoord | null — last setCheckpoint, or null
player.setCheckpoint(pos?: VoxelCoord)  // pos omitted ⇒ current player position
player.clearCheckpoint()    // forget the saved checkpoint
player.inventory.gold       // number — getter
player.inventory.arrows     // number — getter
player.inventory.count(id)  // durable item count, e.g. 'sun-shard'
player.inventory.has(id, n) // true when at least n items are held
player.inventory.list(category?) // snapshot of visible durable items
player.settings             // PlayerSettings snapshot — mutate via setters below
player.setSettings(patch)   // patch movement, inventory, torch, model, abilities
player.setAbility(name, on) // e.g. player.setAbility('bow', false)
player.setGold(amount)
player.setArrows(amount)
player.addInventoryItem(id, quantity?, opts?)
player.removeInventoryItem(id, quantity?)

// Voxel grid
chunks.getBlock(x, y, z): number
chunks.setBlock(x, y, z, block: number)
chunks.fillBlocks(min: VoxelCoord, max: VoxelCoord, block: number)

// Pickups — spawn returns a stable id you can pass to despawn.
pickups.spawn(kind: string, pos: VoxelCoord,
              opts?: {
                amount?: number; id?: string; label?: string;
                inventoryItem?: {
                  id?: string; name?: string; description?: string;
                  category?: 'quest' | 'consumables' | 'accessories' | 'tools' | 'resources';
                  icon?: 'quest-shard' | 'item' | 'gold' | 'arrows' | 'consumable' | 'accessory' | 'tool'
                }
              }): PickupId
pickups.despawn(id: PickupId): boolean  // true on success, false if not live
pickups.exists(id: PickupId): boolean

// Pistons — set/flip the runtime gate on a level-authored piston by id.
// Pistons without an authored id are silently invisible to scripts (so
// procedural levels can still register unnamed pistons safely). `flip`
// queues a force-flip that the next fixed tick consumes; on a physical
// piston already mid-travel it returns false rather than corrupting the
// active interpolation. `setEnabled(false)` freezes the piston in place
// — teleport voxel writes stay atomic, physical piston obstacle AABBs
// stay in the registry so a rider keeps standing on a frozen platform.
pistons.setEnabled(id: string, enabled: boolean): boolean   // false on unknown id
pistons.isEnabled(id: string): boolean
pistons.flip(id: string): boolean                           // false if unknown, disabled, or mid-physical-travel
pistons.list(): string[]                                    // enumerate ids in registration order

// Stones — direct physics stones plus editor-authored falling-stone spawners.
stones.spawn(pos: VoxelCoord,
             opts?: { id?: string; tier?: string; size?: number;
                      velocity?: VoxelCoord }): string
stones.remove(id: string): boolean
stones.exists(id: string): boolean
stones.setSpawnerEnabled(id: string, enabled: boolean): boolean
stones.isSpawnerEnabled(id: string): boolean
stones.triggerSpawner(id: string, count?: number): number
stones.listSpawners(): string[]

// Audio — `fade` cross-fades over N seconds on play / stop.
audio.play(soundId: string,
           opts?: { volume?: number; loop?: boolean; fade?: number }): SoundHandle
audio.stop(handleOrSoundId: SoundHandle | string,
           opts?: { fade?: number }): void

// Persistent level flags (saved with the level binary). Reads are
// always-live — two handlers in the same tick see each other's
// writes. Quests rely on this; the Lost Amulet example in
// `script-engine-examples.md` is the canonical case.
flags.get(name: string): number | string | boolean | undefined
flags.set(name: string, value: number | string | boolean): void

// Time + deterministic random
time.now                  // seconds since level start — getter
time.tick                 // integer fixed-tick count — getter
time.delta                // seconds elapsed in the most recent tick;
                          //   use for smooth interpolation in handlers
random(min: number, max: number): number

// Zone queries + activation toggle. `setActive` clones the existing
// zone with the new flag, so the readonly identity holds. Deactivating
// mid-overlap synthesises a `zone-exit` next tick.
zone.contains(zoneId: string, who?: 'player' | VoxelCoord): boolean
zone.exists(zoneId: string): boolean
zone.isActive(zoneId: string): boolean
zone.setActive(zoneId: string, active: boolean): boolean

// Day cycle — drives the ambient weather clock. Use `setEnabled(false)`
// to freeze the sky for a cinematic; `setHour` writes the in-world
// hour [0,24); `setSpeed(secondsPerDay)` controls cycle speed.
dayCycle.hour                    // getter
dayCycle.enabled                 // getter
dayCycle.setHour(hour: number): void
dayCycle.setEnabled(enabled: boolean): void
dayCycle.setSpeed(secondsPerDay: number): void

// Weather — toggle global rain/snow/lightning or apply a named preset
// from `WEATHER_PRESETS` ('clear', 'cloudy', 'rain', 'storm', 'snow',
// 'dawn'). Returns false on `applyPreset` if the id isn't registered.
weather.setRain(on: boolean): void
weather.setSnow(on: boolean): void
weather.setLightning(on: boolean): void
weather.applyPreset(presetId: string): boolean
weather.setZoneEnabled(zoneId: string, enabled: boolean): boolean
weather.isZoneEnabled(zoneId: string): boolean
weather.setZonePreset(zoneId: string, presetId: string): boolean

// Level metadata — read-only snapshot of the level the engine started
// against. `spawn` returns a fresh object on every read so mutating it
// can't change world state.
level.spawn                       // VoxelCoord getter — author-named spawn
level.size                        // number — XZ extent (block units)
level.name                        // string — editor-authored name, or 'demo'

// Travel — hot-swap to another project-library level without a browser
// reload. `arrivalId` names a destination-zone in the target level; when
// omitted the destination spawn is used. `reload` restarts the current
// location (same arrival semantics). No-ops on levels wired without a
// travel system.
travel.to(levelId: string, opts?: { arrivalId?: string }): void
travel.reload(opts?: { arrivalId?: string }): void

// Geometry helpers — pure, no world state. Use when you need an AABB
// test in a place that doesn't justify authoring a real zone (e.g. a
// computed bounding box around a runtime-placed prop).
geom.box(min: VoxelCoord, max: VoxelCoord, point: VoxelCoord): boolean
geom.distSq(a: VoxelCoord, b: VoxelCoord): number

// Coroutine primitive
wait(seconds: number): Promise<void>

// Log
log(message: string, kind?: 'info' | 'warn' | 'error'): void

// UI — popup bubbles. Multiple targets render in parallel; back-to-back
// `ui.say` calls to the SAME target queue and play sequentially when
// the current bubble expires. `ui.clear(targetId?)` dismisses bubbles
// early (per-target or all-at-once) — useful when the player walks
// away from an NPC mid-line.
ui.say(targetId: string, message: string, opts?: { seconds?: number }): void
ui.clear(targetId?: string): void
ui.dialogue({
  title?: string,
  npc?: { id?, name, avatar?, side? },
  player?: { id?, name, avatar?, side? },
  speakers?: [{ id?, name, avatar?, side? }],
  lines: [{
    speaker?: string,
    name?: string,
    avatar?: string,
    text: string,
    choices?: [{ id: string, text: string, disabled?: boolean }]
  }]
}): Promise<{ choiceId?, choiceIndex?, text? }>

// Trade — opens the NPC trade menu and applies a validated buy/sell
// transaction before resolving. V1 uses gold as currency and arrows as
// the first inventory-backed resource.
trade.open({
  id?: string,
  title?: string,
  npc?: { id?, name, avatar?, side? },
  currency?: 'gold',
  items: [{
    id: string,
    name: string,
    description?: string,
    resource: 'arrows',
    unitSize?: number,
    buyPrice?: number,
    sellPrice?: number,
    stock?: number,
    disabled?: boolean
  }]
}): Promise<
  | { status: 'bought', itemId: string, quantity: number, spent: { gold: number },
      gained: { arrows?: number }, inventory: { gold: number, arrows: number } }
  | { status: 'sold', itemId: string, quantity: number, gained: { gold: number },
      removed: { arrows?: number }, inventory: { gold: number, arrows: number } }
  | { status: 'cancelled' }
  | { status: 'unavailable', reason?: string, inventory?: { gold: number, arrows: number } }
>
```

Dialogue `avatar` values can use built-in replaceable PNG keys
(`keeper`, `player`, `sundial`, `book`, `npc`) or an explicit image path such
as `/avatars/merchant.png`. Unknown strings fall back to the labelled badge.

Example NPC shop:

```js
const result = await trade.open({
    title: "Keeper Arlen's Supplies",
    npc: { id: 'keeper', name: 'Keeper Arlen', avatar: 'keeper' },
    items: [{
        id: 'arrows.bundle',
        name: 'Arrow bundle',
        resource: 'arrows',
        unitSize: 5,
        buyPrice: 3,
        sellPrice: 1,
        stock: 20,
    }],
})
if (result.status === 'bought') ui.say(NPC_INTERACTION, 'Good hunting.')
```

Cross-script messaging uses the unified `on / emit / once` from §3.1
— there's no separate `signal.*` namespace.

### 3.3 TypeScript types for IDE authoring

`voxel-platformer/types/script-api.d.ts` is published alongside the
engine. A user dropping the file into their workspace gets
autocomplete, type checks, and inline docs for every API call —
without the engine having to ship a code editor.

```ts
// script-api.d.ts (excerpt)
type Disposer = () => void

declare function on(
    event: 'zone-enter',
    filter: { zoneId: string; source?: 'player' | 'arrow' | 'both' },
    handler: (event: ZoneEvent) => void | Promise<void>,
    opts?: { once?: boolean },
): Disposer
declare function on<E extends string>(   // overload: custom events
    event: E,
    handler: (data?: unknown) => void | Promise<void>,
    opts?: { once?: boolean },
): Disposer
declare function emit(event: string, data?: unknown): void
declare function once(event: string, filter?: object): Promise<unknown>
declare function wait(seconds: number): Promise<void>

declare const player: PlayerApi
declare const chunks: ChunksApi
// ...
```

---

## 4. Editor authoring

Two affordances, both writing into the same `scripts: ScriptEntry[]`
array on the level metadata.

### 4.1 File loader

A "Load script…" button in a new **Logic** tab (peer of `Edit / Sound
/ Visual FX / Props / Level / Help`). The button opens the browser's
file picker (`accept=".js,.mjs,.ts"`). The picked file's text becomes
a new `ScriptEntry`.

Each entry shows in the Logic tab as a row: filename, byte count, a
disabled-checkbox, and two buttons:

- **Reload** — reread the file (uses the File System Access API
  where available; falls back to "pick the file again" elsewhere).
  Lets the author keep editing in VSCode and pull updates back into
  the level without a full reboot.
- **Remove** — drop the entry.

### 4.2 Paste-in textarea

Below the loaded-file list: a `<textarea>` plus a name input and a
"Save snippet" button. User pastes code, names it, hits Save → new
entry. Pasted scripts are stored verbatim in the level binary;
reloading the level re-populates the textarea so the user can keep
iterating directly in the engine if they want.

This is the lighter-weight path for short snippets — the example
scripts in Appendix A are all 5–15 lines and fit comfortably without
a separate file.

### 4.3 Apply

Editing a textarea or reloading a file does **not** hot-swap the
running scripts. The user clicks **Apply** to re-run the level's
script pipeline:

1. Unregister every handler.
2. Cancel pending waits (they'd point at stale closures).
3. Re-run each enabled `ScriptEntry` as a fresh `AsyncFunction`.
4. Emit a `level-start` event so any `on('level-start', ...)`
   handlers fire again.

Apply runs on the editor's main loop; the user sees the new
behaviour immediately. The simulation does **not** restart — chunks,
positions, pickups stay where they were. This is intentional: it
makes iteration on cinematics fast (tweak the script → Apply →
re-enter the zone).

### 4.4 Failure surface

If a script's top-level body throws, the Logic tab marks the entry
with a red dot and shows the exception message in a small drawer.
Other scripts in the level keep running normally. Same pattern for
runtime exceptions inside handlers — the trace is shown in the row
that owns the handler.

---

## 5. Persistence

Scripts live in level metadata as plain strings.

```ts
interface ScriptEntry {
    id: string                  // stable, generated at save time
    name: string                // filename or user-chosen
    source: string              // raw JS / TS text
    /** True for entries loaded from a real file on disk. The
     *  Reload button is only offered when true. */
    fromFile?: boolean
    /** Path hint for the reload button (best-effort; some browsers
     *  don't expose paths through the file picker). */
    sourcePath?: string
    enabled?: boolean           // default true
}

interface EditorLevelMeta {
    // ... existing fields ...
    scripts?: ScriptEntry[]
}
```

The binary format gains one optional field. Old levels (no `scripts`
array) load as before; new levels carry their scripts inline.

---

## 6. Migration from `ZoneScriptAction`

On level load, if `meta.scripts` is absent and there are zones with
`script.actions`, the loader lowers each zone's actions to a
generated `ScriptEntry`:

```js
// __legacy_gate.east.trigger.js
on('zone-enter', { zoneId: 'gate.east.trigger' }, async () => {
    log("It's getting warm...")
    chunks.setBlock(14, 1, 22, 0)
})
```

Generated entries are marked `fromFile: false`, named
`__legacy_<zoneId>`, and shown in the Logic tab so the user can edit
or merge them. The old `actions` array is dropped on the next save.

One function (~80 lines) plus one test that loads a v1 level binary
and confirms identical runtime behaviour.

---

## 7. Phasing

Each slice ends green (typecheck + tests pass). No half-finished
intermediate states.

### Slice 1 — Runtime (3–4 days)

- `src/engine/script/script-engine-system.ts`: ECS system, wait
  queue, trigger dispatch.
- `src/engine/script/api/`: one file per category (`world.ts`,
  `chunks.ts`, `audio.ts`, ...) — each a small adapter over the
  existing systems. No new gameplay logic; the API is glue.
- `src/engine/script/context.ts`: builds `ctx`, compiles scripts
  via `AsyncFunction`.
- Unit tests for every API surface, the wait/signal coroutine,
  error handling, and registration / unregistration paths.

### Slice 2 — Editor (2–3 days)

- New Logic tab.
- File loader (`<input type="file">` + File System Access where
  available), paste textarea, Apply button.
- Persistence in `EditorLevelMeta.scripts`, save/load round-trip
  test.
- TypeScript ambient types published to `types/script-api.d.ts`.

### Slice 3 — Migration & integration (2 days)

- `ZoneTriggerSystem` raises `script-trigger` events instead of
  executing actions directly.
- `ZoneScriptAction[]` → `ScriptEntry` lowering on load.
- Drop `executeZoneScriptAction` from the trigger system.

### Slice 4 — Examples & polish (1–2 days)

- Example scripts in `voxel-platformer/examples/scripts/`: gate-on-
  coins, checkpoint zone, timer ping, cinematic intro.
- README update + this doc updated to "implemented" status.
- `script-api.d.ts` JSDoc pass.

Total: ~1.5–2 weeks. Roughly half the rule-sheet proposal's effort
because we drop the IR, the interpreter, the visual editor, and the
sandbox.

---

## 8. Trade-offs accepted

What this design gives up vs. the rule-sheet proposal:

- **Visual authoring for non-programmers.** Explicit non-goal.
- **Per-row validation in the editor.** Errors show up at compile
  or trigger time, not at edit time. The IDE catches most of them.
- **Easy static preview of script effects.** The editor doesn't know
  which cells a `chunks.fillBlocks` call will hit because the args
  may be computed. Live preview would need per-binding hints if we
  add it later.
- **Bit-exact determinism for replay.** Best-effort, sufficient for
  quests and cinematics; not blocking.

What this design gains:

- **One-tenth the editor UI work.** A button + a textarea.
- **Full JS expressiveness.** Closures, arrays, Maps, destructuring,
  template literals, regex.
- **Real IDE support.** Autocomplete, hover docs, refactors, symbol
  search, clean git diffs.
- **Copy-paste from tutorials and AI assistants.** The same JS that
  runs in any browser runs here.

---

## 9. Non-goals (explicitly)

- Sandbox. Scripts have full DOM access; so does any code the user
  pastes into the browser console.
- Node-graph or rule-sheet UI inside the engine. Discarded.
- TypeScript compilation. We accept `.ts` text and strip types with
  a lightweight pass (regex / `ts-blank-space`); we do not run the
  TS compiler. Type checking happens in the user's IDE.
- Cross-session shared scripts / a marketplace. The level binary is
  the only distribution channel.
- Live editing while paused — scripts are re-applied via Apply.

---

## Appendix A — Example scripts

### A.1 Gate that opens after 2 gold coins

```js
on('pickup-taken', {}, async () => {
    if (player.inventory.gold < 2) return
    if (flags.get('eastGateOpen')) return
    log("The east gate rumbles open.")
    await wait(0.5)
    chunks.fillBlocks({ x: 14, y: 1, z: 22 }, { x: 17, y: 4, z: 23 }, 0)
    flags.set('eastGateOpen', true)
})
```

### A.2 Checkpoint zone

```js
on('zone-enter', { zoneId: 'cp.mid' }, () => {
    player.setCheckpoint(player.position)
    log("Checkpoint reached.")
    audio.play('sfx.checkpoint')
})
```

### A.3 Timed spawner

```js
let spawned = 0
on('timer', { periodSeconds: 5 }, () => {
    if (spawned >= 10) return
    pickups.spawn('coin', { x: 12, y: 2, z: 18 })
    spawned += 1
})
```

### A.4 Three-beat intro cinematic

```js
on('level-start', async () => {
    audio.play('music.intro')
    log("A long time ago...")
    await wait(2.5)
    log("...in a voxel platformer far, far away...")
    await wait(2.5)
    log("...your adventure begins.")
})
```

## 11. Implementation status

| Surface | Slice 1 | Slice 1.5 | Notes |
| ------- | :-----: | :-------: | ----- |
| Runtime kernel (`on/emit/once/wait`)         | ✅ | — | — |
| Custom events                                 | ✅ | — | — |
| `level-start` / `level.reset`                 | ✅ | — | — |
| `timer` event                                 | ✅ | — | — |
| `flags`, `time.now/tick`, `random`            | ✅ | — | — |
| `audio.play/stop`                             | ✅ | — | `fade` opt landed Slice 1 |
| `chunks.getBlock/setBlock/fillBlocks`         | ✅ | — | — |
| `pickups.spawn` / `despawn` / `exists`        | ✅ | ✅ | Stable-id lifecycle complete in Slice 3 |
| `player.position/teleport/kill/inventory`    | ✅ | ✅ | sentinel pos + `alive` flag in 1.5 |
| `zone.contains`                               | ✅ | — | — |
| `geom.box`, `geom.distSq`                     | — | ✅ | new |
| `time.delta`                                  | — | ✅ | new |
| `zone-enter`, `zone-exit` events              | — | ✅ | tapped in ZoneTriggerSystem |
| `pickup-taken` event                          | — | ✅ | tapped in pickup-system |
| `player.died` event                           | — | ✅ | watchdog inside script-engine-system |
| `input` event                                 | — | ✅ | Interaction key emits `action: "interact"` |
| `ui.say` floating bubbles                     | — | ✅ | per-target queue + multi-target parallel render |
| `ui.clear(targetId?)` dismiss bubbles         | — | ✅ | per-target or sweep-all via `world.popupClears` |
| `ui.dialogue` modal conversations             | — | ✅ | centered UI with avatars + choices |
| `trade.open` NPC buy/sell menu                | — | ✅ | gold currency + arrows resource in v1 |
| Stable pickup ids + idempotent spawn          | — | ✅ | `pickups.spawn(..., { id, label })` |
| `Zone.active` + `zone.setActive/isActive/exists` | — | — / 1.6 | inactive zones synthesise zone-exit |
| `flag.changed` event                          | — | — / 1.6 | cross-script observation w/o polling |
| `dayCycle.setHour/setEnabled/setSpeed`        | — | — / 1.6 | drives ambient state |
| `weather.setRain/setSnow/setLightning/applyPreset` | — | — / 1.6 | hooks `AmbientWeather.setState` + presets |
| Editor "Logic" tab (file loader + paste)      | — | — / 2 | ✅ live |
| `player.setCheckpoint` / `clearCheckpoint`    | — | ✅ | Slice 3 — `world.lastCheckpoint` + session checkpoint store |
| `pickups.despawn` / `pickups.exists`          | — | ✅ | Slice 3 — closes the stable-id lifecycle |
| `pistons.setEnabled/isEnabled/flip/list`      | — | ✅ | Slice 3 — `world.pistonsById`, `pendingFlip` force-flip path |
| `stones.spawn/remove/exists`                  | — | ✅ | Direct physics stones with stable ids |
| `stones.setSpawnerEnabled/triggerSpawner/listSpawners` | — | ✅ | Editor-authored falling-stone spawners |
| `weather.setZoneEnabled` (toggle FX zones)    | — | ✅ | Slice 3 — controller tracks configs / live / enabled |
| `weather.setZonePreset` (re-spawn with new preset) | — | ✅ | Slice 3 — pairs with setZoneEnabled |
| `level.spawn / size / name` getters           | — | ✅ | Slice 3 — read-only snapshot of `LevelMeta` |
| `//# sourceURL=` pragma for runtime errors    | — | ✅ | Slice 3 — devtools attach script name to stack frames |
| Per-row parse-error banner in Logic tab       | — | ✅ | Slice 3 — runs `parseCheck` at row render time |
| Per-row runtime-error banner in Logic tab     | — | ✅ | Slice 3 follow-up — sessionStorage bridge `vp:playtest-script-errors` |
| `ZoneScriptAction` legacy union               | — | ✅ removed | Slice 3 follow-up — quest behaviour lives in `.js` scripts |
| `once` lift from filter object                | — | ✅ | Syntax review F1 — `{ …, once: true }` now equivalent to `opts.once`; reserved filter key |
| `types/script-api.d.ts` typed contract        | — | ✅ | Syntax review F4 — promised by §3.3, now authored |

### What's still on the roadmap

- **Slice 4 (or follow-up cleanup)**:
  - Named-place registry (`level.coord('lantern.position')`).
  - Persistent checkpoints across saves (currently per-session).
  - Lighthouse Vigil validation quest — drafted in
    `docs/script-engine-slice-3-plan.md` §4.1 but not authored. Run
    it before committing to the Slice 3 binding shapes long-term.

Implementation file layout — for anyone navigating the runtime:

| File | Purpose |
| ---- | ------- |
| `src/engine/script/types.ts`              | shared shapes |
| `src/engine/script/runtime.ts`            | dispatcher kernel |
| `src/engine/script/bindings.ts`           | host adapter layer |
| `src/engine/script/compile.ts`            | `AsyncFunction` wrapper |
| `src/engine/script/script-engine-system.ts` | ECS system + queue drainer + death watchdog |
| `src/engine/ecs/world.ts`                  | `ScriptTriggerEvent`, `scriptTriggerEvents` queue, helpers |
| `examples/scripts/demo-quest.js`           | canonical demo quest (event-driven) |
| `types/script-api.d.ts`                    | ambient globals for IDE authoring |
| `docs/script-engine.md`                    | this file |
| `docs/script-engine-examples.md`           | three canonical use-case examples |
| `docs/script-engine-syntax-review.md`      | syntax findings + improvement proposals |
| `docs/script-engine-slice-1-review.md`     | review that drove Slice 1.5 |
| `.claude/skills/voxel-script-authoring/`   | Claude Code skill: authoring + extending the API |

---

### A.5 Quest: collect three relics

```js
const relicZones = ['relic.a', 'relic.b', 'relic.c']
const collected = new Set()

for (const id of relicZones) {
    on('zone-enter', { zoneId: id, once: true }, () => {
        collected.add(id)
        log(`Relic ${id} acquired (${collected.size} / 3).`)
        audio.play('sfx.relic')
        if (collected.size === relicZones.length) {
            emit('relics.complete')
        }
    })
}

on('relics.complete', async () => {
    log("The seal breaks. The path forward opens.")
    await wait(1.0)
    chunks.fillBlocks({ x: 30, y: 1, z: 5 }, { x: 33, y: 4, z: 6 }, 0)
})
```

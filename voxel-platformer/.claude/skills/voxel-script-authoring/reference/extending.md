# Extending the script API

Adding a binding (a new verb or namespace scripts can call) is a fixed
chain of edits. Below traces the existing `travel` namespace through every
layer as a worked minimal example, then gives the checklist and the rules
that keep the layer boundaries clean.

The architecture, in one line:

```
world/chunks/audio  →  XxxFacade (host seam)  →  ctx.xxx (XxxApi)  →  script destructures `xxx`
   (game/script-system.ts)   (types.ts)          (bindings.ts)         (compile.ts PRELUDE_LOCALS)
```

The **Facade** is the narrow seam the runtime depends on (tests stub it).
The **Api** is what scripts see. `bindings.ts` maps one to the other and
supplies a no-op when the host doesn't provide the facade.

## Worked example — the `travel` namespace

### 1. `src/engine/script/types.ts` — declare the seam and the surface

```ts
// Host seam — what the binding layer depends on. Keep it minimal.
export interface TravelFacade {
    to(levelId: string, opts?: TravelOptions): void
    reload(opts?: { arrivalId?: string }): void
}

// What scripts see (often identical to the facade, but it's a separate
// type so the script surface can differ from the host contract).
export interface TravelApi {
    to(levelId: string, opts?: TravelOptions): void
    reload(opts?: { arrivalId?: string }): void
}

export interface TravelOptions { arrivalId?: string }

// Wire the Api into the context every script destructures.
export interface ScriptContext {
    // ...existing fields...
    travel: TravelApi
}
```

### 2. `src/engine/script/bindings.ts` — map facade → ctx, add a no-op

```ts
// resolve with a fallback so levels without travel still compile:
const travel = deps.travel ?? NOOP_TRAVEL
// ...in the ctx object literal:
travel: {
    to(levelId, opts) { travel.to(levelId, opts) },
    reload(opts) { travel.reload(opts) },
},
// ...module-level fallback:
const NOOP_TRAVEL: TravelFacade = { to() {}, reload() {} }
// ...and add `travel?: TravelFacade` to BindingsDeps.
```

The no-op is mandatory: scripts call `travel.*` unconditionally, and a
level with no travel system must not crash — it just does nothing.

### 3. `src/engine/script/compile.ts` — add the destructure local

Only needed because `travel` is a new top-level name scripts use bare:

```ts
export const PRELUDE_LOCALS = [
    'on', 'once', 'emit', 'wait', 'log',
    // ...
    'dayCycle', 'weather', 'travel', 'level', 'random',
].join(', ')
```

This list is the destructure prelude *and* what the editor's Logic/NPC tab
parse-check uses — adding here makes the name resolve everywhere at once.
(If your binding is a method on an existing namespace, skip this step.)

### 4. `src/game/script-system.ts` — build the real facade

This is where the binding meets the live game. For `travel` it's passed
straight through from the system options, but most facades are constructed
from `world` / `chunks` / `audio`:

```ts
// inside createGameScriptSystem(opts), passed to createScriptEngineSystem:
travel: opts.travel,
```

A facade built from world state looks like the `zone`/`pistons` facades in
the same file — read/write `opts.world.*`, never reach back into the
runtime. **Glue only**: forward a call, normalise a coordinate. New
gameplay logic belongs in the system you're wrapping, not here.

### 5. `src/engine/script/script-engine-system.ts` — thread the option

Add the facade to `ScriptEngineSystemOptions` and pass it into
`buildScriptContext`. (Same shape as every other optional facade there.)

### 6. Document it

- `voxel-platformer/types/script-api.d.ts` — add the `interface XxxApi`
  and `declare const xxx: XxxApi` so IDE authoring sees it.
- `docs/script-engine.md` §3.2 (the World API block) — the signatures +
  one line on semantics; add a row to the §11 status table.

### 7. Test it

`voxel-platformer/tests/` with stub facades. Pattern in
`tests/script-bindings.test.ts`:

```ts
const calls: unknown[] = []
const travel: TravelFacade = {
    to(levelId, opts) { calls.push({ type: 'to', levelId, opts }) },
    reload(opts) { calls.push({ type: 'reload', opts }) },
}
const ctx = buildScriptContext({ runtime: createRuntime(), ...deps, travel, flags: new Map() })
ctx.travel.to('basement', { arrivalId: 'entry' })
// assert calls forwarded correctly
```

Run `npm test` from `voxel-platformer/`.

## Checklist

- [ ] `types.ts`: `XxxFacade` + `XxxApi` + field on `ScriptContext`
- [ ] `bindings.ts`: ctx mapping + `NOOP_XXX` + `BindingsDeps` field
- [ ] `compile.ts`: `PRELUDE_LOCALS` (only if a new top-level name)
- [ ] `script-engine-system.ts`: option threaded to `buildScriptContext`
- [ ] `script-system.ts`: concrete facade from the live world
- [ ] `script-api.d.ts` + `docs/script-engine.md` §3.2 + §11 table
- [ ] binding test with stub facades; `npm test` green

## Adding a new built-in *event* (not a binding)

Different chain — events are pushed onto a world queue by a producer
system and drained by the script engine:

1. The detecting system calls `pushScriptTriggerEvent(world, { kind: 'my-event', ... })`
   (see `zone-trigger-system.ts`, `pickup-system.ts`, `interaction-system.ts`).
2. `script-engine-system.ts` drains `world.scriptTriggerEvents` and
   `runtime.emit('my-event', payload)` for each.
3. Document the event + filter keys + payload in SKILL.md, the cheatsheet,
   `script-api.d.ts` (`on` overloads), and `docs/script-engine.md` §3.1.

**Note on filters:** the matcher is strict-equality per key against the
payload, so an event filter can only carry *data-match* keys — never a
throttle/option key. (This is exactly why a documented `zone-inside` with
an `everyTicks` filter was never wired: a throttle can't live in the
filter; it has to live subscription-side. See
`docs/script-engine-syntax-review.md`.) If you need a per-subscription
throttle or a "once", that's registration state, not a filter — add it to
`OnOptions`, not the filter object.

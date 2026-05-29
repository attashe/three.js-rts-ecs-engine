---
name: voxel-script-authoring
description: >-
  Author or edit in-game scripts for the voxel-platformer engine — quests,
  cinematics, zone/pickup/input triggers, NPC dialogue, traps, ambient
  logic — and extend the script API itself. Use when working on `.js`
  scripts under voxel-platformer/examples/scripts, scripts pasted into the
  editor's Logic or NPC tabs, or any file under
  voxel-platformer/src/engine/script/ (runtime, bindings, compile, types)
  or src/game/script-system.ts. Triggers: "write a quest script", "add a
  cinematic", "script the lever/zone/NPC", "on('zone-enter'...)",
  "ui.dialogue", "add a script binding / engine API".
---

# Voxel script authoring

In-game gameplay logic is **plain JavaScript** the engine compiles at level
load with `new AsyncFunction(...)` and runs in the same realm as everything
else. No sandbox, no IR, no node graph — scripts are written in an IDE (or
pasted into the editor) against a fixed global API. Single-player, offline,
author-trusted content. Full design rationale:
`voxel-platformer/docs/script-engine.md`.

## Two jobs this skill covers

1. **Authoring a script** (the common case) — writing/editing a `.js` file
   that reacts to events and drives the world through the global API.
2. **Extending the API** — adding a new binding (a new `verb` or namespace)
   the engine exposes to scripts.

Pick the path below. For anything beyond the quick reference inline here,
read the matching file in `reference/`.

---

## Path 1 — Authoring a script

A script's top-level body runs once at load; its job is to **register
handlers**. Handlers do the work, and may span many ticks via `await
wait(...)`.

```js
// the canonical shape
on('zone-enter', { zoneId: 'shrine.east' }, async () => {
    audio.play('sfx.chime')
    await wait(0.5)
    chunks.fillBlocks({ x: 14, y: 1, z: 22 }, { x: 17, y: 4, z: 23 }, 0) // open a gate
})
```

### The mental model (4 primitives)

- **Triggers** — `on(event, filter?, handler, opts?)`, `once(event,
  filter?)`, `emit(name, data?)`. Built-in events fire from the engine;
  custom string-named events are author-defined. Same namespace for both.
- **Time** — `await wait(seconds)` (sim-time, pauses with the engine),
  `time.now`, `time.delta`. Use these and `random(min,max)`, never
  `Date.now()` / `Math.random()` (breaks determinism).
- **State** — `flags.get/set(name, value)` persists with the level and is
  the entire quest-state mechanism. No quest classes.
- **World** — namespaced host objects: `player`, `chunks`, `pickups`,
  `pistons`, `stones`, `audio`, `zone`, `ui`, `dayCycle`, `weather`,
  `travel`, `level`, `geom`.

### Built-in events (filter → payload)

| Event | Filter keys | Payload |
| ----- | ----------- | ------- |
| `level-start` | — | — *(re-fires on editor Apply)* |
| `level.reset` | — | — *(fires when Apply tears scripts down)* |
| `zone-enter` / `zone-exit` | `zoneId`, `source` (`'player'`/`'arrow'`) | `{ entityId, zoneId, source, point }` |
| `pickup-taken` | `pickupId`, `kind` | `{ pickupId, kind, position, amount? }` |
| `input` | `action` (`'interact'`), `targetId` | `{ action, edge?, targetId?, zoneId?, point? }` |
| `timer` | `periodSeconds`, `oneshot?` | `{ tick }` |
| `player.died` | — | `{ reason? }` |
| `flag.changed` | `name` | `{ name, value, previousValue }` |

Custom events: any string. `emit('quest.x.done', data)` ↔ `on('quest.x.done', h)`.

### Top gotchas (full list + why in `reference/gotchas.md`)

- **`once` is a registration option, not a data filter.** Both spellings
  now work — `on(e, { zoneId, once: true }, h)` *and* `on(e, { zoneId }, h,
  { once: true })`. `once` is a reserved filter key; don't use it as a
  custom-event data field.
- **A typo'd `zoneId`/`kind` filter fails silently** — the handler just
  never fires (strict-equality match, no warning). Double-check ids
  against the level.
- **Apply ≠ level reload.** It re-runs script bodies on the *same*
  simulation. `flags` and world state survive; subscriptions, `wait`s,
  `time.now`, and the RNG reset. Put one-shot bootstrap in
  `on('level-start', ...)`, not the bare top-level body.
- **`player.position` is `NaN` while dead/respawning** (not null) — AABB
  and distance tests fall through to false; use `player.alive` for an
  explicit gate.
- Long sequences that can be interrupted: race against lifecycle —
  `await Promise.race([sequence, once('player.died'), once('level.reset')])`.

### IDE setup

`voxel-platformer/types/script-api.d.ts` declares every global. Reference
it from the script (or a local `jsconfig.json`) for autocomplete + type
checks:

```js
/// <reference path="../../types/script-api.d.ts" />
```

### Where scripts live / how they load

- Standalone examples: `voxel-platformer/examples/scripts/*.js`.
- In a level: stored as strings in `EditorLevelMeta.scripts[]`; authored
  via the editor **Logic** tab (file loader + paste) and **NPC** tab.
  **Apply** re-runs them.
- Full API reference: `reference/api-cheatsheet.md`. Idiomatic patterns:
  read `examples/scripts/demo-quest.js` (the canonical event-driven quest).

### Before you finish

- Match the existing example style (the `examples/scripts/*.js` files).
- If the script will ship in a level/test, add or update a test under
  `voxel-platformer/tests/` and run it (see "Testing" below).

---

## Path 2 — Extending the script API

Adding a binding touches a fixed set of files in order. Full worked
recipe with a diff-by-diff example: `reference/extending.md`. The chain:

1. **`src/engine/script/types.ts`** — add the `XxxFacade` (host seam) and
   the `XxxApi` (what scripts see); wire `XxxApi` into `ScriptContext`.
2. **`src/engine/script/bindings.ts`** — map facade → `ctx`, add a
   `NOOP_XXX` fallback so levels without that system still compile.
3. **`src/engine/script/compile.ts`** — add the local to `PRELUDE_LOCALS`
   *only if* it's a new top-level name (this list is the destructure
   prelude; the editor's parse-check reuses it).
4. **`src/game/script-system.ts`** — build the concrete facade from the
   real world/chunks/audio/etc. and pass it into
   `createScriptEngineSystem`.
5. **`voxel-platformer/types/script-api.d.ts`** + **`docs/script-engine.md`
   §3.2** — document it (and the §11 status table).
6. **`voxel-platformer/tests/`** — a binding test with stub facades
   (pattern: `tests/script-bindings.test.ts`).

Keep bindings as glue — one call forwarded, a coordinate normalised, never
new gameplay logic. New gameplay belongs in the system the binding wraps.

---

## Testing

From `voxel-platformer/`:

```bash
npm test          # full suite: tsc -p tsconfig.test.json then node --test
npm run typecheck # tsc --noEmit only
```

The suite builds to `.tmp/test-build/` then runs `node --test`. To run one
file fast after a build: `node --test .tmp/test-build/tests/<name>.test.js`.

## File map

| File | Role |
| ---- | ---- |
| `src/engine/script/runtime.ts` | dispatcher kernel — subs, wait queue, timer, seeded RNG |
| `src/engine/script/bindings.ts` | builds `ctx`; facade → script-facing API + noop fallbacks |
| `src/engine/script/compile.ts` | `AsyncFunction` wrapper + `PRELUDE_LOCALS` destructure list |
| `src/engine/script/types.ts` | authoritative shapes (facades, APIs, events, `ScriptContext`) |
| `src/engine/script/script-engine-system.ts` | ECS system; compiles scripts, drains trigger queue, death watchdog |
| `src/game/script-system.ts` | concrete facades from the live game world |
| `src/engine/ecs/systems/zone-trigger-system.ts` | emits `zone-enter`/`zone-exit` |
| `src/engine/ecs/systems/pickup-system.ts` | emits `pickup-taken` |
| `src/game/interaction-system.ts` | emits `input` (`action:'interact'`) |
| `types/script-api.d.ts` | ambient globals for IDE authoring |
| `docs/script-engine.md` | design doc + API reference |
| `docs/script-engine-syntax-review.md` | syntax analysis + improvement proposals |
| `examples/scripts/*.js` | canonical example scripts |

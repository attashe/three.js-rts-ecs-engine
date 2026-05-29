# Script authoring gotchas

The traps that aren't obvious from reading one file — each with the *why*,
because the why is what tells you when the rule applies.

## 1. `once` is registration, not a data filter

```js
on('zone-enter', { zoneId: 'grove' }, h, { once: true })  // canonical
on('zone-enter', { zoneId: 'grove', once: true }, h)      // also fine — lifted
```

**Why it matters:** the runtime matches every filter key by strict
equality against the *event payload*. `once` is not a payload field, so a
naive matcher would test `event.once === true`, never match, and the
handler would silently never fire. The bindings layer lifts a boolean
`once` out of the filter onto the registration channel
(`bindings.ts → liftOnceFromFilter`). Consequence: **`once` is a reserved
filter key** — you can't filter a custom event on a data field literally
named `once`. Use a different name (`firstTime`, `oneShot`, …).

## 2. Filter mismatches fail silently

A typo'd `zoneId`, a `kind` that doesn't match the pickup, an `action`
other than `'interact'` → the handler simply never runs. No error, no
warning. **When a handler "isn't firing", suspect the filter first.**
Verify ids against the level (zone ids, pickup ids/kinds, piston ids).
`zone.exists(id)` / `pickups.exists(id)` / `pistons.list()` help you check
at runtime.

## 3. Apply is a hot-reload, not a level reload

The editor's **Apply** (and `sys.apply()` in tests):

- **Resets:** all subscriptions, in-flight `wait()` promises, `time.now`,
  `time.tick`, `time.delta`, and the seeded RNG. Then re-runs every
  enabled script's top-level body and re-emits `level-start`.
- **Preserves:** `flags`, and the whole world (chunks, entities, positions,
  inventory, pickups).

**Why it matters:** code in the bare top-level body re-runs on every Apply
*against the already-running world*. Spawning props or writing blocks there
will double up. Put one-shot bootstrap inside `on('level-start', ...)` —
which also re-fires on Apply, but reads as intentional and pairs with
`on('level.reset', ...)` for teardown. Guard genuinely-once-per-save work
behind a `flags` check.

## 4. `player.position` is NaN, not null, while dead

When no player entity exists (mid-respawn, pre-spawn), `player.position`
returns `{ x: NaN, y: NaN, z: NaN }`. NaN propagates through comparisons as
false, so AABB / `geom.distSq` checks naturally fall through without a
guard. For an *explicit* "skip while dead" gate use `if (!player.alive)
return`. Don't `JSON.stringify` the position into a flag without checking
`alive` first.

## 5. Determinism is best-effort — but easy to keep

`wait`, `time.*`, and `random(min,max)` are all driven by the sim clock and
a seeded RNG, so the same start state + inputs reproduce. The moment a
script calls `Date.now()`, `performance.now()`, or `Math.random()`, that
breaks. It's not enforced — just use the provided primitives.

## 6. Long handlers outlive their trigger — race lifecycle events

A cinematic or trap chain spanning seconds can lose meaning if the player
dies or the author hits Apply mid-run. Apply disposes handlers, but an
already-running async handler keeps going on its captured closures until
its next `wait` (cancelled) or its body ends. For sequences that should
abort cleanly:

```js
on('zone-enter', { zoneId: 'trap.east' }, async () => {
    const aborted = Promise.race([once('player.died'), once('level.reset')])
    const sequence = (async () => { /* ...await wait()... */ })()
    await Promise.race([sequence, aborted])
})
```

## 7. `flags` values are `number | string | boolean` only

No objects, arrays, or Maps survive a save — `flags` persists into the
level binary as scalars. Model quest state as a string enum
(`'unknown'|'active'|'ready'|'done'`) and per-item progress as separate
boolean flags (see `examples/scripts/demo-quest.js`). Keep richer state in
script-local `const`/`Set`/`Map` — but remember those reset on Apply and
don't persist across saves.

## 8. Audio ids split music vs sfx

`audio.play` routes by whether the id is in the level's music manifest:
music ids cross-fade and loop; everything else plays as sfx (deferred until
audio is unlocked). `audio.stop('music.x', { fade })` stops music;
`audio.stop(handle)` stops a specific sfx handle. Passing a raw sfx id to
`stop` is a no-op unless it's a music id.

## 9. Optional namespaces no-op on levels that lack the system

`weather`, `dayCycle`, `travel`, `stones`, `ui.dialogue` fall back to inert
no-ops when the level wasn't built with the backing system
(`bindings.ts → NOOP_*`). Calls succeed but do nothing, and boolean returns
are `false`. If a `weather.applyPreset(...)` "does nothing", confirm the
level actually has an ambient weather system wired
(`createGameScriptSystem` only passes `weather`/`dayCycle` when
`weatherSystem` is non-null).

## 10. `fillBlocks` is inclusive-min, exclusive-max

`chunks.fillBlocks(min, max, block)` and `geom.box(min, max, point)` both
use `[min, max)`. To clear a 4-wide gate from x=14, pass `max.x = 18`, not
`17`. Coords are floored; min/max are normalised so either order works for
`fillBlocks`.

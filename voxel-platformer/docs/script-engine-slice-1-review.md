# Script Engine Slice 1 — Critical Review

Written after authoring a real quest (`examples/scripts/demo-quest.js`) against
the Slice 1 API. Goal: judge whether the language we shipped is actually
pleasant to write in, and call out where the design is short.

The review is in three parts:

1. **What worked** — patterns that surfaced naturally and felt right.
2. **What hurt** — friction that surfaced once a quest had to react to
   the player doing anything.
3. **The verdict + the smallest next step** — what to ship in
   Slice 1.5 before any further design work.

The accompanying quest source is at
`voxel-platformer/examples/scripts/demo-quest.js`. The end-to-end test
that drives the quest through the real runtime is at
`tests/script-demo-quest.test.ts`. Both ran green during this review.

---

## 1. What worked

### `flags.get/set` as the state machine

The three-stage quest fell out of two lines of code:

```js
const stage = flags.get(STAGE_FLAG) ?? 0
if (stage === 0 && onStaircaseTop(pos)) { /* advance */ }
```

No class hierarchy, no quest object, no enum. The `flags` API survives
save/load (Slice 2 will persist it), so resuming a level mid-quest just
works. The "Lost Amulet" example in the design doc claimed this would
read like dialogue branches; in practice, it does.

### `level-start` + flags is enough for "first-visit" gating

The intro message + chime fire only when `stage < 3`. Players who
finished the quest see a different greeting. This is the canonical
"played this before" pattern and the API handles it without sugar.

### `audio.play(id)` is one line

```js
audio.play('sfx.quest.chime')
```

No event lifecycle, no handle juggling, no volume math. For
single-shot SFX this is exactly right. The `opts: { volume, loop, fade }`
extension point is there if a quest needs it, but most don't.

### `pickups.spawn(kind, pos, opts)` works for rewards

The quest hands out 5 + 5 + 50 gold across three stages. Calling
`pickups.spawn('coin', {x,y,z}, { amount: 50 })` is one line per reward.
The 'coin' string is a soft contract — adding 'arrow', 'key', etc.
later is a one-line registry add, not an API change.

### Errors don't kill the engine

I deliberately introduced a syntax error mid-authoring (mismatched
braces) to test the failure path. The script appeared in
`sys.broken` with `phase: 'parse'`, the other registered scripts kept
running, no exception bubbled to the loop. The `onScriptError` callback
fired with full context. This is the right shape.

### `emit` + `on` for custom events crosses script boundaries cleanly

`emit('quest.demo.complete')` at the end of stage 3, with a listener
in the same file:

```js
on('quest.demo.complete', () => {
    flags.set('demo.quest.completedAt', time.now)
})
```

A second script could pick up the same event without knowing where the
quest source lives. This decouples the quest from any "follow-up
quest unlocked," "achievement granted," or "music change" listeners
the level author wants to chain on.

### The compile pipeline is fast enough to be invisible

`new AsyncFunction` parsing 80 lines of quest JS is sub-millisecond.
The destructure prelude (`const { on, wait, log, ... } = ctx`) lets
authors write natural JS — no `ctx.player.position`, just `player.position`.
This was a small decision in §2.2 of the design doc; in practice it
matters a lot. Five characters per call adds up fast.

---

## 2. What hurt

### The big one: no `zone-enter`, no `pickup-taken`, no `input`

Slice 1 deliberately deferred these to Slice 3 because the upstream
systems need taps. Writing the demo quest made the cost visceral.
**Every** stage transition that should have read like

```js
on('zone-enter', { zoneId: 'quest.demo.stairs' }, async () => {
    audio.play('sfx.quest.chime')
    pickups.spawn('coin', TOKEN_STAIRS, { amount: 5 })
})
```

ended up like this:

```js
on('timer', { periodSeconds: 0.25 }, () => {
    const pos = player.position
    if (!pos) return
    const stage = flags.get(STAGE_FLAG) ?? 0
    if (stage === 0 && onStaircaseTop(pos)) {
        advanceTo(1, "...", TOKEN_STAIRS, 5)
    }
    if (stage === 1 && player.inventory.gold >= 5) {
        advanceTo(2, "...", TOKEN_WALL, 5)
    }
    if (stage === 2 && onFloatingIsland(pos)) {
        /* ... */
    }
})
```

This is ~30 lines of polling + manual AABB checks + bespoke
`onStaircaseTop` / `onFloatingIsland` helpers. The event-driven version
would be ~15 lines, with the AABB collapsed into editor-authored
zones the runtime already supports.

Worse: the polling shape is **wrong as a teaching example**. The first
script a level author reads should show off the API; instead this one
shows off "how to work around the API." If we ship Slice 1 to authors
in this state, every quest in the codebase will be hand-written
polling — and rewriting them in Slice 3 will be a real chore.

**Verdict**: do not ship the editor UI (Slice 2) until the upstream
emitters land. Slice 3 should be re-prioritised to slot in alongside
Slice 1.5 — see §3.

### Player AABB vs cell-grid coords is a real authoring tax

The staircase top is the voxel range `x∈[16,20], z∈[12,13], y=7`. The
player's foot position is a continuous float around `y≈8, x≈18.0, z≈12.5`.
To "stand on the stairs" I had to write:

```js
return pos.x >= 15.5 && pos.x <= 20.5
    && pos.z >= 11.5 && pos.z <= 14.5
    && pos.y >= 7.5
```

The 0.5 padding is to forgive the player AABB width. I had to read the
level source file to know the cell coords; an editor-authored zone
would have given me a name. **Even with zones in Slice 3, I'd want a
small helper** like `geom.boxContains(min, max, pos)` so authors don't
hand-roll six comparisons.

### `player.position` returning `null` is a footgun

```js
const pos = player.position
if (!pos) return  // every timer handler starts this way
```

When does it return null? When the player entity is mid-respawn or
hasn't spawned yet. That's a real edge case (the player dies, the
script's timer keeps firing) but every handler now starts with the
null check. Options:

- **A**: return a sentinel position (`{ x: NaN, y: NaN, z: NaN }`) so
  the comparisons just naturally fail. Authors don't think about it.
- **B**: pause the script engine when there's no player. Drastic;
  breaks legitimate quests that should keep running between respawns.
- **C**: keep returning null but ship a `player.alive` getter so the
  pattern is `if (!player.alive) return` instead of capturing the
  position first.

I'd ship **A**. The sentinel approach defaults to "do nothing" which
is what every author wants at the dead moment.

### `time.now` is unhelpful without `time.delta`

The script doesn't currently need `dt`, but the moment one quest does
"smoothly raise the door over 3 seconds," the absence becomes obvious.
Right now an author would have to capture `time.now` at the start and
recompute the fraction every tick. **One-line addition** to the
runtime's `advance(dt)`: track `lastDt` and expose it as `time.delta`.

### `zone.contains` is the only zone API and it's useless without authored zones

The demo level ships with `zones: []`. So `zone.contains('grove', 'player')`
always returns false. The Slice 1 API has zone bindings that an author
literally can't use until they author zones in the editor first. That's
fine in principle, but the test harness doesn't expose a way to inject
zones, and there's no zone-emit shim. The runtime is *ready* for
zones; the surface isn't *wired*. Minor friction now, but it'll
surface again the moment we want to test a zone-driven script before
Slice 3.

### Apply doesn't restart sim-time, but the script doesn't know that

`apply()` calls `runtime.reset()`, which zeroes `simTime` and `simTick`.
But it does **not** zero `flags`. From the script's point of view, this
is inconsistent: "did I just start the level, or am I 2 minutes in?"
The current behaviour is technically correct (flags are persistent
state, sim-time is per-session) but a script that does
`if (time.now < 0.5) doStartupStuff()` will misfire after every Apply.
The fix is documentation, not code: add a §2.6 note to the design doc
clarifying that **Apply resets the clock but preserves flags**.

### `on(...)` overload pain in TypeScript

The runtime accepts both shapes:

- `on('event', { filter }, handler, opts?)`
- `on('event', handler, opts?)`

The second arg is detected by `typeof === 'function'`. TypeScript's
inference handles this for plain JS scripts (which is fine — that's
what users write) but the **test code** had to fight the overload
union when calling `runtime.on` directly with `undefined` as the filter
slot. Minor, but if we ever expose the runtime to engine-side
TypeScript consumers, we'll want a clearer split — maybe `onEvent(name,
handler, opts)` and `onFiltered(name, filter, handler, opts)` as
distinct entry points, with `on` as the JS-facing sugar.

### No way to register a handler that fires only AFTER a specific tick

A common pattern: "let the level settle for 1 second, then start the
quest." Today you write:

```js
on('level-start', async () => {
    await wait(1.0)
    // ... real start
})
```

Which works! But it's worth flagging: this is the only correct shape.
Authors who write

```js
on('timer', { periodSeconds: 1.0, oneshot: true }, () => { /* start */ })
```

get *almost* the same behaviour, except the timer starts ticking from
the moment of registration, not from the moment of level start. With
multiple scripts and Apply re-running them at different points, those
two shapes diverge. **Document this** in the API reference.

---

## 3. Verdict + the smallest next step

### Verdict

For **author-defined custom-event-driven flows** (cinematics, scripted
sequences, "do this then that"), Slice 1 is already quite good. The
"Awakening" cinematic example from the canonical examples doc would
write cleanly today.

For **anything that reacts to the player**, Slice 1 is incomplete and
ships in a state where the natural path produces verbose, polling-shaped
code. The friction is entirely in upstream emitters that need to be
wired into existing systems (`ZoneTriggerSystem`, `pickup-system`,
input action map). The runtime kernel itself is fine.

The big-picture call: **do not start Slice 2 (editor UI) before
Slice 1.5 (event emitters) lands**. Authors picking up the editor
should see the canonical example shape (`on('zone-enter', ...)`),
not the polling workaround.

### Slice 1.5 — minimum patch to make the language usable

In approximate order of pain reduction:

1. **`zone-enter` / `zone-exit` emitters.** Tap `ZoneTriggerSystem`:
   when an entity overlaps / un-overlaps a zone, push an event onto
   `world.scriptTriggerEvents` and let the script engine drain it.
   `world.zones` is already authoritative; the work is one new branch
   in `executeZoneScript` (now `emitZoneScriptEvent`). ~80 LOC.
2. **`pickup-taken` emitter.** Tap `pickup-system`'s collection branch.
   Emit `{ kind, position, amount?, pickupId? }`. `pickupId` is null
   until pickups grow stable ids (also queued); for now the editor
   can match on `kind` alone. ~40 LOC.
3. **`player.died` emitter + `time.delta` getter.** Tap
   `player-death-system`; expose `lastDt` from the runtime. ~30 LOC.
4. **Sentinel `player.position`** (the null-fix in §2 above). ~10 LOC.
5. **`geom.box(min, max, pos)` helper** for "in this AABB" checks
   without zones. ~15 LOC. Tiny, but every cinematic that wants a
   trigger area needs it.

Total: **~175 LOC + tests**. Maybe two days of focused work.
Subsequent Slice 2 (editor UI) and Slice 3 (`ZoneScriptAction`
migration, the heavier glue) are unblocked the moment 1–3 above land.

### What I'd hold off on

The design doc's `input` event source (binding `on('input', { action,
edge }, ...)` for keypress edges) is **not** in Slice 1.5. The
locomotion / spell systems already poll the action map directly each
tick; weaving in a subscription API is more invasive than the three
above and unlocks fewer real quests. Push to Slice 3.

Also explicitly not in Slice 1.5: piston id surface, pickup despawn,
`player.setCheckpoint`. Each is a real feature add to its upstream
system and shouldn't be lumped in with the script engine.

---

## Quick reference — facts the review surfaced

| Fact | Source |
| ---- | ------ |
| Quest source                  | `voxel-platformer/examples/scripts/demo-quest.js` |
| End-to-end test (7 cases)     | `voxel-platformer/tests/script-demo-quest.test.ts` |
| Audio cues added              | `sfx.quest.chime`, `sfx.quest.fanfare` in `src/game/audio.ts`; synthesised in `scripts/generate-audio-samples.mjs` |
| Wav assets                    | `voxel-platformer/public/audio/8bit/quest-chime.wav` (~0.5 s), `quest-fanfare.wav` (~0.9 s) |
| Test count                    | 273 (was 266 after Slice 1) — 7 new |
| Demo level coords used        | staircase top (18,8,12); west wall coin (4,5,4); floating island (8,8,21) — all from `src/game/level.ts` |

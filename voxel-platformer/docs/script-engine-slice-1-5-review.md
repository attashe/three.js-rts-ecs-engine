# Script Engine Slice 1.5 — Review

Closes the loop on the Slice 1 review verdict. Slice 1.5 shipped the
five prescriptions from that doc; the user then went further and
added an NPC-led quest, an `ui.say` floating-message system, and an
`input` event tied to interactive zones. This review covers:

1. What Slice 1.5 fixed (vs. the original verdict).
2. The new NPC quest — what authoring this exposed.
3. The floating-message stack — design assessment + lurking issues.
4. What still feels rough enough to address before Slice 2 starts.

The reference quest is at
`voxel-platformer/examples/scripts/demo-quest.js`. The integration
test that drives it through the live runtime is at
`tests/script-demo-quest.test.ts`. Both run green.

---

## 1. Slice 1.5 — what landed

| Prescription from the Slice 1 review | Status |
| ------------------------------------ | ------ |
| `zone-enter` / `zone-exit` emitters in `ZoneTriggerSystem` | ✅ shipped |
| `pickup-taken` emitter in `pickup-system` | ✅ shipped, with stable `pickupId` payload |
| `player.died` event (watchdog on `world.deathSignal`) | ✅ shipped in `script-engine-system` |
| Sentinel `player.position` + `player.alive` | ✅ shipped |
| `time.delta`, `geom.box`, `geom.distSq` | ✅ shipped |

Plus the user's expansion:

| Beyond the verdict | Status |
| ------------------ | ------ |
| `input` event with `targetId` + `zoneId` | ✅ shipped via `interaction-system` |
| `ui.say(targetId, message, { seconds })` API | ✅ shipped |
| `world.popupMessages` queue + renderer | ✅ shipped in `interaction-system` |
| Stable pickup IDs (`pickups.spawn(..., { id, label })`) | ✅ shipped — idempotent re-spawn |
| Interaction zones (Zone.kind === 'interact', `interaction.{prompt,anchor,radius}`) | ✅ shipped |
| `BLOCK.unlitLantern` (palette index 15) + `npc-keeper` prop | ✅ shipped |
| `createGameScriptSystem` production wiring in `client.ts` | ✅ shipped |

Slice 1.5 closed the gap the Slice 1 review flagged. The friction
that made the polled quest verbose is gone; the rewritten quest
reads top-to-bottom like a state machine over events.

---

## 2. The NPC quest — "Fragments for the Keeper"

The rewrite (now 160 LOC, was 90 in the polled version — but ~5×
more game content per line) authors:

- A Keeper Arlen NPC anchored at one interaction zone.
- Three stable-id Sun Shard pickups scattered across the level.
- Quest states: `unknown` → `active` → `ready` → `done`, persisted in
  flags.
- The lantern voxel switches between an `unlitLantern` palette index
  and a lit `torch` block on completion — direct world feedback for
  finishing the quest.
- Dialogue lines anchored to the Keeper zone via `ui.say(...)`.
- Cross-script hook (`emit('quest.demo.complete')`).
- Death-hint handler tells the dead player which stage they were on.

### What works

**Interaction model is exactly right.** The shape
`on('input', { action: 'interact', targetId: 'zone.demo.keeper' }, handler)`
is what NPCs *should* feel like — no polling, no E-key bookkeeping in
the script, the engine delivers a contextual event with the zone id
attached. The script's job reduces to "what does Arlen say in this
state?"

**Idempotent stable-id pickups eliminate the duplicate-spawn class.**
`ensureShardsSpawned()` blindly calls `pickups.spawn(kind, pos, { id })`
for every shard every time it runs. The script-system spawn binding
delegates to `spawnScriptPickup`, which consults
`world.pickupEntityByScriptId` and returns the existing entity if the
id is live. No `if (!flags.get('shard-spawned')) ...` boilerplate.

**Dialogue helper.** The script defines
`sayKeeper(message)` as a one-liner that pushes a popup AND logs the
text. That's a nice author idiom that emerged naturally — it would
have looked silly to write `ui.say(...)` + `log(...)` separately on
every dialogue line. We don't need to ship `sayKeeper` as a built-in;
the helper is six lines and clear in context.

**Lantern as quest progress feedback.** Voxel writes
(`chunks.setBlock` switching the lantern between `unlitLantern` and
`torch`) make the quest's state visible in the world without any HUD
work. This pattern is going to show up in many quests; consider
documenting it in `script-engine-examples.md` as a canonical
"persistent visible quest state" recipe.

**Quest survives Apply.** The `state progression survives apply()`
test confirms: flags persist, the script re-registers handlers, the
shard pickups are idempotent. The author had to do nothing to make
this work — the runtime guarantees it.

**Death hint via `player.died` event.** Three lines, gives the player
genuine information without an HUD. The Slice 1 review specifically
called out this event as needed; this script is what the event was
for.

### What still feels rough

**The "is the quest active?" gate gets repeated.** Five of the seven
top-level handlers start with `if (state() !== '...') return`. A
canonical pattern would be welcome:

```js
when('demo.quest.keeper.state', 'active', () => {
    on('pickup-taken', { kind: 'sun-shard' }, ...)
})
```

But that's a quest-system abstraction *on top of* the script engine,
not part of it. The pattern is fine for v1; the right answer is to
publish it as a recipe in the examples doc when the second NPC quest
ships.

**The dialogue helper's coupling.**
```js
function sayKeeper(message) {
    ui.say(KEEPER_ZONE, message, { seconds: 4.5 })
    log(`Keeper Arlen: '${message}'`)
}
```

Author wrote the NPC name twice — once as the zone id, once in the
log string. A real dialogue API would carry the speaker name as
metadata. Not Slice 1.5's problem; flag for whatever ships dialogue.

**Voxel-coord vs world-coord confusion.** The script uses literal
coordinates like `{ x: 9, y: 5, z: 9 }` for the lantern. The author
had to read `level.ts` to know the lantern lives at `groundY+1=5`.
Once levels grow, hard-coding world coords inside scripts becomes
brittle. Two paths:

- Author-defined waypoint zones (`zone.demo.lantern` → script reads
  `zone.center` or similar). Requires a new `zone.center(id)` getter.
- A `level.coord('lantern.position')` registry on the world for
  named places.

Both are out of Slice 1.5 scope; flag for design later.

---

## 3. Floating messages — design assessment

The `ui.say` stack has three layers:

1. **Script API** — `ui.say(targetId, message, opts?)` on `ctx`.
2. **World state** — `world.popupMessages: PopupMessage[]` filled via
   `pushPopupMessage(world, ...)`. Capped at 24 entries (FIFO).
3. **Renderer** — `interaction-system.ts` polls `popupMessages` on
   the render thread, owns the DOM `<div>` that draws the bubble at
   the target zone's anchor projection.

### What works

**Author addresses the bubble to a zone id, not a screen position.**
The script doesn't think about cameras or projection. Right shape.

**Bubble auto-anchors to interaction-zone metadata.** If the script
says `ui.say('zone.demo.keeper', ...)`, the renderer reads
`zone.interaction.anchor` and projects that point to screen. Author
can move the NPC by editing the zone, no script change.

**Bubble outlives interaction proximity.** Once `ui.say` fires, the
bubble shows for its full `seconds` even if the player walks away —
because the renderer holds an `ActiveBubble` with its own
`expiresAt`, not gated on proximity. That's what authors expect of
NPC dialogue.

**Cap of 24 + monotonic `lastPopupId`.** The renderer reads only
messages with `id > lastPopupId`, so the FIFO eviction can't show a
stale message. Even under burst (a script that emits 100 lines in
one tick), only the last one wins — which is the right policy for
overlapping NPC chatter.

### Lurking issues

**Only one bubble at a time.** `bubble: ActiveBubble | null`. If two
NPCs both call `ui.say` in the same tick, the second wins; the
first vanishes. For a single-NPC demo this is invisible, but the
moment two NPCs are on screen simultaneously, this will surface.
Fix is per-target bubble state — straightforward but it's a real
rewrite of `interaction-system.ts`.

**Off-screen target hides the bubble silently.** If
`projectToScreen` returns null (point behind camera, or near plane
clip), the bubble disappears mid-line instead of clipping to the
edge of the viewport. Better behaviour: clamp to viewport edge with
an arrow indicator. Cosmetic, defer.

**No way to dismiss a bubble early.** If the player walks past an
NPC that just started a 4.5-second line, they're stuck looking at
that line over the empty zone for 4 seconds. Either (a) auto-fade
when the target zone leaves the screen, or (b) expose
`ui.clear(targetId)` so a script can dismiss.

**No styling/categorisation.** Every bubble looks identical — same
font, colour, background. Authors will want quest-critical lines to
look different from ambient chatter. Plumb `kind: 'info' | 'warn' |
'shout'` or similar into `pushPopupMessage`. The plumbing is
small; the CSS is the real work.

**`world.popupMessages` lifecycle.** The renderer never *consumes*
from the array — it just remembers `lastPopupId`. So the array
grows up to 24, then FIFO. After a long session, the first 24 messages
of the level are gone, but `nextPopupMessageId` keeps climbing. Fine
in practice; document that `popupMessages` is a ring, not a queue.

**No persistence across Apply.** Bubbles in flight when the editor
hits Apply are not currently cancelled. The renderer's `bubble` field
keeps its `expiresAt` (in `now` seconds, not sim-time) and continues
ticking. So if a script re-emits `ui.say(...)` on the new
`level-start`, the old bubble might briefly still be showing.
Watchable; small.

---

## 4. What still feels rough enough to address before Slice 2

The Slice 1 review's verdict was: "do not start Slice 2 (editor UI)
before language polish lands." Slice 1.5 + the NPC quest closed that
gap. Author can now write event-driven scripts without polling,
without AABB hand-math, without flag boilerplate.

What's left that might bite Slice 2:

1. **No `ui.clear(targetId)`** — dismissing a bubble early when the
   quest moves on is currently impossible. Three lines of code to
   add; should land before Slice 2 because the Logic tab's "Apply"
   action should cancel in-flight bubbles to avoid confusing the
   author.

2. **`interaction-system.ts` only renders one bubble at a time** —
   acceptable for the demo quest with one NPC; will surface the
   moment Slice 2 lets authors place multiple NPCs.

3. **`pickup.label` is shown in the log but not in the bubble.** A
   `ui.say(targetId, message, { speaker })` overload would let
   dialogue authors say `speaker: 'Keeper Arlen'` once and have it
   render in the bubble header. Tiny, optional, defer.

4. **Editor needs a way to author interaction zones** — `kind:
   'interact'` + `interaction: { prompt, anchor, radius }` is the
   shape, but no editor UI exists to create them. Slice 2's Logic
   tab is the natural place to add a "convert this zone to an
   interact zone" toggle.

5. **Documentation of the canonical patterns.** The "lantern as
   quest state" + "stable-id idempotent spawn" + "dialogue helper
   function" patterns should be added to
   `script-engine-examples.md` so the second-quest author doesn't
   have to re-derive them.

### Verdict

**Slice 2 (editor UI) is unblocked.** The language is polished
enough that an author dropping a `.js` file into a Logic-tab loader
will write event-driven scripts with the same shapes the demo quest
uses. The five rough edges above are small ergonomic improvements,
not architectural ones, and most of them surface only when a level
has multiple NPCs / multiple in-flight quests — which is a
post-Slice 2 reality anyway.

The single change that *would* be nice to land alongside Slice 2:
`ui.clear(targetId)` + a multi-bubble renderer. Both are tiny.
Whoever picks up Slice 2 should do them in passing.

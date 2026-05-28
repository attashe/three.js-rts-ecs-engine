# Script Engine — Slice 3 Plan

Status: **plan only**, no implementation. Drafted after the Lantern
Trial quest landed (commit `bdd2da1`) — it was the de-facto review of
everything that shipped in Slices 1.6 + 2, and it surfaced the actual
shape of what Slice 3 should be.

The doc has four parts:

1. **Retrospective** — what writing a real quest (twice) taught us
   about the API and about how we've been planning.
2. **Gaps surfaced**, prioritised by how often a quest author would
   actually hit them.
3. **Slice 3 scope** — what lands in this slice, the shape of each
   binding, and the integration points in existing engine systems.
4. **Validation + cutoff** — the quest we'll author against the
   finished slice, and what we deliberately defer to Slice 4.

---

## 1. Retrospective

### What writing the Lantern Trial surfaced (and didn't)

Going in, I expected the Lantern Trial to expose more rough edges
than it did. It mostly didn't. The Slice 1.6 + 2 bindings carry their
weight — `dayCycle.setHour`, `weather.applyPreset`, `zone.setActive`,
`flag.changed` all read naturally inside the quest. The state
machine, again, was four `flags.set` calls and an `if (state() === X)`
ladder. No new abstractions wanted.

What DID bite, in order of how visible it was while writing the
quest:

1. **The hour stones can't be removed.** The quest spawns four
   stones at level-start (after the player talks to the Sundial).
   If the player abandons the quest, runs around for a while, then
   comes back to the Sundial — the stones are still there from the
   first attempt, idle. `pickups.spawn(..., { id })` is idempotent
   (good), but there's no inverse. **`pickups.despawn(id)` is the
   single most-needed missing binding.**

2. **The vault zone toggle works; the *weather zone* toggle is a
   silent no-op.** The quest doesn't use weather zones (the demo
   level has none), but the spec'd `weather.setZoneEnabled(id, on)`
   returns false unconditionally in Slice 1.6. A quest that wanted
   to "summon a rain pillar over the altar" can't. The API surface
   exists; the implementation is still TODO.

3. **Pistons are inert from a script's point of view.** The demo
   level has two — the elevator + the horizontal trap. Neither
   participates in the Lantern Trial because there's no way to
   touch them from a script. A "pause the elevator while the
   shrine ritual is mid-cast" beat is straightforward gameplay,
   completely unreachable with today's API.

4. **No checkpoints.** The Lantern Trial is short enough that
   restart-from-spawn is fine. A longer quest, or one with falls
   off the floating island mid-ritual, would frustrate immediately
   without a way for the script to set `world.lastCheckpoint`.
   Notable that the original Slice 1 review prescribed
   `player.setCheckpoint` and we deferred it; the deferral has not
   yet caused pain because the Lantern Trial happens to be all on
   ground level, but it's load-bearing for the next quest design.

5. **Scripts can't read level metadata.** The quest hard-codes
   `VAULT_REWARD = { x: 5, y: 5, z: 5 }`. A quest meant to
   teleport the player "back to spawn" has to either know the
   level's spawn coords (it doesn't) or shell out to a
   `player.teleport(...)` with literal numbers. A `level.spawn`
   getter is one line of glue.

6. **`pickup-taken` and `zone-enter` carry payloads, but the
   filter-vs-payload field naming is asymmetric.** Filter is
   `{ kind: 'hour-stone' }`; payload also has `kind`. Filter is
   `{ pickupId: 'X' }`; payload also has `pickupId`. That's fine
   today, but if we ever add filter-only sugar (e.g.
   `{ kindAny: ['coin', 'arrow'] }`), the symmetry breaks. Worth
   flagging as a constraint on future filter design.

7. **No way to inspect a pickup that already exists.** The Sundial
   re-spawn path uses `flags.get(stoneFlag(s.id))` to track which
   stones the player took. That works because the script *itself*
   set the flag on `pickup-taken`. But a script that *didn't*
   spawn the pickup (loaded a level with pre-placed pickups) can't
   ask "is the wall coin still there?" without polling. A
   `pickups.exists(id)` would close this — for stable-id-spawned
   pickups only.

8. **Error messages don't reference the script's source lines.**
   When my test failed because `dayCycle is not defined` (forgot
   the prelude entry), the error pointed at the runtime's `invoke`
   line in `runtime.ts`, not at the script source line that called
   `dayCycle.setHour`. The editor's parse-check button catches
   syntax errors before Playtest, but runtime errors inside a
   handler still surface as console noise with no usable line
   anchor. A small improvement: when wrapping the body with
   `AsyncFunction`, emit a `//# sourceURL=script-name.js` pragma so
   the browser devtools attach the script name to stack frames.

What I *expected* to be a problem and wasn't:

- **`time.delta` vs `dayCycle.hour` confusion** — no occurrences in
  the quest, no occurrences in the design discussion. The split
  reads as natural.
- **`ui.say` only renders one bubble at a time** — flagged in the
  Slice 1.5 review. The Lantern Trial uses `ui.say` exactly twice
  in sequence with multi-second gaps; the limitation didn't show.
  We'll trip on it when a second NPC arrives.
- **`flag.changed` event noise** — the quest emits maybe 12 flag
  changes total, all observed by one inline listener. No
  performance concerns, no spam. Good design call.

### What planning got right

- **Phase by demo-validated milestones**, not by code area. Each
  slice ended with a real quest exercising the new surface. This
  has been the single most useful planning move.
- **Stop-the-line reviews after each slice.** The Slice 1 review
  explicitly blocked Slice 2 until language polish landed; that
  call aged perfectly.
- **No half-built half-shipped state.** Every commit on this branch
  ends green (typecheck + tests) — the slice boundaries are also
  the rollback boundaries.
- **Trust the user's mid-flight expansions.** The user added
  interaction zones, `ui.say`, stable pickup ids, and `npc-keeper`
  in the middle of Slice 1.5. The plan documentation absorbed those
  retroactively instead of fighting them, and the net design is
  better than what the original doc spec'd.

### What planning got wrong

- **The original Slice 4 ("examples + polish") never existed as a
  thing.** Examples + polish landed inside every slice. The
  four-slice phasing in the design doc was over-engineered.
- **"4-week" total estimate** was 3× too high. Each slice was a
  day or two of focused work. The phasing tried to predict in too
  much detail.
- **Slice 1.6 + 2 ended up bundled** even though I claimed I'd
  commit them separately. That's a small honesty gap. In practice,
  the bundle was the right move — Slice 2 (editor UI) was
  meaningless without the scripting expansion to back it.
- **The `script-engine-examples.md` doc has been touched but not
  followed up with second-quest patterns.** The "canonical
  examples" file still describes hypothetical scripts from the
  pre-implementation era. Once Slice 3 ships, the file should be
  rewritten to reference the live `demo-quest.js` + `lantern-trial.js`
  + Slice 3 quest as canonical patterns.

### Planning principles to carry into Slice 3

1. **Author the validation quest *first*.** Don't ship a binding
   without a real use case driving its shape. The shape of
   `pickups.despawn` falls out trivially from "what should the
   abandoned-stone cleanup look like in code?"
2. **Bundle small bindings.** Slice 3 will be 4–5 small surfaces.
   Trying to phase them further is over-engineering at this scale.
3. **Defer the `ZoneScriptAction` migration to a separate
   cleanup pass.** It's not blocking anything; the legacy union is
   inert in the current demo. Mixing migration into a feature
   slice was a mistake the original plan made.
4. **Treat the validation quest as the spec.** If a binding isn't
   used by the quest and isn't backfilling something the previous
   reviews flagged, don't ship it. Speculative API surface area
   has been our #1 source of cost.

---

## 2. Gaps surfaced, by priority

Ranked by "how soon would the next quest hit this." Items 1–4 are the
core of Slice 3; items 5–7 are stretch.

| # | Gap | Impact | Effort |
| - | --- | ------ | ------ |
| 1 | `pickups.despawn(id)` + `pickups.exists(id)` | Every quest with optional / abandoned items wants this | Small — pickup-system already tracks `pickupEntityByScriptId` |
| 2 | `pistons.setEnabled(id)` + `pistons.flip(id)` + stable ids on pistons | Lets scripts gate progression on moving platforms; demo level has two pistons today | Medium — pistons have no string-id surface yet |
| 3 | `player.setCheckpoint(pos?)` + restart-from-checkpoint | Required for any quest >5 minutes long | Small — needs `world.lastCheckpoint`, restart-system hook |
| 4 | `weather.setZoneEnabled(id, on)` + `weather.setZonePreset(id, presetId)` | The spec'd noop becomes real — critical for "ritual conjures rain at altar" quests | Medium — `createVisualFxZoneSystem` needs to remember zone params so re-spawn-by-id works |
| 5 | `level.spawn`, `level.name`, `level.size` getters | Cheap glue; saves quests from hard-coding world coords | Tiny |
| 6 | Stack-trace sourceURL pragma in compiled scripts | Quality of life; one line in `compile.ts` | Tiny |
| 7 | Per-script-row error reporter in the editor's Logic tab | Runtime errors should show under their entry, not in the console | Small — `onScriptError` already carries the entry id |

What did **not** make the cut:

- **Multi-bubble `ui.say` renderer**. Still flagged from Slice 1.5;
  still not hit by either authored quest. Defer until a 2-NPC
  level forces it.
- **`ui.clear(targetId)` to dismiss bubbles early.** Same — not
  hit by either quest.
- **`zone.list()` / `zone.find(kind)` for introspection.** Quests
  reference zones by id; nothing has needed enumeration.
- **`pickups.move(id, pos)` for relocating quest items.** Could be
  written by despawn + respawn; the convenience isn't worth a
  new verb yet.
- **A `dialogue` namespace separate from `ui.say`.** The current
  shape works; introducing a richer dialogue API is a separate
  product decision.

---

## 3. Slice 3 scope

Five small bindings, one mid-sized binding, two quality-of-life
additions. Estimated ~2–3 days of focused work + tests + the
validation quest.

### 3.1 Pickup lifecycle completion

**Surface**

```ts
pickups.spawn(kind: string, pos: VoxelCoord, opts?: PickupSpawnOptions): string  // existing
pickups.despawn(id: string): boolean        // new — true if removed, false if not live
pickups.exists(id: string): boolean         // new — checks live-by-id table
```

**Implementation**

- `world.pickupEntityByScriptId: Map<string, number>` already
  tracks live entities by id (Slice 1.5 wired it for the
  idempotent-spawn path). `pickups.despawn(id)` reads the entity
  out and calls `despawnEntity(world, eid)` then clears the map
  entry.
- `pickups.exists(id)` is one Map lookup.
- The host facade lives next to `spawnScriptPickup` in
  `src/game/pickups.ts` — add `despawnScriptPickup(world, id)` +
  `scriptPickupExists(world, id)` helpers.
- Bindings layer in `src/engine/script/bindings.ts` exposes
  `pickups.despawn(id)` / `pickups.exists(id)` on top of the new
  facade methods.

**Test coverage**

- Spawn + despawn idempotency: despawn an unknown id → false.
- Despawn fires no `pickup-taken` event (it's a clean removal, not
  a collection).
- Apply re-runs the script; pickups marked as "still live in
  flags" but with no live entity are re-spawned (existing flow).

### 3.2 Pistons with stable ids

> **Pre-implementation notes for this section live in
> [`script-engine-slice-3-pistons.md`](./script-engine-slice-3-pistons.md).**
> That doc covers the piston-system internals to read before editing,
> the editor playtest/save-load round-trip changes, edge-case behaviour
> for disabling mid-motion, and the browser-pass validation gate. Read
> it before starting Step 7.


**Surface**

```ts
pistons.setEnabled(id: string, enabled: boolean): boolean  // true on success, false if id unknown
pistons.flip(id: string): boolean                          // force a flip; returns false if currently mid-physical-move
pistons.isEnabled(id: string): boolean
pistons.list(): string[]                                   // enumerable for debug / dynamic targeting
```

**Implementation**

- `PistonMechanism` in `world.ts` currently has no `id` field.
  Pistons are identified by their `from` cell — there's no map.
- **Add `id?: string` to `PistonMechanism` + `PistonMechanismConfig`**
  (optional for backward compat; pistons without an id are still
  legal but can't be targeted from scripts). `level.ts` author
  experience: pass `id: 'piston.elevator'` alongside `from / to /
  block`.
- `world.pistonsById: Map<string, PistonMechanism>` populated by
  the registration call in `client.ts`.
- Add `enabled: boolean` to `PistonMechanism`. The piston-system's
  `update` skips disabled pistons.
- `pistons.flip(id)` sets `nextFlipAt = world.simTime` (or
  equivalent) so the next tick performs the flip. Returns false if
  the piston is mid-physical-move.

**Demo level update**

- `level.ts` assigns ids: `'piston.elevator'`, `'piston.trap'`.
  Backward-compat: existing saved levels reload as unnamed
  pistons, untouchable from script. Acceptable.

**Test coverage**

- `setEnabled(false)` on a piston with a player on top: piston
  freezes; player's gravity resumes (the dynamic-collision system
  treats disabled-piston blocks the same as static ones).
- `flip(id)` while idle: piston completes a flip on the next
  fixed step.
- `flip(id)` mid-physical-move: returns false, no state change.
- `list()` returns ids registered in `level.ts`.

### 3.3 Player checkpoint

**Surface**

```ts
player.setCheckpoint(pos?: VoxelCoord): void   // pos omitted ⇒ use current player position
player.clearCheckpoint(): void
player.checkpoint: VoxelCoord | null           // getter — null when none set this session
```

**Implementation**

- `world.lastCheckpoint: VoxelCoord | null` on the world context.
  Already mentioned in the design doc but never added.
- `restart-system.ts` reads `world.lastCheckpoint` before falling
  back to `meta.spawn` on death.
- The checkpoint is per-session — not persisted in the level
  binary. (Persistent checkpoints would be a save-game concern,
  out of scope.)

**Demo level update**

- Add a `checkpoint` zone near the staircase top. The Slice 3
  validation quest will use it; the existing Lantern Trial is
  too short to need one.

**Test coverage**

- `setCheckpoint()` with no arg reads `player.position`.
- After death, the restart spawns the player at the checkpoint,
  not at `meta.spawn`.
- `clearCheckpoint()` reverts to spawn-on-death.

### 3.4 Weather zone toggle (real implementation)

**Surface**

```ts
// Already declared in Slice 1.6 — just no-op fallback today.
weather.setZoneEnabled(zoneId: string, enabled: boolean): boolean
weather.setZonePreset(zoneId: string, presetId: string): boolean
weather.isZoneEnabled(zoneId: string): boolean
```

**Implementation**

- `createVisualFxZoneSystem` currently caches params at `spawn()`
  time but discards them after handing the result to
  `fx.addZone(params)`. Change to keep a `Map<string,
  WeatherZoneRuntimeConfig>` of original configs, plus a
  `Set<string>` of currently-enabled ids.
- `setZoneEnabled(id, true)` looks up the original params, calls
  `fx.addZone(...)` if not already live.
- `setZoneEnabled(id, false)` calls `fx.removeZone(id)` and stops
  the paired sound (the entries struct already tracks the sound
  handle).
- `setZonePreset(id, presetId)` re-spawns the zone with the
  preset's params overlaid via `applyZonePreset`.
- The script-system production facade wires these through to the
  `VisualFxZoneSystem` handle (attach it to the returned System
  the same way Slice 1.6 attached `weatherSystem` to the
  environment-fx system).

**Test coverage**

- Toggle a level-authored zone on/off via the binding; assert the
  zone is/isn't in `fx.getZone(id)`.
- Toggle preset; assert the new params match `WEATHER_PRESETS[id]`.

### 3.5 Level metadata getter

**Surface**

```ts
level.spawn: VoxelCoord       // read-only getter
level.size: number            // XZ extent
level.name: string            // editor-authored or 'demo'
```

**Implementation**

- Single binding object on `ScriptContext`. Production facade
  reads from the `LevelMeta` the script engine was constructed
  with.
- Test facade exposes a `LevelMetaFacade` for stubbing.

**Test coverage**

- Trivial: read each field; verify forwarding.

### 3.6 sourceURL pragma + per-script error reporter

**Implementation**

- `compile.ts`: prepend `//# sourceURL=${entry.name}` to the
  wrapper body. Browser devtools attach script-name traces. Zero
  runtime cost.
- Logic tab: replace the console.error path in `onScriptError`
  with a per-entry status drawer. The broken-script Map already
  carries the entry id and a tag for parse vs runtime; the tab
  just needs to render it. Update the row card to show the most
  recent error message + clear-on-edit.

**Test coverage**

- A script that throws inside a handler: `sys.broken` carries the
  entry id + `phase: 'runtime'` + the error.
- The Logic tab's status drawer is mostly DOM — covered by
  manual exercise + a minimal unit test that asserts the drawer
  shows the right entry id.

---

## 4. Validation + cutoff

### 4.1 Validation quest — "The Lighthouse Vigil"

A third authored quest, designed *before* the bindings are
implemented so the API shapes fall out of real use:

**Setup**

- A new "Lighthouse Keeper" NPC stands at the west wall.
- Three "vigil shrines" placed around the level — one near each
  piston (the elevator + the trap), one on the floating island.
- The shrines are interactable zones; each holds a "vigil rune"
  pickup with a stable id.
- A new weather zone authored in the level: a small "magic"
  preset above the lighthouse. Inactive by default.

**Loop**

1. Talk to the Keeper. He asks the player to "stand vigil at the
   three shrines until dawn."
2. The Keeper grants a checkpoint at his feet
   (`player.setCheckpoint(player.position)`).
3. Player interacts with each shrine. On interaction:
   - Picks up the vigil rune (stable id).
   - The shrine's pickup spawns *another* shrine elsewhere via
     `pickups.spawn(..., { id })` — the trail.
   - When all three runes are picked up, the script:
     - Enables the lighthouse weather zone
       (`weather.setZoneEnabled('zone.lighthouse', true)`).
     - Disables the trap piston (`pistons.setEnabled('piston.trap', false)`)
       so the player can walk past it safely.
     - Updates the checkpoint to a spot near the lighthouse
       (`player.setCheckpoint({ x: 8, y: 5, z: 8 })`).
4. If the player dies mid-quest, they respawn at the checkpoint
   instead of `meta.spawn`. The shrines they already cleared stay
   cleared (existing pickup-id semantics handle this).
5. Final stage: return to the Keeper. He despawns the lighthouse
   weather zone (`weather.setZoneEnabled(..., false)`) and the
   remaining unused vigil shrines
   (`pickups.despawn('vigil.shrine.X')`).

**Bindings exercised**

| Binding | Quest call site |
| ------- | --------------- |
| `pickups.despawn` | Keeper turn-in cleans up leftovers |
| `pickups.exists` | Resume-after-death checks per-shrine state |
| `pistons.setEnabled` | Lighthouse access opens after 3rd rune |
| `pistons.flip` | (Optional flavour: Keeper interaction flips elevator down) |
| `player.setCheckpoint` | Quest start + lighthouse arrival |
| `player.clearCheckpoint` | (Optional: quest fail state) |
| `weather.setZoneEnabled` | Lighthouse aura appears + disappears |
| `weather.setZonePreset` | (Optional: night shrine swaps to 'storm' preset) |
| `level.spawn` | "Teleport home" beat after completion |

If this quest reads cleanly against the bindings spec, Slice 3 is
done. If it doesn't — for any binding — we revisit the surface
before shipping. (This is the Lantern Trial pattern that worked
last time.)

### 4.2 Implementation ordering inside Slice 3

Smallest → largest:

1. **sourceURL pragma** (1 LOC change in `compile.ts`).
2. **`level.spawn` / `level.size` / `level.name` getters** (small
   facade + bindings + test).
3. **`pickups.despawn` + `pickups.exists`** (3 helpers in
   `pickups.ts`, binding plumbing, tests).
4. **`player.setCheckpoint` + restart-system hook** (small
   surface, single-line behavior change in `restart-system.ts`).
5. **`weather.setZoneEnabled` + `setZonePreset`** (mid-sized —
   `VisualFxZoneSystem` refactor to keep params, attach handle,
   facade wiring, tests).
6. **Pistons with stable ids** (largest — touches piston-system,
   demo-level config, world type, bindings, tests).
7. **Per-script error reporter in Logic tab** (UI work, last).
8. **Write the Lighthouse Vigil quest** as the validation pass.
9. **Update `script-engine.md` §3 + §11 status table.**

Each step ends green (typecheck + tests). No bundling, no
half-states.

### 4.3 Out of scope (deferred to a later cleanup pass)

- **`ZoneScriptAction` legacy migration**. The legacy union still
  works alongside the new script engine; nothing in production
  uses it. Migration is a cleanup pass, not feature work — it'll
  land as a Slice 4 "deprecation sweep" once we're sure nothing
  external depends on it.
- **Multi-bubble `ui.say` + `ui.clear`**. Still flagged from
  Slice 1.5; still not hit by any authored quest. The Lighthouse
  Vigil might trip it (two NPCs), in which case we revisit.
- **Editor's live-script preview / Apply button.** The editor
  doesn't run the script engine; making it do so is a separate
  product decision worth a design pass.
- **Persistent checkpoints across saves**. Checkpoints are
  per-session for now. Persistence is a save-game concern.
- **Named-place registry (`level.coord('lantern.position')`)**.
  Flagged in the Slice 1.5 review. Quests have been working around
  it with literal coords; we'll revisit once a quest genuinely
  needs symbolic references.
- **Dialogue API beyond `ui.say`**. The current shape works for
  both authored quests; a richer dialogue tree is a separate
  product decision.

### 4.4 Acceptance criteria

Slice 3 is "done" when, in this order:

- [ ] All seven bindings above implemented + tested.
- [ ] Typecheck + full test suite green (estimated +25 new tests
  → ~334 total).
- [ ] The Lighthouse Vigil quest authored end-to-end, in
  `examples/scripts/lighthouse-vigil.js`, with a paired test
  driving the live script through the runtime.
- [ ] `docs/script-engine.md` §3.2 + §11 updated to reflect what
  shipped.
- [ ] A short closeout note appended to this doc (§5 below, to be
  filled in post-implementation).
- [ ] No regressions in the existing Fragments / Lantern Trial
  test suites.

---

## 5. Closeout (to be filled in after implementation)

_This section is empty by design. Once Slice 3 ships, append:_

- _Final binding shapes (link to commit)._
- _What the Lighthouse Vigil exposed about the bindings._
- _Anything the plan got wrong + why._
- _What's deferred to Slice 4._

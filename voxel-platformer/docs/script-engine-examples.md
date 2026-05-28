# Script Engine — Canonical Use Cases

Companion to `script-engine.md`. Three example scripts written against
the proposed API, one per primary usage area. The point is design by
example: write the scripts we want to author, then derive the minimum
API surface that lets us author them comfortably.

The three areas, restated:

1. **One-off / situational code** — small fragments attached to a
   place, an item, or a moment. May fire once, may fire whenever the
   situation recurs. The biggest category by volume.
2. **Engine / content separation** — scripts never touch engine
   internals. The API is the seam. Content authors can edit scripts
   without touching `src/engine/`.
3. **Quests, location logic, events, cinematics** — the four
   content-authoring shapes. Three of them are state machines over
   time (quest = progress flag, location = zone ambient, cinematic =
   timed beats). Events are the trigger surface that drives the
   other three.

Each canonical example below targets one of those shapes. The set is
deliberately small — three good examples shape the API better than
twenty incidental ones.

---

## 0. The API these examples assume

The minimum surface, derived bottom-up from the three examples and
trimmed of everything we can do without:

```ts
// Registration / triggers
on(event: string, filter?: object, handler: Handler, opts?: { once?: boolean }): Disposer
once(event: string, filter?: object): Promise<Event>
emit(event: string, data?: unknown): void

// Coroutine
wait(seconds: number): Promise<void>

// Host bindings (the only ways to touch the world)
player.position                 // { x, y, z } — getter
player.inventory.gold           // number — getter
player.inventory.arrows         // number — getter
player.settings                 // PlayerSettings snapshot
player.setSettings({ moveSpeed: 7, torch: { intensity: 4 } })
player.setAbility('bow', false)
player.teleport(x, y, z)
player.kill(reason?: string)

chunks.setBlock(x, y, z, block)
chunks.fillBlocks(min, max, block)
chunks.getBlock(x, y, z): number

audio.play(soundId, opts?: { loop?, volume?, fade? })
audio.stop(soundId)

pickups.spawn(kind, pos, opts?: { amount?, id?, label? })
pickups.despawn(id): boolean         // true if a live pickup was removed
pickups.exists(id): boolean          // true if the id is currently live

ui.say(targetId, message, opts?: { seconds? })
ui.dialogue({
  npc?: { id?, name, avatar? },
  player?: { id?, name, avatar? },
  lines: [{ speaker?, text, choices?: [{ id, text }] }]
}): Promise<{ choiceId?, choiceIndex?, text? }>

// Dialogue avatars use replaceable PNG keys such as `keeper`, `player`,
// `sundial`, `book`, and `npc`, or an explicit image path like
// `/avatars/merchant.png`.

flags.get(name)
flags.set(name, value)

level.spawn                     // VoxelCoord (fresh copy per read)
level.size                      // number (XZ extent)
level.name                      // string

player.checkpoint               // VoxelCoord | null
player.setCheckpoint(pos?)      // pos omitted ⇒ player.position
player.clearCheckpoint()

weather.setZoneEnabled(id, on): boolean   // toggle level-authored FX zone
weather.isZoneEnabled(id): boolean
weather.setZonePreset(id, presetId): boolean   // swap preset on the same zone

zone.contains(zoneId, who?: 'player' | VoxelCoord): boolean
time.now                        // sim-seconds since level start
random(min, max)                // seeded uniform
log(message)
```

Built-in event names: `level-start`, `zone-enter`, `zone-exit`,
`pickup-taken`, `timer`, `input`, `player.died`. Custom events are
any string the author picks (`'quest.amulet.complete'`,
`'shop.unlocked'`, …) — same `on` / `emit` for both.

That's the whole list. Twelve verbs, eight events. Everything in the
three examples uses only this surface.

Stubs for future categories — `camera.*`, `dialogue.*`, `npc.*`,
`hud.*` — appear in Example 3 but are flagged as v2. They drop in
without touching anything in this core.

---

## 1. Location design — "The Whispering Grove"

**Goal.** A small forest clearing that feels alive. When the player
enters, soft music fades in. After 6 seconds the grove "speaks." If
the player lingers for 10 seconds on their first visit, the moss
parts and a hidden chest appears. Music fades out when they leave.

No quest, no story, no progress. Just a place with character.

```js
// whispering-grove.js — location ambient + hidden first-visit reveal

const GROVE = 'zone.grove.whispering'

// Ambient: music + greeting on each entry, silence on each exit.
on('zone-enter', { zoneId: GROVE }, async () => {
    audio.play('music.grove', { loop: true, fade: 1.5 })
    log("The grove falls quiet.")
    await wait(6.0)
    log("'Do you remember the song?'")
    audio.play('sfx.whisper')
})

on('zone-exit', { zoneId: GROVE }, () => {
    audio.stop('music.grove')
})

// First-visit only: linger 10 seconds, the moss parts.
on('zone-enter', { zoneId: GROVE, once: true }, async () => {
    await wait(10.0)
    if (!zone.contains(GROVE, 'player')) return
    chunks.setBlock(45, 1, 28, 12)
    log("The moss parts. A chest emerges from the loam.")
})
```

**What this exercises.**

- One zone owns three handlers — two ambient (re-fire on every
  visit), one rare (`once: true`). Co-locating them is the whole
  point: this file *is* the grove's behaviour.
- `once: true` removes flag boilerplate.
- `wait(10.0)` + `zone.contains` after the wait is enough to express
  "still here 10 seconds later." No new primitive needed.
- Music lifecycle ties to enter/exit pairing — no manual reference
  counting.

**What I deliberately did NOT need.**

- A `zone-inside` periodic trigger. The `wait + contains` pattern
  covers it. Adding `zone-inside` would only matter if HUD updates
  needed per-frame work, which `log` doesn't.
- A `levelData.spawnMarker` or other custom data structure. The
  chest is just a voxel write to a known coord.
- Cancellation. If the player leaves at second 9.9, the chest
  doesn't spawn (the `contains` check fails) and no cleanup is
  needed. The handler ends naturally.

---

## 2. Sample quest — "The Lost Amulet"

**Goal.** A small three-step quest. The priestess NPC tells the
player to fetch a lost amulet from the eastern crypt. The player
picks the amulet up. The player returns to the priestess and is
rewarded with 25 gold. The state persists across saves, so reloading
mid-quest doesn't reset progress.

```js
// quest-lost-amulet.js — three-step quest with persistent state

const STATE = 'quest.amulet.state'   // 'unknown' | 'asked' | 'found' | 'done'

// Talking to the priestess (= entering her zone). Behaviour
// branches on quest state — same trigger, three different beats.
on('zone-enter', { zoneId: 'priestess.steps' }, () => {
    const state = flags.get(STATE) ?? 'unknown'

    if (state === 'unknown') {
        flags.set(STATE, 'asked')
        log("Priestess: 'My amulet was lost in the eastern crypt.'")
        log("Priestess: 'Bring it home and you'll have my thanks.'")
    } else if (state === 'asked') {
        log("Priestess: 'The crypt lies past the broken bridge.'")
    } else if (state === 'found') {
        flags.set(STATE, 'done')
        log("Priestess: 'You found it. Bless you, traveller.'")
        pickups.spawn('coin', { x: 8, y: 1, z: 4 }, { amount: 25 })
        emit('quest.amulet.complete')
    } else {
        log("Priestess: 'May the path stay clear.'")
    }
})

// Picking up the amulet only advances the quest if the priestess
// has already asked for it. Found out of order ⇒ player carries an
// inert curio.
on('pickup-taken', { pickupId: 'amulet.lost' }, () => {
    if (flags.get(STATE) === 'asked') {
        flags.set(STATE, 'found')
        log("The amulet hums in your hand. The priestess will want this.")
    }
})
```

**What this exercises.**

- Quest progression as a single string flag with four states. No
  custom state-machine library, no class hierarchy — `flags` is the
  state.
- One zone, four conversation branches. The `if` ladder reads like a
  dialogue script, which is what the author actually wants to think
  about.
- Decoupling: the amulet pickup script doesn't know what zone the
  priestess lives in; the priestess script doesn't know where the
  amulet is. They communicate only through the `STATE` flag.
- `emit('quest.amulet.complete')` lets other scripts (a follow-up
  quest, an achievement listener, music change) react without this
  file knowing about them.

**What I deliberately did NOT need.**

- A "quest object" type. The quest is six lines of branching and a
  flag.
- A `quest.start / quest.advance / quest.complete` API. The same
  three lines of `flags.set` do the work; abstracting them would only
  pay off across many quests with shared lifecycle, which we don't
  have.
- A reward system. `pickups.spawn` IS the reward.

---

## 3. Cinematic — "Awakening"

**Goal.** Level intro that runs the first time the player loads this
level. Player wakes up; controls are locked; the camera pans across
the scene; three lines of dialogue play with timed beats; music
swells; control returns to the player. Subsequent loads skip the
intro.

Camera, dialogue, and input-lock are not in the v1 binding list. The
example uses **stub bindings** to demonstrate that the script engine
itself doesn't need to change when those land — they're new
categories of host adapters, nothing else.

```js
// cinematic-awakening.js — first-load intro

on('level-start', async () => {
    if (flags.get('intro.shown')) return
    flags.set('intro.shown', true)

    // Future bindings (v2). The script engine doesn't know what
    // they do; it just calls into them as more host adapters.
    player.setControlsLocked(true)
    camera.lookAt({ x: 32, y: 4, z: 16 }, { duration: 1.5 })

    audio.play('music.dawn', { fade: 2.0 })
    await wait(2.0)

    log("The cold air bites your cheeks.")
    await wait(2.5)

    log("You don't remember falling asleep here.")
    await wait(2.5)

    log("But the path ahead is the only way back.")
    await wait(2.0)

    camera.followPlayer({ duration: 1.0 })
    player.setControlsLocked(false)
})
```

**What this exercises.**

- Linear async control flow. The author writes time as a sequence
  of `await wait(N)` calls and reads top-to-bottom like a film
  script.
- One-shot at level-start via a single flag.
- Cinematic's three external collaborators — audio, camera,
  controls — are independent host categories. The script engine has
  no opinion about them; they're just more bindings on `ctx`.

**What I deliberately did NOT need.**

- A "timeline" or "sequence" primitive. The `async`/`await` pair
  already is one.
- A "skip cinematic" affordance. If we want one, the implementation
  is `await Promise.race([cinematic(), once('input', { action:
  'jump', edge: 'pressed' })])` — three primitives we already have.
- A dialogue tree. Plain `log` (and future `dialogue.show`) is one
  call per beat. Trees are quest territory, not cinematic.

---

## Synthesis

What the three examples agree on:

1. **The trigger registration is `on(eventName, filter, handler)`.**
   Every script in this doc starts with `on(...)`. Add `once: true`
   as opt-in for the one-shot case and you've covered every shape
   the three examples produce.
2. **State is `flags`.** Quests, first-visits, intro-shown — all of
   them are a string-keyed value store. The three examples don't
   touch a single line of class hierarchy or per-entity data
   beyond what `flags` provides.
3. **Time is `wait(seconds)`.** Cinematics, ambient delays, "stay
   here 10 s" — all the same primitive. The fixed-step engine
   resolves them on `simTime`; the script reads as if it were
   wall-clock time.
4. **Cross-script coordination is `emit / on`.** A custom event
   name is the entire API for "another script wants to know when
   this quest completes."
5. **Host capability is namespaced objects, not free functions.**
   `player.teleport`, `chunks.setBlock`, `audio.play`. Adding new
   categories (camera, dialogue, npc) doesn't require any change to
   the script engine itself — just new objects on `ctx`.

What the examples reveal we should add to `script-engine.md`:

- `once: true` flag on trigger registration.
- `on(...)` returns a disposer; `once(event, filter)` returns a
  Promise. Both are mentioned in passing in the earlier brainstorm;
  spec them in §3 of the design doc.
- `audio.play({ fade })` for cross-fade — currently only `volume` /
  `loop` were listed.
- `pickups.spawn` returns an id (so a future `pickups.despawn` is
  symmetric).
- Engine-emitted built-in events: `player.died`, `level.reset`.
  Scripts can `on('player.died', ...)` for cleanup work even without
  explicit cancellation primitives.
- A short note in §2.5 of the design doc: handlers see their level's
  `flags` *as of registration time*; subsequent reads pick up live
  values. The Lost Amulet example relies on this.

Nothing in the three examples demands an architectural change. The
runtime stays a tree of `AsyncFunction`s, a wait queue, and a
trigger dispatcher. The minimum API in §0 above is what should ship
in Slice 1.

---

## What the examples deliberately exclude

To stay minimalistic, none of these examples uses:

- A node graph or rule sheet.
- An in-engine code editor.
- Per-row validation in the editor.
- A sandbox.
- Per-script TypeScript compilation. The `.d.ts` lives in the user's
  IDE, not in the engine.
- Save-mid-cinematic resumption. If the player reloads during the
  intro, the intro skips (because `intro.shown` was set on entry)
  and they spawn in the post-cinematic state. Good enough for v1.

These omissions match the three usage areas: one-off code, content
isolation, and quest/location/cinematic authoring. Any of them could
be added later without breaking the three examples above — which is
how we'll know the design held up.

# Script API cheat-sheet

Condensed lookup of the full global surface. Authoritative source:
`voxel-platformer/src/engine/script/types.ts` and the typed contract
`voxel-platformer/types/script-api.d.ts`. Prose + rationale:
`docs/script-engine.md` §3.

## Registration & events

```js
on(event, filter?, handler, opts?)   // → Disposer; opts = { once?: boolean }
once(event, filter?)                 // → Promise<payload>; self-disposing
emit(event, data?)                   // wake matching on(); resolve matching once()
```

- Filter is matched by **strict equality per key** against the payload. A
  missing/typo'd key → no match → handler silently never fires.
- `once: true` may sit in `opts` (4th arg) **or** inside the filter object;
  both are lifted to registration. `once` is therefore a reserved filter key.
- Handlers are `(event) => void | Promise<void>`. Async handlers aren't
  awaited by the engine; rejections are caught and surfaced, not fatal.

Built-in events: `level-start`, `level.reset`, `zone-enter`, `zone-exit`,
`pickup-taken`, `input`, `timer`, `player.died`, `flag.changed`. (See
SKILL.md for filter keys + payloads.) Everything else is a custom event.

## Coroutine, time, randomness

```js
await wait(seconds)   // resolves when sim-time advances past the deadline
time.now              // sim-seconds since level start / last Apply (getter)
time.tick             // integer fixed-tick count (getter)
time.delta            // seconds in the most recent tick (getter)
random(min, max)      // seeded uniform [min, max)
```

Deterministic: `wait`, `time.*`, `random` are all sim-clock / seeded-RNG
driven. `Date.now()` and `Math.random()` are not — don't use them.

## flags (persistent level state)

```js
flags.get(name)               // → number | string | boolean | undefined
flags.set(name, value)        // persists with the level; emits flag.changed on change
```

Reads are live within a tick. This *is* the quest/progress mechanism.

## player

```js
player.position            // {x,y,z} getter; NaN coords while dead/respawning
player.alive               // boolean — explicit "is there a player"
player.inventory.gold      // number getter
player.inventory.arrows    // number getter
player.settings            // PlayerSettings snapshot
player.checkpoint          // VoxelCoord | null (this session)
player.teleport(x, y, z)
player.kill(reason?)
player.setCheckpoint(pos?) // pos omitted ⇒ current position; no-op while dead
player.clearCheckpoint()
player.setSettings(patch)  // movement/inventory/torch/model/abilities
player.setAbility(name, on)// name: movement|jump|bow|highJump|airPush|interact|torch
player.setGold(amount)
player.setArrows(amount)
```

## chunks (voxel grid)

```js
chunks.getBlock(x, y, z)                  // → block index
chunks.setBlock(x, y, z, block)
chunks.fillBlocks(min, max, block)        // inclusive-min, exclusive-max
```

## pickups

```js
pickups.spawn(kind, pos, opts?)  // opts = { amount?, id?, label? } → id (stable if id given)
pickups.despawn(id)              // → boolean; does NOT fire pickup-taken
pickups.exists(id)               // → boolean
```

## pistons (level-authored, by id)

```js
pistons.setEnabled(id, on)  // → boolean (false = unknown id)
pistons.isEnabled(id)
pistons.flip(id)            // → boolean (false: unknown/disabled/physical-mid-travel)
pistons.list()              // → string[] (registration order; unnamed pistons excluded)
```

## stones (physics stones + falling-stone spawners)

```js
stones.spawn(pos, opts?)             // opts = { id?, tier?, size?, velocity?, ...StoneSpawnOptions } → id
stones.remove(id)                    // → boolean
stones.exists(id)
stones.setSpawnerEnabled(id, on)     // → boolean
stones.isSpawnerEnabled(id)
stones.triggerSpawner(id, count?)    // → number spawned
stones.listSpawners()                // → string[]
```

## npc (runtime NPCs, patrol, simple combat)

```js
npc.attack(id)                       // play attack swing; false if unknown/dead
npc.die(id)                          // topple + despawn; false if already dying
npc.exists(id)
npc.list()
npc.setWaypoints(id, points)         // [] hold, [p] guard, many loop patrol
npc.goTo(id, point)                  // walk to one point and hold
npc.stop(id)                         // clear route; hold current spot
npc.setPerceptionRadius(id, radius)
npc.setHostile(id, target, hostile)  // target = 'player' or another NPC id
```

Hostility is script-defined; there is no faction table. Current NPC combat is
simple: hostile NPCs path toward enemies, play a swing, and apply 1 HP damage
unless the player shield is raised in the frontal arc.

## audio

```js
audio.play(soundId, opts?)   // opts = { volume?, loop?, fade? }; fade cross-fades; → handle
audio.stop(handleOrSoundId, opts?)  // opts = { fade? }
```

## zone

```js
zone.contains(zoneId, who?)  // who = 'player' (default) | VoxelCoord → boolean
zone.exists(zoneId)
zone.isActive(zoneId)
zone.setActive(zoneId, on)   // → boolean; deactivating mid-overlap synth's zone-exit
```

## ui (popups + dialogue)

```js
ui.say(targetId, message, opts?)  // opts = { seconds? }; same target queues, diff targets parallel
ui.clear(targetId?)               // dismiss one target's bubbles, or all
await ui.dialogue({               // centered modal; resolves after last line / choice
  title?,
  npc?: { id?, name, avatar?, side?, voice? },
  player?: { id?, name, avatar?, side?, voice? },
  speakers?: [{ id?, name, avatar?, side?, voice? }],
  lines: [{ speaker?, name?, avatar?, voice?, text, choices?: [{ id, text, disabled? }] }]
})  // → { choiceId?, choiceIndex?, text? }
```

Avatar values: built-in keys `keeper|player|sundial|book|npc`, an image
path (`/avatars/x.png`), or any string (→ labelled badge).
Dialogue `voice` uses generated fantasy-babble presets (`dwarf`, `troll`,
`elf`, `undead`, `player`, etc.) and plays only in modal `ui.dialogue`.
Floating `ui.say` bubbles are intentionally silent.

## dayCycle

```js
dayCycle.hour                 // getter [0,24)
dayCycle.enabled              // getter
dayCycle.setHour(hour)
dayCycle.setEnabled(on)       // pause/resume the clock
dayCycle.setSpeed(secondsPerDay)
```

## weather

```js
weather.setRain(on) / setSnow(on) / setLightning(on)
weather.applyPreset(id)            // clear|cloudy|rain|storm|snow|dawn → boolean
weather.setZoneEnabled(zoneId, on) // toggle a level-authored FX zone → boolean
weather.isZoneEnabled(zoneId)
weather.setZonePreset(zoneId, presetId)  // re-spawn zone with new preset → boolean
```

## travel

```js
travel.to(levelId, opts?)   // opts = { arrivalId? } — hot-swap to a library level
travel.reload(opts?)        // opts = { arrivalId? } — restart current location
```

## level (read-only)

```js
level.spawn   // VoxelCoord getter (fresh copy)
level.size    // number (XZ extent)
level.name    // string
```

## geom (pure helpers)

```js
geom.box(min, max, point)  // inclusive-min, exclusive-max AABB test → boolean
geom.distSq(a, b)          // squared distance: use distSq(a,b) < R*R
```

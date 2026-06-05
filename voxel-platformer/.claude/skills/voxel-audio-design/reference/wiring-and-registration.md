# Registration & wiring

## 1. Register the asset (`src/game/audio.ts`)

Two edits per sound:

```ts
// (a) a stable id constant in the GameAudio map — group with its siblings.
export const GameAudio = {
    // …
    MeleeHit: 'sfx.melee.hit',
    SpellBoltCast: 'sfx.spell.bolt.cast',
    MusicStart: 'music.amb.start',
} as const

// (b) a manifest entry under the matching group of GAME_AUDIO_MANIFEST.
const path = (file: string): string => `/audio/8bit/${file}`
export const GAME_AUDIO_MANIFEST: AudioManifest = {
    sounds: [   // sfx bus: one-shots + spatial loops
        { id: GameAudio.MeleeHit, url: path('melee-hit.wav'), volume: 0.52, maxInstances: 5, priority: 3 },
    ],
    music: [    // music bus: looping beds (loop: true)
        { id: GameAudio.MusicStart, url: path('amb-start-loop.wav'), volume: 0.34, loop: true, priority: 1 },
    ],
    stingers: [ // ducks the music bus while it plays
        { id: GameAudio.DeathStinger, url: path('death-stinger.wav'), volume: 0.78, priority: 9 },
    ],
}
```

- `maxInstances` caps concurrent copies (voice-stealing by priority). Keep it
  small for rapid cues (combat 4–5) so a flurry doesn't swamp the mix.
- `priority` decides who survives voice contention.
- The editor's Sound-tab music dropdown is generated from
  `GAME_AUDIO_MANIFEST.music` automatically — registering is enough to make a
  bed selectable.

## 2. Re-lock the hash (`tests/audio-assets.test.ts`)

The test iterates a table of `{ bytes, sha256 }` per file and fails on any
drift. Add or update the entry for every file you changed:

```ts
'melee-hit.wav': { bytes: 6659, sha256: '96cec2…' },
```

Values come from `stat -c%s` and `sha256sum` on the generated file. This is a
deliberate contract — it forces anyone touching the synth to opt the new bytes
into the build.

## 3. Play it

### From a system (the dominant pattern)

Gameplay systems don't touch the `AudioEngine`. They expose `onX` callbacks;
`src/client.ts` owns the single `audio` instance and wires each callback to a
play call. To add a cue on a new event, add an optional callback to the
system's options and fire it where the event happens (pass a world position if
you want spatial sound), then wire it in `client.ts`.

```ts
// AudioEngine methods (src/engine/audio/audio-engine.ts):
audio.play(id, { deferUntilUnlocked: true, rate, volume })            // flat one-shot
audio.playSpatial(id, { x, y, z }, { deferUntilUnlocked: true, rate,  // positioned
    refDistance: 4, maxDistance: 30, rolloffModel: 'linear',
    panningModel: 'equalpower', priority })
audio.playMusic(id, { volume, loop: true, crossfade: 0.6 })           // music bus
audio.playStinger(id, { deferUntilUnlocked: true })                   // ducks music
audio.stopMusic(fadeOut)
```

Conventions to follow:

- Always pass `deferUntilUnlocked: true` on one-shots so a cue fired before the
  user's first interaction still plays once audio unlocks.
- **Jitter `rate` here, in the callback** (`0.94 + Math.random() * 0.12`) for
  per-hit variety — the synth itself is deterministic and identical every play.
- Use **`playSpatial`** for anything that happens *in the world* (impacts,
  zaps, NPC cues) so distance/pan place it; use flat **`play`** for
  player-centric cues (your own cast, hurt, jump, UI). `src/client.ts` has a
  `playSpatialSfx(id, x, y, z, priority)` helper — reuse it.
- One-shots clean themselves up (`voice.onEnded` removes the voice and
  disconnects nodes), including stolen voices — no manual disposal.

### As a level music bed

Set the level metadata `environment: { soundId, volume }` (in `level.ts` /
`procedural-levels.ts`, or the editor Sound tab). `startEnvironment` plays it
on the music bus and **`environment.volume` overrides the asset's manifest
volume**. `null`/empty `soundId` means silence.

### From a script

The script audio API (see the `voxel-script-authoring` skill) is:

```js
audio.play(soundId, { volume, loop, fade })  // music ids cross-fade; sfx defer
audio.stop(handleOrSoundId, { fade })
```

Used e.g. to swap to a tension bed when an NPC turns hostile:
`audio.play('music.amb.tension', { fade: 1.5 })`.

## Buses & mixing

`master` → `music` (ducked by stingers) / `sfx` / `ui` / `stinger`. The
manifest group an asset lives in picks its bus. Stingers (`playStinger`)
temporarily duck the music bus; one-shots go to `sfx`.

## Gotchas

- Editing the synth without re-running `npm run audio:samples` ships stale
  bytes; re-running without updating the hash table fails the test. Do both.
- `mix(duration, …)`'s first arg is **duration in seconds**, not gain.
- Don't add the same cue at two layers — e.g. a Frost Nova hit already layers
  the spatial `nova-hit` with the NPC's `npc-hurt` grunt (because `damageNpc`
  raises the hurt flag). That stacking is intended; just be aware of it when
  budgeting `maxInstances`.
- New manifest entries are additive and safe; the editor and tests discover
  them automatically. Removing/renaming an id means updating every call site
  and the hash table.

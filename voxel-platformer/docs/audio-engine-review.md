# Audio engine — critical review and roadmap

_Drafted 2026-05-25, before any implementation. The companion file is
`improvements.md` (broader project backlog); this one is audio-specific
and meant to be picked up directly._

## TL;DR

The engine knows how to **mix** sound; it doesn't know how to **place**
sound. Every surface that's present (per-bus analyser meters, stinger
ducking, per-clip detune sliders, music crossfade deck, waveform
inspector) answers a *mixing-desk question*; almost nothing answers the
gameplay question *"the player is here, looking that way — what do they
hear?"*. To make this useful for a voxel platformer the next pass is
**3D spatial audio + a listener + position-aware emitters + sound
variants + an ECS bridge** — that's table stakes you can't ship
without. The demo also needs to stop being a clip auditioner with a
mixer skin and start being a tiny gameplay simulator (movable listener
in a scene, placed emitters, environment swap, music state slider).

## What's there today

**Engine** (~600 LoC across `src/engine/audio/`):

- 5-bus mixer (master / music / sfx / ui / stinger) with linear
  parameter ramps and a global mute
- Manifest-loaded asset registry (`loadManifest`, `addAssets`,
  `removeAsset`); SFX / stinger / music categories
- `play` / `playStinger` / `playMusic` returning awaitable handles
- Voice limit with priority-based stealing + per-asset `maxInstances`
- Stinger ducking (drops music bus to 0.58 while a stinger is alive)
- Music crossfade between tracks via `<audio>` + `MediaElementSourceNode`
- Per-bus `AnalyserNode` exposed via `createAnalyser()`
- StereoPanner per voice (`pan: -1..+1`) — no 3D
- Deferred-until-unlocked queue for sounds played before the user
  gesture; pending music slot
- ECS hookup: `audio-unlock-system` listens for the first
  pointerdown/keydown and calls `audio.unlock()`

**Demo** (`sound-demo.html` + `src/sound-demo.ts`, ~730 LoC):

- 3-column layout — asset browser (left), transport + 8 sliders +
  music deck + 3 stress buttons + waveform (centre), mixer + dB
  meters + log (right)
- Local file import (drag a WAV in, audition it)
- Waveform peak rendering with offline decode

**Tests** (`tests/audio-*.test.ts`): ~20 unit tests via a `FakeBackend`
— manifest validation, asset caching, voice stealing math, ducking
lifecycle, crossfade disposal.

**Game integration** (`src/game/audio.ts`): a flat manifest of 5 SFX
(pickups, bow, hit, death), 4 music loops (calm / action / cave /
background), 1 stinger (death). Nothing currently *drives* music
transitions from gameplay state.

## The DAW shape, made concrete

| Surface present today | Mixing-desk question it answers | Gameplay question it doesn't answer |
|---|---|---|
| Per-bus `AnalyserNode` + dB meters | "How loud is each bus running?" (post-production mixing) | — |
| Stinger ducking via volume ramp | "How do I side-chain the music?" (mastering) | — |
| Waveform inspector | "What does this sample look like?" (clip auditioning) | — |
| Manual detune slider (±1200 cents) | "Can I pitch-shift this clip?" (DAW pitch-shift) | "Should my footsteps vary pitch automatically?" |
| Crossfade slider on the music deck | "How long is this transition?" (mixing transitions) | "Should music react to combat state?" |
| Per-clip fadeIn / fadeOut sliders | "How do I shape this clip?" (envelope editing) | — |
| `maxInstances` + `priority` sliders | "How do I cap my voice budget?" (this one is genuinely gameplay-shaped) | "Should this asset cooldown between plays?" |
| `pan: -1..+1` | Constant stereo placement | "Where in the 3D scene is this emitter relative to the listener?" |

## Critical gaps (gameplay perspective)

### Tier 1 — no game ships without these

1. **3D listener with position + orientation.** Web Audio has
   `AudioListener` and `PannerNode` (HRTF / inverse-distance / linear /
   exponential). None of it is used. There's no `setListenerPose(camera)`
   API; gameplay can't say *"the player is here looking that way"*.
2. **3D emitter positions.** `playBuffer` takes `pan: number` — that's
   the entire spatial vocabulary. No `position: Vec3`, no `velocity`
   (so no doppler), no `refDistance` / `maxDistance` / `rolloffFactor`
   per asset.
3. **Distance attenuation curves.** Walking toward a piston should
   make it louder. There's no way to express that — everything plays
   at constant volume modulated only by the bus slider.
4. **Sound-variant pools.** `play('hit')` always plays the same
   `hit.wav`. Real game audio has `play('hit')` pick from N variants
   with random pitch ±50 cents — at the call site, not via a UI
   slider. The whole point is the call is parameterless and the
   engine injects variety.
5. **Retrigger cooldown.** `maxInstances: 5` doesn't stop 5 voices
   firing in the same frame and machine-gunning the ears. No
   `minRetriggerInterval` for "this asset can fire at most every 80
   ms".
6. **ECS bridge.** No `AudioEmitter` component, no system that ticks
   emitters against the listener each frame. Audio is invoked
   imperatively from gameplay code, which means moving emitters can
   never update their pan/volume.

### Tier 2 — any decent game has these

7. **Music state machine, not a music deck.** The engine has
   `playMusic('a')` → crossfade → `playMusic('b')`. Real game music
   wants either *layered stems* (calm + tension layers cross-blended
   on a 0..1 parameter the gameplay drives) or a named-state state
   machine (explore / combat / boss / menu with rules). With 4
   background loops sitting in the manifest, gameplay code would
   itself have to call `playMusic` at the right moment — and there's
   nowhere that "right moment" is defined.
8. **Environment / snapshot system.** No reverb (no `ConvolverNode`),
   no low-pass (no `BiquadFilterNode`). Underwater sounds identical to
   open air. There's no `setEnvironment('cave')` that swaps a reverb
   impulse + a low-pass cutoff + bus mix in one call.
9. **Audio trigger zones.** The game *already* has
   `ZoneTriggerSystem`. None of it connects to audio — entering a
   cave doesn't change the music or the reverb.
10. **localStorage-persisted user volume.** Settings reset every
    reload.

### Tier 3 — nice-to-have

11. Side-chain compression instead of manual stinger ducking
    (better-sounding, no manual ramp tuning).
12. Bar-aligned music transitions (today the crossfade can land
    mid-bar).
13. Audio occlusion (raycast from emitter to listener → low-pass +
    volume drop when terrain is between them).
14. Streaming-vs-decoded asset hint per asset (today all music goes
    via `<audio>` which can't be sample-accurately scheduled).

## What the demo doesn't test from a gameplay angle

The three stress buttons (`Rapid SFX`, `Voice Limit`, `Duck Test`) are
the entire gameplay-flavour layer of the demo. None of them simulate:

- A **moving listener** in a scene — you can't audition how a bow
  whistle attenuates as you walk past
- A **placed emitter** — there's no "drop a sound source at world
  (5, 0, -3)" workflow
- **Gameplay events firing audio** — no "press F to fire bow" with a
  3D position attached
- **Music state transitions** — no "tension goes 0.2 → 0.8, hear the
  action layer mix in"
- **Environment changes** — no "switch to cave preset, hear the
  reverb + low-pass"
- **Stinger + side-chain on combat music** — the duck test ducks the
  *idle* track; the realistic case is "death stinger during combat
  music"
- **Priority stealing under pressure** — the voice-limit test fires
  identical sounds; the real question is "does a critical sound get
  reserved when 30 hit-sfx try to fire at once?"

It's a clip auditioner with a fancy mixer skin. Useful for confirming
a WAV plays. Not useful for confirming the game's sonic design works.

## Proposed implementation passes

### Pass 1 — make it spatial — **medium** (top priority)

**What.** Listener + 3D emitters + distance attenuation. After this
pass, calling `playSpatial('arrow-hit', impactPosition)` produces a
sound that pans + attenuates correctly based on the camera's
position.

**How sketch.**
- New `Listener` (singleton on `AudioEngine`): `setPose(position, forward, up)`.
  Mirrors three.js's `AudioListener` API; pushes values into the Web
  Audio `AudioListener` on the backend.
- New `audio-listener-system` (engine system) that reads the active
  camera each frame and calls `audio.listener.setPose(...)`.
- New `Audio3D` component: `position: Vec3, velocity?: Vec3,
  refDistance: number, maxDistance: number, rolloffFactor: number,
  rolloffModel: 'inverse' | 'linear' | 'exponential', attachedTo?:
  eid`.
- New `playSpatial(id, position, opts)` API → backend creates a
  `PannerNode` chain (`source → gain → panner → bus`).
- New `audio-emitter-system` that on each frame walks entities with
  `Audio3D`, syncs `attachedTo`-driven positions, and updates each
  active panner's `positionX/Y/Z` + `velocityX/Y/Z`.

**Files touched.** `src/engine/audio/types.ts` (new types),
`src/engine/audio/audio-engine.ts` (`playSpatial`, listener), new
`src/engine/audio/web-audio-listener.ts`, new
`src/engine/ecs/systems/audio-listener-system.ts`, new
`src/engine/ecs/systems/audio-emitter-system.ts`, new component in
`src/engine/ecs/components.ts`.

**Risks.** `PannerNode` HRTF on some devices is CPU-heavy at >32
simultaneous spatial voices. Use `panningModel: 'equalpower'` as the
cheap fallback and document the trade-off.

### Pass 2 — make it varied — **small**

**What.** Sound-variant pools + per-asset retrigger cooldown.
`play('hit')` randomly selects from N variants and applies a small
pitch jitter, with no caller change.

**How sketch.**
- Extend `AudioAsset` with optional `variants: { url: string;
  weight?: number }[]` and `pitchJitter?: number` and
  `minRetriggerInterval?: number`.
- When variants is set, `loadBuffer` decodes all of them; play picks
  one by weighted random.
- Apply `detune = randInRange(-pitchJitter * 100, +pitchJitter * 100)`
  cents on each play.
- Track `lastPlayedAt` per asset; reject (silently) if interval less
  than `minRetriggerInterval`.

**Files touched.** `types.ts`, `audio-engine.ts`.

### Pass 3 — make it musical — **medium**

**What.** Music state machine driving layered stems.

**How sketch.**
- New `MusicState` type with named layers, each with a `weight` 0..1.
  E.g. `{ explore: 1, combat: 0, tension: 0 }`.
- `playMusic` evolves into `setMusicState(state, ramp)`: each layer
  is a long-loop stem playing continuously, and the layer's gain
  smoothly ramps to its weight.
- Optional bar quantisation: tag each music asset with `bpm` +
  `beatsPerBar` and gate transitions to bar boundaries via
  `setValueAtTime` scheduling.

**Files touched.** `audio-engine.ts`, `web-audio-backend.ts` (new
multi-track player), `game/audio.ts` (rewrite music section).

**Risks.** Multi-stem music doubles or triples the streaming
bandwidth. Mitigate by decoding short loops to AudioBuffers instead
of `<audio>` streams.

### Pass 4 — make it environmental — **medium**

**What.** Named environment snapshots that swap a reverb impulse + a
low-pass cutoff + bus mix in one call. Hooked into the existing
`ZoneTriggerSystem` so zones drive audio.

**How sketch.**
- Insert a `ConvolverNode` + `BiquadFilterNode` between the SFX bus
  and the master. Snapshots set: convolver impulse buffer, biquad
  cutoff/Q, bus volume offsets.
- Ship built-in snapshots: `outdoor` (no reverb, no filter),
  `cave` (long reverb, slight low-pass), `underwater` (short
  reverb, heavy 800Hz low-pass, music ducked).
- New `audio.setEnvironment(name, ramp?)`.
- New zone script action `{ type: 'set-environment', name }` that
  the existing `ZoneTriggerSystem` runs on enter / exit.

**Files touched.** `web-audio-backend.ts` (insert effects nodes),
`audio-engine.ts` (`setEnvironment`), `src/engine/ecs/zones.ts` (new
script action), `src/engine/ecs/systems/zone-trigger-system.ts`.

**Risks.** Impulse responses need shipping as assets; a 3-second
cave impulse at 48 kHz stereo is ~1 MB. Generate the impulses
procedurally first.

### Pass 5 — demo rewrite — **medium**

**What.** Replace the clip-auditioner UI with a tiny gameplay
simulator that exercises Tier 1–2 features.

**How sketch.**
- A small 3D scene (top-down voxel pad like the FX demo) with a
  movable listener (WASD).
- 4–6 placed sound sources you can click to fire; each has a
  helper showing its `refDistance` / `maxDistance` circles.
- Tension slider (0..1) instead of crossfade slider — drives the
  music state machine.
- Environment buttons (Outdoor / Cave / Underwater) — drives the
  snapshot.
- "Press F to fire bow at listener's facing direction" button to
  test combined spatial + musical interaction.
- Keep the mixer column + meters but demote them to a diagnostic
  strip — not the main UI.

**Files touched.** `sound-demo.html`, `src/sound-demo.ts` (largely
rewritten), new `src/sound-demo/scene.ts`, new
`src/sound-demo/source-marker.ts`.

### Tier-3 follow-ups (un-blocked by passes 1–4)

- Side-chain compression node replacing the manual ducking.
- Bar-aligned music transitions (see Pass 3 risks).
- Audio occlusion via the existing voxel raycaster.
- Streaming vs decoded asset hint.
- localStorage volume persistence.

## Recommended order of operations

Pass 1 → Pass 2 → Pass 5 (demo for what we have so far) → Pass 3 →
Pass 4 → tier-3 polishes. The demo rewrite slots in after Pass 2 so
we can audition spatial + variant pools as soon as they exist; music
+ environment land later but get their UI affordances in the same
panel.

## Out of scope for this doc

- Reverb / impulse asset pipeline (covered by Pass 4 in skeleton only)
- AI hearing ("guard hears player") — this needs the spatial layer
  but is gameplay-side, not engine-side
- DSP effects beyond reverb + low-pass (delay, chorus, distortion) —
  not justified by current gameplay

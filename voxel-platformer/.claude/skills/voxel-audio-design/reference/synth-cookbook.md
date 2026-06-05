# Synth cookbook

All primitives live in `scripts/generate-audio-samples.mjs`. Sample rate is
`22050`, output is 8-bit mono. A "layer" is a closure `(signal) => {…}` that
adds into a shared `Float32Array`; `mix(durationSeconds, layers)` allocates the
buffer and applies each layer. Loop generators build the buffer themselves with
`make(duration)` and end with `crossfadeEnds`.

## Core building blocks

| Primitive | Signature | Sounds like / use for |
|---|---|---|
| `note` | `(start, end, hz, amp)` | Square tone with attack/release env. Melodic blips, chimes. |
| `pluck` | `(start, end, hz, amp)` | Square + exponential decay. Plucked/struck bodies, metallic partials. |
| `chirp` | `(start, end, fromHz, toHz, amp)` | Square pitch sweep. Lifts, zaps, falling "shing". |
| `noiseBurst` | `(start, end, amp, seed)` | Decaying white noise. Transients, slaps, claps. |
| `filteredNoise` | `(start, end, amp, lpHz, seed)` | Sustained one-pole low-passed noise. Air, hiss, rain, breath, reverb wash. Lower `lpHz` = darker. |
| `chirpNoise` | `(start, end, fromHz, toHz, amp, seed)` | Noise with a sweeping cutoff. Whooshes, thunder rolls, electric discharge. |
| `crackle` | `(start, end, density, ampMax, seed)` | Sparse random impulses. Fire, sparks, debris. `density` 0..1. |
| `rumble` | `(start, end, baseHz, amp, seed)` | Brownian sub-bass with a slow LFO. Weight, explosions, dread. |
| `bubble` | `(start, end, hz, amp, seed)` | Pitch-up "plop". Water, lava, soft burst bodies. |
| `kick` | `(start, amp)` | Pitched-down sine drum (~120→50 Hz). Body thump of an impact. |
| `hihat` | `(start, amp, seed)` | Very short high-passed noise. Percussive tick. |

## Music voices

| Primitive | Signature | Use for |
|---|---|---|
| `softNote` | `(start, end, hz, amp)` | Cosine-enveloped square — clickless pad/bell tone. |
| `triNote` | `(start, end, hz, amp)` | Triangle staircase — mellow bass/lead. |
| `pianoNote` | `(start, end, hz, amp)` | Additive sine harmonics + percussive decay (bright attack, mellow sustain). The acoustic-ish piano. |
| `padNote` | `(start, end, hz, amp)` | Detuned sines + soft fifth under a sine swell. Warm bed the piano floats over. Very low `amp`. |
| `waterDrop` | `(start, hz, amp)` | Pure-sine drip bending down, with two fainter echoes. Cave punctuation; use sparsely. |
| `shimmer` | `(start, end, hz, amp)` | Sine bell with an octave + a 2.76× inharmonic (glass) partial and gentle vibrato. The **"magic" voice** — smooth and ringing where `note`/`pluck` (square) read as buzzy blips. Spell chimes, sparkle, ice. |
| `sineChirp` | `(start, end, fromHz, toHz, amp)` | Clean sine pitch glide (the sine counterpart of square `chirp`). Magical zips, frost sweeps, zap glides. |
| `organNote` | `(start, end, hz, amp)` | Additive drawbar organ (fundamental + octave + twelfth + 2 octaves) at a **flat sustain** (soft attack/release, no decay). Steady where `pianoNote` decays and `padNote` swells. Organ/brass pads — Royal & Cathedral themes. |
| `crossfadeEnds` | `(signal, fadeS)` | Equal-power crossfade of the loop's tail into its head. **Required at the end of every loop.** |

## Recipe patterns

These mirror the shipped SFX — copy the closest and re-tune.

- **Body impact** (`melee-hit`, `arrow-hit`): `kick` + a low `pluck` +
  `noiseBurst` transient + a little `filteredNoise` grit. Heavy variant adds
  `rumble` and `crackle`.
- **Air whoosh / swing** (`sword-swing`, `heavy-swing`): `chirpNoise` with a
  falling cutoff + `filteredNoise` body. **No thud** — the thud is a separate
  hit cue. Heavy adds `rumble`.
- **Metallic clang** (`shield-block`): `noiseBurst` clack + 2–3 `pluck`s at
  *inharmonic* ratios (e.g. ~1 : 1.52 : 2.31) so it reads as struck steel, not
  a tuned note.
- **Electric zap** (`orb-cast`, `orb-zap`): `chirpNoise` discharge + dense
  `crackle` + a short `noiseBurst`.
- **Magic / spell** (`bolt-cast`, `bolt-hit`, `nova-*`, `orb-*`): **`shimmer`
  bells** in a consonant stack (fundamental + fifth + octave) over a
  `sineChirp` glide (rising = launch, falling = frost/zap). Keep `filteredNoise`
  faint and **darken its cutoff** (≤3 kHz) — bright noise makes magic read as
  static. Avoid square `note`/`chirp` here; they sound like chiptune blips, not
  magic. The Electric Orb adds a light `crackle` for spark.
- **Vocal grunt** (`player-hurt`, `npc-hurt`, `death`): a `chirp` falling in
  pitch (the voice) over a short `filteredNoise` breath.
- **Looping texture** (`rain`, `wind`, `fire`, `water`, `lava`): sustained
  `filteredNoise`/`crackle`/`rumble` layers, then multiply the whole buffer by
  a slow `Math.sin` LFO for gusts/flicker/waves, then `crossfadeEnds`.
- **Ambient music bed** (`amb-start`, `piano-ambient-*`): a held `padNote`
  bass/chord bed + sparse `pianoNote` phrase (5–8 notes over the loop) +
  optional high octave "glints"; `crossfadeEnds` with a long fade (0.4–0.6 s).
  Use modal colour (a Lydian #4, a tritone) for "intrigue"; keep amplitudes
  ~0.05–0.16 so it never fatigues. **Avoid a continuous high-cutoff
  `filteredNoise` "air" layer** — it reads as white noise and fatigues over a
  long session (this was a real bug; the beds sound better clean).
- **Themed/composed music** (`theme-menu/tavern/royal/cathedral`): a real
  chord progression + melody. Pick voices by mood — `pianoNote` for warm
  themes, `triNote` for folk/horn lines, `organNote` for regal/sacred pads,
  `shimmer` for choir/sparkle. Add rhythm with `kick`/`hihat` only where the
  scene wants it (e.g. the Tavern jig's oom-pah bass); keep screen/sacred
  themes drum-free. Same `crossfadeEnds` discipline.

## Adding a new primitive

Only when no combination fits. Match the existing shape: a function returning
`(signal) => {…}` that integrates by sample index, derives all randomness from
a **seeded LCG** (copy the `s = (Math.imul(s, 1664525) + 1013904223) >>> 0`
pattern — never `Math.random()`), and respects `start`/`end` in seconds. Keep
peak output near ±amp so callers can reason about headroom. Document the timbre
in a comment, as the shipped primitives do.

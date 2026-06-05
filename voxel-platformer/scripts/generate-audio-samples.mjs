import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'public', 'audio', '8bit')
const sampleRate = 22050
mkdirSync(outDir, { recursive: true })

// ── Game one-shots (enhanced) ────────────────────────────────────────

writeWav('pickup-gold.wav', mix(0.36, [
    note(0.00, 0.08, 880, 0.55),
    note(0.07, 0.18, 1320, 0.48),
    note(0.16, 0.30, 1760, 0.34),
    // New "sparkle" tail — fast descending arpeggio above the lead
    // chirps so the pickup reads as "shiny coin" not "blip".
    note(0.20, 0.27, 2640, 0.18),
    note(0.24, 0.32, 1980, 0.14),
    note(0.27, 0.34, 1320, 0.10),
]))

writeWav('pickup-arrow.wav', noteSequence(0.28, [
    { start: 0.00, end: 0.10, hz: 660, amp: 0.45 },
    { start: 0.08, end: 0.20, hz: 990, amp: 0.36 },
]))

// Bow release — clearer than the previous mix. Reads as
// "taut string snap → high-frequency whoosh of the arrow leaving":
//   1. Short bright pluck transient (the string releasing).
//   2. A high-frequency downward chirp (the arrow's flight whistle).
//   3. A short filtered-noise burst, lower amplitude, for air movement.
// Deliberately no rumble — the old recipe's low-end made it buzz like
// a creaking door instead of cracking like a bowstring.
writeWav('bow.wav', mix(0.40, [
    pluck(0.00, 0.10, 380, 0.62),
    pluck(0.01, 0.16, 260, 0.42),
    chirp(0.03, 0.34, 2100, 520, 0.18),
    filteredNoise(0.04, 0.28, 0.10, 2400, 4101),
    chirp(0.04, 0.30, 1100, 360, 0.16),
]))

writeWav('arrow-hit.wav', mix(0.38, [
    // Existing impact stack.
    noiseBurst(0.00, 0.12, 0.45, 41),
    pluck(0.02, 0.20, 118, 0.42),
    pluck(0.05, 0.28, 74, 0.30),
    // New resonance — a deep low pluck that rings briefly after the
    // hit so it reads as "stuck in wood" instead of just "thump".
    pluck(0.05, 0.36, 56, 0.22),
    filteredNoise(0.10, 0.34, 0.08, 800, 53),
]))

writeWav('death.wav', mix(0.86, [
    chirp(0.00, 0.70, 330, 92, 0.56),
    note(0.10, 0.80, 82, 0.32),
    noiseBurst(0.08, 0.62, 0.15, 71),
]))

// ── Melee combat ─────────────────────────────────────────────────────
// Driven by the timed melee system (player + NPC attacks). Three event
// families:
//   - swing : the weapon cutting air. Bright noise whose cutoff falls as
//             the blade passes — pure air, NO thud (the thud is the hit).
//             Light = sword/thrust/npc-slash; heavy = staff/hammer.
//   - hit   : a body impact. A pitched-down kick thump + a slap
//             transient; the heavy variant adds low-end and a crunch.
//   - block : shield catches the blow. A metallic clang from inharmonic
//             plucks (ratios ~1 : 1.52 : 2.31) so it reads as struck
//             steel rather than a tuned note.
// Kept short and not too loud — in a fight these fire several times a
// second, so any ring-out or excess low-end fatigues fast.
writeWav('sword-swing.wav', mix(0.28, [
    chirpNoise(0.00, 0.20, 2600, 600, 0.30, 8101), // blade cutting air, cutoff falls
    filteredNoise(0.00, 0.16, 0.10, 1800, 8111),   // body of the rush
    chirp(0.02, 0.18, 900, 320, 0.06),             // faint tonal "shing"
]))

writeWav('heavy-swing.wav', mix(0.38, [
    chirpNoise(0.00, 0.30, 1600, 280, 0.34, 8121), // slower, darker sweep
    filteredNoise(0.00, 0.26, 0.14, 900, 8131),
    rumble(0.02, 0.34, 70, 0.10, 8141),            // weight behind the swing
]))

writeWav('melee-hit.wav', mix(0.30, [
    kick(0.00, 0.30),                              // body thump
    pluck(0.00, 0.10, 120, 0.40),                  // impact body
    noiseBurst(0.00, 0.05, 0.40, 8151),            // slap transient
    filteredNoise(0.01, 0.12, 0.10, 1400, 8161),   // grit
]))

writeWav('melee-hit-heavy.wav', mix(0.40, [
    kick(0.00, 0.34),
    pluck(0.00, 0.14, 90, 0.50),                   // deeper body
    noiseBurst(0.00, 0.05, 0.55, 8171),
    crackle(0.00, 0.18, 0.12, 0.30, 8181),         // bone/wood crunch debris
    rumble(0.02, 0.34, 60, 0.18, 8191),            // low-end shove
]))

writeWav('shield-block.wav', mix(0.34, [
    noiseBurst(0.00, 0.03, 0.55, 8201),            // the clack of contact
    pluck(0.00, 0.22, 320, 0.34),                  // metallic body
    pluck(0.00, 0.26, 487, 0.22),                  // inharmonic partial → "metal"
    pluck(0.005, 0.30, 740, 0.16),                 // high ring
    filteredNoise(0.00, 0.10, 0.10, 3000, 8211),   // bright shimmer
]))

// Hurt grunts — a short falling "ugh" when a body takes (non-lethal)
// damage. A square chirp dropping in pitch (the vocalisation) over a
// quick breath of filtered noise. Player sits lower/grounded; NPC is a
// touch brighter and shorter so you can tell who got hit without looking.
writeWav('player-hurt.wav', mix(0.26, [
    chirp(0.00, 0.16, 300, 150, 0.32), // falling grunt
    chirp(0.01, 0.13, 200, 110, 0.18), // lower body
    filteredNoise(0.00, 0.12, 0.12, 1100, 8221), // breath
]))

writeWav('npc-hurt.wav', mix(0.22, [
    chirp(0.00, 0.13, 380, 190, 0.30),
    chirp(0.01, 0.10, 250, 150, 0.16),
    filteredNoise(0.00, 0.10, 0.10, 1400, 8231),
]))

// ── Spells ───────────────────────────────────────────────────────────
// Each of the three staff spells gets a distinct cast cue (played as the
// staff fires) and an impact cue (played where it lands). Built on the
// `shimmer` voice (a smooth sine bell with a glassy inharmonic partial and
// gentle vibrato) and `sineChirp` (a clean sine glide) instead of square
// `note`/`chirp` — square waves read as buzzy chiptune blips, not magic.
// Families read by timbre: Arcane Bolt = warm chime; Frost Nova = high cold
// glass; Electric Orb = a tonal zap with just a touch of spark.

// Arcane Bolt — a rising sine zip topped with a consonant chime stack.
writeWav('bolt-cast.wav', mix(0.34, [
    sineChirp(0.00, 0.15, 440, 1000, 0.24), // smooth rising "zip"
    shimmer(0.02, 0.32, 988, 0.20),         // B5 bell
    shimmer(0.04, 0.32, 1480, 0.12),        // ~fifth — sparkle
    shimmer(0.06, 0.30, 1976, 0.07),        // octave shimmer
    filteredNoise(0.00, 0.08, 0.03, 3000, 8301), // soft airy onset, not hiss
]))
// Bolt impact — a bright chime burst with a quick soft zap-down.
writeWav('bolt-hit.wav', mix(0.30, [
    shimmer(0.00, 0.26, 1318, 0.22),        // E6 ring
    shimmer(0.01, 0.26, 1760, 0.13),        // A6
    shimmer(0.02, 0.22, 2637, 0.07),        // E7 sparkle
    sineChirp(0.00, 0.10, 1500, 480, 0.12), // soft zap down
    filteredNoise(0.00, 0.05, 0.03, 3500, 8381),
]))

// Frost Nova — a cold descending glide (the ring rolling out) under a
// stack of high glassy bells.
writeWav('nova-cast.wav', mix(0.54, [
    sineChirp(0.00, 0.48, 1300, 480, 0.15), // cold descending sweep
    shimmer(0.00, 0.48, 784, 0.12),         // G5 cold tone
    shimmer(0.03, 0.48, 1175, 0.08),        // D6
    shimmer(0.06, 0.44, 1568, 0.05),        // G6 high glass
    filteredNoise(0.00, 0.30, 0.04, 2600, 8321), // soft frost air (darkened)
]))
// Nova chill — a high icy glass "tink" as the front touches a foe.
writeWav('nova-hit.wav', mix(0.28, [
    shimmer(0.00, 0.24, 1568, 0.20),  // G6 ice
    shimmer(0.005, 0.24, 2349, 0.12), // D7 shimmer
    shimmer(0.01, 0.20, 3136, 0.06),  // G7 sparkle
    filteredNoise(0.00, 0.04, 0.025, 4500, 8391), // tiny frost shiver
]))

// Electric Orb — a rising sine whine with a light spark crackle and a
// tonal body, so it reads as "charged magic", not static.
writeWav('orb-cast.wav', mix(0.36, [
    sineChirp(0.00, 0.22, 380, 1150, 0.22), // rising charge whine
    shimmer(0.02, 0.30, 660, 0.10),         // tonal body
    shimmer(0.04, 0.28, 990, 0.07),         // overtone
    crackle(0.00, 0.26, 0.30, 0.12, 8351),  // light sparks
    filteredNoise(0.00, 0.09, 0.04, 2600, 8361),
]))
// Orb zap — a sharp tonal discharge with a spark snap.
writeWav('orb-zap.wav', mix(0.22, [
    sineChirp(0.00, 0.12, 1500, 420, 0.22), // zap down
    shimmer(0.00, 0.20, 1318, 0.13),        // tonal snap
    crackle(0.00, 0.16, 0.34, 0.14, 8421),  // sparks
    filteredNoise(0.00, 0.035, 0.05, 4000, 8411), // bright tick
]))

// ── Character footsteps (per surface) ────────────────────────────────
// Five surface families × 2 variants each. The locomotion system
// detects the voxel under the player's feet and picks the matching
// pool. Two variants gives just enough rotation that the rhythm
// doesn't read as a metronome; rate jitter at play time adds the
// rest. Volumes are kept low — the player walks constantly.
//
// Recipe shape:
//   - grass: soft pluck + low-cutoff noise (muffled, no transient)
//   - dirt : medium pluck + medium-cutoff noise (the previous
//            "generic" footstep recipe — heavier than grass)
//   - stone: high pluck + sharp wide-band noise (clean click)
//   - wood : pluck around 180 Hz + octave-low resonance (hollow creak)
//   - water: bubble + filtered noise burst (splashy, no thud)

// Grass — soft, slightly mossy. Lower noise cutoff so it reads as
// "swish" not "click".
writeWav('footstep-grass-1.wav', mix(0.10, [
    pluck(0.00, 0.06, 95, 0.22),
    filteredNoise(0.00, 0.10, 0.18, 380, 6101),
]))
writeWav('footstep-grass-2.wav', mix(0.11, [
    pluck(0.00, 0.07, 110, 0.20),
    filteredNoise(0.00, 0.11, 0.20, 320, 6111),
]))

// Dirt — heaviest "generic" footstep. The previous footstep-1 lived
// here; keep the recipe close so existing levels feel familiar.
writeWav('footstep-dirt-1.wav', mix(0.10, [
    pluck(0.00, 0.06, 78, 0.30),
    noiseBurst(0.00, 0.05, 0.20, 6121),
    filteredNoise(0.01, 0.08, 0.08, 600, 6131),
]))
writeWav('footstep-dirt-2.wav', mix(0.11, [
    pluck(0.00, 0.07, 65, 0.32),
    noiseBurst(0.00, 0.06, 0.22, 6141),
    filteredNoise(0.01, 0.09, 0.07, 480, 6151),
]))

// Stone — clean click. High pluck fundamental, sharp wide-band noise.
writeWav('footstep-stone-1.wav', mix(0.10, [
    pluck(0.00, 0.05, 160, 0.28),
    noiseBurst(0.00, 0.04, 0.26, 6161),
    filteredNoise(0.01, 0.06, 0.10, 1400, 6171),
]))
writeWav('footstep-stone-2.wav', mix(0.10, [
    pluck(0.00, 0.05, 140, 0.30),
    noiseBurst(0.00, 0.04, 0.24, 6181),
    filteredNoise(0.01, 0.06, 0.10, 1200, 6191),
]))

// Wood — hollow creak. Pluck + an octave-lower companion so the
// fundamental rings briefly. Less noise than stone.
writeWav('footstep-wood-1.wav', mix(0.11, [
    pluck(0.00, 0.08, 180, 0.24),
    pluck(0.00, 0.10, 90,  0.18),
    noiseBurst(0.00, 0.04, 0.14, 6201),
]))
writeWav('footstep-wood-2.wav', mix(0.12, [
    pluck(0.00, 0.08, 210, 0.22),
    pluck(0.00, 0.10, 105, 0.18),
    noiseBurst(0.00, 0.04, 0.12, 6211),
]))

// Water — splash. Filtered noise burst + a bubble pop for the
// "plop" of a foot breaking the surface.
writeWav('footstep-water-1.wav', mix(0.18, [
    filteredNoise(0.00, 0.14, 0.20, 1800, 6221),
    bubble(0.02, 0.16, 360, 0.22, 6231),
    noiseBurst(0.00, 0.05, 0.18, 6241),
]))
writeWav('footstep-water-2.wav', mix(0.20, [
    filteredNoise(0.00, 0.16, 0.22, 1500, 6251),
    bubble(0.03, 0.18, 280, 0.24, 6261),
    noiseBurst(0.00, 0.05, 0.16, 6271),
]))

// Standard jump — grounded adventure take-off. Low foot pressure,
// a short cloth/ground scrape, and only a restrained lift tone so it
// reads serious instead of cartoon-bright.
writeWav('jump.wav', mix(0.24, [
    kick(0.00, 0.18),
    pluck(0.00, 0.12, 86, 0.28),
    filteredNoise(0.00, 0.09, 0.10, 560, 6201),
    chirpNoise(0.02, 0.17, 760, 260, 0.08, 6207),
    triNote(0.03, 0.19, 196, 0.06),
]))

// Landing thud — slightly lower-energy than arrow-hit. Low pluck +
// brief brushed-noise tail so it reads as "feet on grass" not "rock
// fall".
writeWav('land.wav', mix(0.22, [
    pluck(0.00, 0.10, 55, 0.36),
    noiseBurst(0.00, 0.07, 0.26, 6211),
    filteredNoise(0.02, 0.20, 0.10, 500, 6221),
]))

// High Jump — heavy enchanted take-off. No bright arpeggio: a hard
// grounded push, low body, and a short cloth/air whoosh so it reads
// more like adventure gear than arcade magic.
writeWav('high-jump.wav', mix(0.64, [
    kick(0.00, 0.22),
    pluck(0.00, 0.20, 48, 0.44),
    pluck(0.03, 0.28, 86, 0.24),
    chirp(0.04, 0.36, 135, 360, 0.18),
    chirpNoise(0.02, 0.46, 980, 240, 0.26, 6301),
    filteredNoise(0.00, 0.18, 0.16, 520, 6311),
    rumble(0.00, 0.64, 62, 0.15, 6321),
]))

// Air Push - a short pressure-wave spell cue. Dark filtered air and
// a low body impact keep it grounded; no bright rising pitch sweep, so
// it reads as forceful air pressure instead of cartoon magic.
writeWav('air-push.wav', mix(0.66, [
    kick(0.00, 0.10),
    chirpNoise(0.00, 0.50, 920, 150, 0.32, 6401),
    filteredNoise(0.02, 0.56, 0.18, 360, 6411),
    filteredNoise(0.00, 0.18, 0.07, 1450, 6421),
    noiseBurst(0.00, 0.026, 0.18, 6431),
    rumble(0.00, 0.62, 48, 0.12, 6441),
]))

writeWav('death-stinger.wav', noteSequence(1.35, [
    { start: 0.00, end: 0.28, hz: 392, amp: 0.54 },
    { start: 0.24, end: 0.58, hz: 330, amp: 0.50 },
    { start: 0.52, end: 1.22, hz: 196, amp: 0.48 },
]))

// ── Background music loops ───────────────────────────────────────────

writeWav('background-loop.wav', loopMusic(5.2))
writeWav('background-calm-loop.wav', calmLoop(6.4))
writeWav('background-action-loop.wav', actionLoop(4.8))
writeWav('background-cave-loop.wav', caveLoop(7.2))

// Minimalistic piano ambients — sparse, low-density melodic beds the
// level author can pick as level music when they want "atmosphere"
// rather than "soundtrack". Each one uses the same `pianoNote` voice
// (additive sine harmonics + percussive attack + exponential decay)
// but a different scale, register, and density.
writeWav('piano-ambient-quiet.wav', pianoQuietLoop(8.0))
writeWav('piano-ambient-night.wav', pianoNightLoop(9.6))
writeWav('piano-ambient-drift.wav', pianoDriftLoop(8.8))

// Ambient music set — calm, intriguing, piano-led location beds in the
// C418 vein (see the `ambStartLoop` family below). Long loops so the
// repeat is hard to catch; one key/register/density per location.
writeWav('amb-start-loop.wav',   ambStartLoop(12.0))
writeWav('amb-garden-loop.wav',  ambGardenLoop(13.0))
writeWav('amb-town-loop.wav',    ambTownLoop(14.0))
writeWav('amb-tension-loop.wav', ambTensionLoop(10.0))
writeWav('amb-cave-loop.wav',    ambCaveLoop(16.0))
// Abandoned dwarf mine — "Hollowdeep". Darker/heavier than the cave bed,
// with a faded dwarf-hall motif, a cold organ swell, ghost-forge metal
// rings, echoing drops, timber-support creaks, and a deep shaft draft.
writeWav('amb-mine-loop.wav',    ambMineLoop(19.0))

// Themed music set — richer, more "composed" location/screen themes than
// the always-on ambient beds: a hopeful Menu title theme, a merry Tavern
// jig, a stately Royal processional, and a solemn Cathedral organ + choir.
writeWav('theme-menu-loop.wav',      menuTheme(16.0))
writeWav('theme-tavern-loop.wav',    tavernTheme(8.0))
writeWav('theme-royal-loop.wav',     royalTheme(12.0))
writeWav('theme-cathedral-loop.wav', cathedralTheme(16.0))

// ── Weather (new) ────────────────────────────────────────────────────

writeWav('rain-loop.wav', rainLoop(3.6))
writeWav('storm-loop.wav', stormLoop(4.5))
writeWav('wind-loop.wav', windLoop(4.0))
writeWav('thunder.wav', mix(1.85, [
    // Initial crack: bright transient + crackle stutter
    noiseBurst(0.00, 0.06, 0.78, 1021),
    crackle(0.00, 0.32, 0.18, 0.55, 1031),
    // Body: filtered noise from mid down to low for the "rumble that
    // rolls toward you" feel
    chirpNoise(0.05, 1.20, 900, 200, 0.32, 1041),
    rumble(0.08, 1.85, 70, 0.22, 1051),
    // Tail: long subsonic-ish wash
    filteredNoise(0.40, 1.85, 0.14, 220, 1061),
]))

// ── Fire (new) ───────────────────────────────────────────────────────

writeWav('fire-loop.wav', fireLoop(3.4))
// Torch loop — distinctly smaller than `fire-loop.wav`. Same crackle
// language but lower amplitude, no low "roar", and the cutoff sits a
// bit higher so the crackles read as a hand-held flame rather than a
// bonfire pit. Used by every block torch in the world via a spatial
// audio source with a tight `maxDistance`.
writeWav('torch-loop.wav', torchLoop(2.4))
writeWav('fire-whoosh.wav', mix(0.62, [
    // Ignition swell — chirp-down + bright noise → settles to crackle.
    chirp(0.00, 0.32, 240, 80, 0.32),
    chirpNoise(0.00, 0.50, 1800, 400, 0.36, 1071),
    crackle(0.18, 0.62, 0.10, 0.22, 1081),
    rumble(0.05, 0.62, 90, 0.10, 1091),
]))

// ── Explosion (new) ──────────────────────────────────────────────────

writeWav('explosion.wav', mix(1.40, [
    // Crack: short loud transient at t=0
    noiseBurst(0.00, 0.05, 1.00, 2003),
    crackle(0.00, 0.30, 0.22, 0.65, 2011),
    // Body: brown rumble + falling noise sweep
    rumble(0.02, 1.40, 55, 0.30, 2017),
    chirpNoise(0.02, 0.90, 1200, 180, 0.32, 2029),
    // Tail: residual rumble + sparse crackle for debris
    filteredNoise(0.20, 1.40, 0.18, 320, 2039),
    crackle(0.30, 1.20, 0.04, 0.18, 2053),
]))

writeWav('explosion-small.wav', mix(0.85, [
    noiseBurst(0.00, 0.04, 0.85, 2113),
    crackle(0.00, 0.18, 0.25, 0.45, 2129),
    rumble(0.02, 0.85, 80, 0.22, 2141),
    chirpNoise(0.02, 0.55, 1000, 220, 0.24, 2153),
]))

// Stone collision — a falling-stone landing on / clattering against a
// block. Quick low pluck for the body of the impact + a short
// high-frequency noise transient for the surface grit. No long tail:
// the player hears this hundreds of times across a level so any
// ringing residue gets annoying fast.
writeWav('stone-impact.wav', mix(0.34, [
    pluck(0.00, 0.10, 96, 0.62),
    pluck(0.01, 0.18, 62, 0.32),
    noiseBurst(0.00, 0.04, 0.55, 2217),
    filteredNoise(0.01, 0.18, 0.14, 1800, 2231),
    rumble(0.02, 0.30, 70, 0.05, 2237),
]))

// ── Liquids (new) ────────────────────────────────────────────────────

writeWav('water-loop.wav', waterLoop(3.0))
writeWav('lava-loop.wav', lavaLoop(3.2))
writeWav('bubble.wav', mix(0.30, [
    bubble(0.00, 0.22, 380, 0.45, 3001),
    bubble(0.04, 0.28, 220, 0.22, 3011),
    filteredNoise(0.00, 0.10, 0.08, 1200, 3019),
]))

// ── Magic (new) ──────────────────────────────────────────────────────

writeWav('magic-loop.wav', magicLoop(3.8))
writeWav('magic-chime.wav', mix(0.74, [
    note(0.00, 0.34, 988, 0.30),
    note(0.06, 0.48, 1318, 0.24),
    note(0.12, 0.66, 1760, 0.18),
    note(0.20, 0.74, 2349, 0.12),
    filteredNoise(0.00, 0.74, 0.05, 3000, 4011),
]))

// ── Quest cues ──────────────────────────────────────────────────────
// Short, melodic, distinct from the in-world ambient chimes so the
// player parses them as "the script said something" rather than
// "something just happened nearby." The chime is a quick two-note
// rise; the fanfare is a major triad arpeggio with a sparkle tail.

writeWav('quest-chime.wav', mix(0.48, [
    note(0.00, 0.18, 1175, 0.50),  // D6
    note(0.10, 0.42, 1760, 0.46),  // A6
    note(0.18, 0.42, 2349, 0.18),  // D7 — high sparkle
]))

writeWav('quest-fanfare.wav', mix(0.92, [
    note(0.00, 0.22, 880,  0.50),  // A5
    note(0.12, 0.34, 1108, 0.50),  // C#6
    note(0.24, 0.46, 1318, 0.50),  // E6
    note(0.36, 0.78, 1760, 0.48),  // A6 (sustained)
    note(0.40, 0.78, 2217, 0.18),  // C#7 — sparkle
    filteredNoise(0.00, 0.92, 0.04, 4500, 4101),
]))

// ── Vehicles ─────────────────────────────────────────────────────────
// Rail cart rolling — a looping bed played spatially while a cart moves
// and stopped when it halts. Low wheel rumble + friction hiss + evenly
// spaced rail-joint clacks (so the loop wraps seamlessly) + a faint axle
// squeak that drifts so it never feels static.
writeWav('cart-rolling-loop.wav', cartRollingLoop(1.5))

// ── Consumables ──────────────────────────────────────────────────────
// One-shots fired when the player uses a held consumable. `drink` is a
// soft cork-pop + liquid gulps + a satisfied "ahh" of relief (potions);
// `eat` is a couple of muffled bites with a crunchy transient (food).
writeWav('consume-drink.wav', mix(0.62, [
    noiseBurst(0.00, 0.03, 0.30, 5101),                 // cork / lip pop
    bubble(0.04, 0.16, 300, 0.30, 5103),                // gulp 1
    bubble(0.18, 0.30, 260, 0.28, 5107),                // gulp 2
    bubble(0.32, 0.44, 220, 0.24, 5113),                // gulp 3
    sineChirp(0.46, 0.60, 360, 300, 0.10),              // soft "ahh" tail
    filteredNoise(0.00, 0.44, 0.05, 900, 5119),         // liquid body
]))
writeWav('consume-eat.wav', mix(0.46, [
    noiseBurst(0.00, 0.05, 0.34, 5201),                 // first bite crunch
    filteredNoise(0.00, 0.10, 0.18, 2600, 5203),        // chew grit
    pluck(0.02, 0.12, 150, 0.18),                        // muffled body
    noiseBurst(0.18, 0.23, 0.28, 5209),                 // second bite
    filteredNoise(0.18, 0.28, 0.14, 2400, 5211),
    pluck(0.20, 0.30, 140, 0.14),
]))

// ── Containers ───────────────────────────────────────────────────────
// Loot chest opening — a wooden lid creak + latch knock, then a short
// rising "treasure" sparkle so opening a chest feels rewarding. Played
// spatially at the chest when it is opened.
writeWav('chest-open.wav', mix(0.74, [
    chirpNoise(0.00, 0.34, 700, 280, 0.16, 6011),       // hinge creak (lid lifting)
    pluck(0.28, 0.40, 150, 0.30),                        // lid knock / latch body
    noiseBurst(0.28, 0.32, 0.28, 6017),                  // latch clack
    note(0.38, 0.58, 880, 0.16),                         // treasure sparkle…
    note(0.46, 0.66, 1175, 0.13),
    shimmer(0.48, 0.74, 1568, 0.10),                     // …with a soft ring tail
]))

// ── Creatures: spider ────────────────────────────────────────────────
// A cave spider's voice. `chitter` plays as it lunges (rapid mandible
// clicks + a breathy hiss); `hurt` is a short shrill screech; `die` is a
// descending death screech with the legs skittering to a collapse.
writeWav('spider-chitter.wav', mix(0.36, [
    noiseBurst(0.00, 0.025, 0.30, 6101),                 // mandible clicks…
    noiseBurst(0.05, 0.075, 0.28, 6103),
    noiseBurst(0.10, 0.125, 0.30, 6105),
    noiseBurst(0.15, 0.175, 0.26, 6107),
    noiseBurst(0.20, 0.225, 0.24, 6109),
    filteredNoise(0.00, 0.32, 0.08, 4200, 6111),         // breathy hiss
    sineChirp(0.04, 0.30, 1500, 1900, 0.05),             // thin shrill overtone
]))
writeWav('spider-hurt.wav', mix(0.26, [
    sineChirp(0.00, 0.16, 1600, 2400, 0.30),             // up-screech
    sineChirp(0.10, 0.24, 2400, 1500, 0.18),             // down tail
    noiseBurst(0.00, 0.04, 0.30, 6201),
    filteredNoise(0.00, 0.20, 0.10, 5000, 6203),
]))
writeWav('spider-die.wav', mix(0.74, [
    sineChirp(0.00, 0.34, 2000, 600, 0.30),              // long descending screech
    filteredNoise(0.00, 0.40, 0.10, 4000, 6301),         // hiss fading
    noiseBurst(0.34, 0.36, 0.20, 6303),                  // legs skittering, slowing…
    noiseBurst(0.42, 0.44, 0.16, 6305),
    noiseBurst(0.52, 0.54, 0.12, 6307),
    noiseBurst(0.62, 0.64, 0.08, 6309),
    pluck(0.30, 0.46, 90, 0.18),                         // soft body thud
    rumble(0.30, 0.70, 80, 0.06, 6311),
]))


// ─────────────────────────────────────────────────────────────────────
// WAV writer
// ─────────────────────────────────────────────────────────────────────

function writeWav(name, signal) {
    const samples = signalToU8(signal)
    const dataSize = samples.length
    const bytes = Buffer.alloc(44 + dataSize)
    bytes.write('RIFF', 0)
    bytes.writeUInt32LE(36 + dataSize, 4)
    bytes.write('WAVE', 8)
    bytes.write('fmt ', 12)
    bytes.writeUInt32LE(16, 16)
    bytes.writeUInt16LE(1, 20)
    bytes.writeUInt16LE(1, 22)
    bytes.writeUInt32LE(sampleRate, 24)
    bytes.writeUInt32LE(sampleRate, 28)
    bytes.writeUInt16LE(1, 32)
    bytes.writeUInt16LE(8, 34)
    bytes.write('data', 36)
    bytes.writeUInt32LE(dataSize, 40)
    Buffer.from(samples).copy(bytes, 44)
    writeFileSync(join(outDir, name), bytes)
}

function signalToU8(signal) {
    const out = new Uint8Array(signal.length)
    for (let i = 0; i < signal.length; i++) {
        const s = Math.max(-1, Math.min(1, signal[i]))
        out[i] = Math.round(128 + s * 100)
    }
    return out
}

function make(duration) {
    return new Float32Array(Math.max(1, Math.floor(duration * sampleRate)))
}

// ─────────────────────────────────────────────────────────────────────
// Synth primitives
// ─────────────────────────────────────────────────────────────────────

function noteSequence(duration, notes) {
    return mix(duration, notes.map((n) => note(n.start, n.end, n.hz, n.amp)))
}

function note(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const env = envelope((i - a) / len)
            signal[i] += square(hz, t) * amp * env
        }
    }
}

function pluck(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            signal[i] += square(hz, t) * amp * Math.exp(-p * 7)
        }
    }
}

function chirp(start, end, fromHz, toHz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        let phase = 0
        for (let i = a; i < b; i++) {
            const p = (i - a) / len
            const hz = fromHz + (toHz - fromHz) * p
            phase += hz / sampleRate
            signal[i] += (phase % 1 < 0.5 ? 1 : -1) * amp * envelope(p)
        }
    }
}

function noiseBurst(start, end, amp, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        let s = seed >>> 0
        for (let i = a; i < b; i++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            const noise = ((s / 0xffffffff) * 2 - 1)
            signal[i] += noise * amp * Math.exp(-((i - a) / len) * 8)
        }
    }
}

/** One-pole low-pass filtered white noise. `lpHz` is the cutoff —
 *  lower values muffle the noise toward thunder/wind territory.
 *  Unlike `noiseBurst` this has a flat amplitude envelope, so it's
 *  used as a sustained texture (rain hiss, wind howl, explosion
 *  tail) rather than a transient. */
function filteredNoise(start, end, amp, lpHz, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const dt = 1 / sampleRate
        const rc = 1 / (2 * Math.PI * Math.max(1, lpHz))
        const alpha = dt / (rc + dt)
        let s = seed >>> 0
        let prev = 0
        for (let i = a; i < b; i++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            const n = (s / 0xffffffff) * 2 - 1
            prev = prev + alpha * (n - prev)
            // Compensate for the lp's amplitude loss at low cutoffs.
            const gainComp = lpHz < 500 ? 4.0 : 1.6
            signal[i] += prev * amp * gainComp
        }
    }
}

/** Noise whose cutoff sweeps from `fromHz` to `toHz` — gives the
 *  "roll" feeling of distant thunder or a falling explosion tail. */
function chirpNoise(start, end, fromHz, toHz, amp, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        const dt = 1 / sampleRate
        let s = seed >>> 0
        let prev = 0
        for (let i = a; i < b; i++) {
            const p = (i - a) / len
            const hz = fromHz + (toHz - fromHz) * p
            const rc = 1 / (2 * Math.PI * Math.max(1, hz))
            const alpha = dt / (rc + dt)
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            const n = (s / 0xffffffff) * 2 - 1
            prev = prev + alpha * (n - prev)
            signal[i] += prev * amp * 2.0 * envelope(p)
        }
    }
}

/** Sparse short impulses — the "pop pop pop" pattern of a fire or
 *  the debris afterstutter of an explosion. `density` is a 0..1
 *  Poisson-ish probability of firing a spike on each sample. */
function crackle(start, end, density, ampMax, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        let s = seed >>> 0
        for (let i = a; i < b; i++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            // ~0.0015 density means roughly one spike every ~600 samples
            // at 22kHz — ~36 Hz pop rate. Multiply density to taste.
            if ((s & 0xffff) / 0xffff < density * 0.015) {
                const spikeLen = 8 + ((s >>> 16) % 22)
                // All randomness has to come from the seeded LCG so
                // the WAV bytes stay reproducible for the audio-asset
                // hash test. Pull a second sample for the amplitude
                // jitter rather than touching Math.random().
                s = (Math.imul(s, 1664525) + 1013904223) >>> 0
                const jitter = 0.4 + 0.6 * ((s & 0xffff) / 0xffff)
                const peak = (((s >>> 8) & 0xff) / 0xff) * ampMax * jitter
                const en = Math.min(b, i + spikeLen)
                for (let j = i; j < en; j++) {
                    const p = (j - i) / spikeLen
                    signal[j] += (1 - p) * peak * (j % 3 === 0 ? 1 : -1)
                }
            }
        }
    }
}

/** Brownian-ish low rumble. Each sample slightly perturbs a slow
 *  random walk; the result is dominated by sub-200Hz content. */
function rumble(start, end, baseHz, amp, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        let s = seed >>> 0
        let last = 0
        const len = Math.max(1, b - a)
        // Slow LFO at baseHz gives a sense of "rolling" intensity.
        for (let i = a; i < b; i++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            const n = (s / 0xffffffff) * 2 - 1
            last = last * 0.987 + n * 0.05
            const t = (i - a) / sampleRate
            const lfo = 0.6 + 0.4 * Math.sin(2 * Math.PI * baseHz * t * 0.05)
            const env = Math.exp(-((i - a) / len) * 1.5)
            signal[i] += last * amp * 8 * lfo * env
        }
    }
}

/** A tight upward chirp wrapped in a fast decay — sounds like a
 *  bubble surfacing. */
function bubble(start, end, hz, amp, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        const s = (seed >>> 0) % 7
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            const f = hz * (0.82 + p * 0.38 + Math.sin(p * Math.PI + s) * 0.05)
            signal[i] += square(f, t) * amp * Math.exp(-p * 6) * 0.55
        }
    }
}

function mix(duration, layers) {
    const signal = make(duration)
    for (const layer of layers) layer(signal)
    return signal
}

// ─────────────────────────────────────────────────────────────────────
// Music synth primitives
// ─────────────────────────────────────────────────────────────────────

/** Square-wave note with a softer, cosine-shaped envelope so the
 *  attack doesn't click and the release tails off musically. */
function softNote(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            // Quick attack (0.03), slow cosine release.
            const attack = Math.min(1, p / 0.03)
            const releaseShape = 0.5 + 0.5 * Math.cos((1 - p) * Math.PI)
            const env = Math.max(0, attack * releaseShape)
            signal[i] += square(hz, t) * amp * env
        }
    }
}

/** Triangle-like waveform — a 3-step staircase, more harmonically
 *  rich than square but still chip-tune-ish. */
function triNote(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const phase = (t * hz) % 1
            // 4-step staircase approximating a triangle.
            let v
            if (phase < 0.25) v = phase * 4 - 1
            else if (phase < 0.5) v = 1 - (phase - 0.25) * 4
            else if (phase < 0.75) v = -(phase - 0.5) * 4
            else v = -1 + (phase - 0.75) * 4
            const p = (i - a) / len
            const attack = Math.min(1, p / 0.03)
            const release = 0.5 + 0.5 * Math.cos((1 - p) * Math.PI)
            signal[i] += v * amp * Math.max(0, attack * release)
        }
    }
}

/** Kick drum: a sine that drops in pitch from ~120 Hz to ~50 Hz over
 *  the first 60 ms, with an exponential amplitude decay. */
function kick(start, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const dur = 0.14
        const b = Math.min(signal.length, Math.floor((start + dur) * sampleRate))
        const len = Math.max(1, b - a)
        let phase = 0
        for (let i = a; i < b; i++) {
            const p = (i - a) / len
            const hz = 120 - 70 * Math.min(1, p * 3)
            phase += hz / sampleRate
            signal[i] += Math.sin(phase * 2 * Math.PI) * amp * Math.exp(-p * 8)
        }
    }
}

/**
 * Piano-ish voice. Approximated by additive sine harmonics (fundamental
 * + 2 + 3 + 4 × hz) under a percussive amplitude curve: very fast
 * attack (≈3 ms), exponential decay weighted toward the low harmonics.
 * Higher harmonics decay faster than the fundamental, which is the
 * acoustic-piano touch — it's why the *attack* sounds bright and the
 * *sustain* sounds mellow.
 */
function pianoNote(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        const harmonics = [
            { mult: 1, amp: 1.00, decay: 2.4 },
            { mult: 2, amp: 0.42, decay: 3.6 },
            { mult: 3, amp: 0.22, decay: 5.2 },
            { mult: 4, amp: 0.12, decay: 7.0 },
        ]
        const twoPi = Math.PI * 2
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            // ~3ms attack ramp so the hammer-on isn't a click.
            const attack = Math.min(1, p / 0.006)
            let sample = 0
            for (const h of harmonics) {
                sample += Math.sin(twoPi * hz * h.mult * t) * h.amp * Math.exp(-p * h.decay)
            }
            signal[i] += sample * amp * attack * 0.42
        }
    }
}

/**
 * Magic bell / glass voice. Sine fundamental + an octave + a 2.76× *inharmonic*
 * partial (the ratio that gives struck glass/crystal its shimmer rather than a
 * plain musical tone), under an exponential decay, with a soft ~10 ms attack
 * and a gentle 5.5 Hz vibrato so it sparkles instead of sitting flat. This is
 * the core "magic" timbre — smooth and ringing where `note`/`pluck` (square)
 * read as buzzy chiptune blips.
 */
function shimmer(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        const twoPi = Math.PI * 2
        const partials = [
            { mult: 1.00, amp: 1.00, decay: 2.2 },
            { mult: 2.00, amp: 0.45, decay: 3.0 },
            { mult: 2.76, amp: 0.20, decay: 4.2 }, // inharmonic → glass shimmer
        ]
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            const attack = Math.min(1, p / 0.01)            // ~10 ms soft attack
            const vib = 1 + 0.006 * Math.sin(twoPi * 5.5 * t) // subtle vibrato
            let s = 0
            for (const h of partials) {
                s += Math.sin(twoPi * hz * h.mult * vib * t) * h.amp * Math.exp(-p * h.decay)
            }
            signal[i] += s * amp * attack * 0.5
        }
    }
}

/**
 * Smooth sine pitch glide — a clean glissando for magical zips and sweeps,
 * the sine counterpart of the square `chirp`. Uses the shared `envelope` so
 * the start and end don't click.
 */
function sineChirp(start, end, fromHz, toHz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        const twoPi = Math.PI * 2
        let phase = 0
        for (let i = a; i < b; i++) {
            const p = (i - a) / len
            const hz = fromHz + (toHz - fromHz) * p
            phase += hz / sampleRate
            signal[i] += Math.sin(twoPi * phase) * amp * envelope(p)
        }
    }
}

/**
 * Pipe-organ voice — additive sine "drawbars" (fundamental + octave + twelfth
 * + two octaves) held at a FLAT sustain with a soft attack/release plateau (no
 * decay). The twelfth (3×) is what gives a chapel organ its hollow, sacred
 * colour. Steady where `pianoNote` decays and `padNote` swells; the body of
 * the Royal and Cathedral themes.
 */
function organNote(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        const twoPi = Math.PI * 2
        const drawbars = [
            { mult: 1, amp: 1.00 },
            { mult: 2, amp: 0.55 },
            { mult: 3, amp: 0.30 }, // twelfth → organ colour
            { mult: 4, amp: 0.22 },
        ]
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            const attack = Math.min(1, p / 0.04)
            const release = Math.min(1, (1 - p) / 0.10)
            const env = Math.max(0, Math.min(attack, release))
            let s = 0
            for (const db of drawbars) s += Math.sin(twoPi * hz * db.mult * t) * db.amp
            signal[i] += s * amp * env * 0.45
        }
    }
}

/**
 * Warm synth pad — the bed the piano floats over in the new ambient
 * set. Two slightly detuned sines plus a quiet fifth, wrapped in a slow
 * raised-sine swell so the note breathes in and out instead of switching
 * on. Deliberately very low amplitude: it's felt more than heard, the
 * way C418's pads sit under the piano. No harmonics-chopping decay (that
 * would make it a bell) — the swell is the whole envelope.
 */
function padNote(start, end, hz, amp) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const b = Math.min(signal.length, Math.floor(end * sampleRate))
        const len = Math.max(1, b - a)
        const twoPi = Math.PI * 2
        for (let i = a; i < b; i++) {
            const t = (i - a) / sampleRate
            const p = (i - a) / len
            // 0 → 1 → 0 over the note (sine bell) so there's no attack
            // click and no release thud.
            const env = Math.sin(Math.PI * Math.min(1, p))
            const v =
                Math.sin(twoPi * hz * t) +
                0.7 * Math.sin(twoPi * hz * 1.004 * t) + // slow detune shimmer
                0.25 * Math.sin(twoPi * hz * 1.5 * t)    // soft fifth for warmth
            signal[i] += v * amp * env
        }
    }
}

/**
 * Cave water drop. A clean sine "tink" that bends down fast — the pitch
 * a droplet sheds as it pulls off the stone — followed by two fainter
 * echoes (~0.2s and ~0.4s later) for the reverberant tail you only hear
 * underground. Pure sine on purpose: a square wave would read as a chip
 * blip, not water. Used sparsely so it stays a *rare* punctuation, never
 * a rhythm.
 */
function waterDrop(start, hz, amp) {
    return (signal) => {
        const twoPi = Math.PI * 2
        const ping = (offset, gain) => {
            const a = Math.floor((start + offset) * sampleRate)
            const dur = 0.18
            const b = Math.min(signal.length, Math.floor((start + offset + dur) * sampleRate))
            const len = Math.max(1, b - a)
            for (let i = a; i < b; i++) {
                const t = (i - a) / sampleRate
                const p = (i - a) / len
                // Pitch falls fast over the first ~35 ms, then settles.
                const f = hz * (1.5 - 0.6 * Math.min(1, p * 5))
                const body = Math.sin(twoPi * f * t) * Math.exp(-p * 11)
                // Bright surface-break transient, decays much faster.
                const tick = Math.sin(twoPi * f * 2 * t) * 0.3 * Math.exp(-p * 26)
                signal[i] += (body + tick) * gain * amp
            }
        }
        ping(0.00, 1.00)
        ping(0.21, 0.34) // first echo
        ping(0.43, 0.13) // distant cave tail
    }
}

/** Closed hi-hat: very short filtered noise burst. */
function hihat(start, amp, seed) {
    return (signal) => {
        const a = Math.floor(start * sampleRate)
        const dur = 0.045
        const b = Math.min(signal.length, Math.floor((start + dur) * sampleRate))
        const len = Math.max(1, b - a)
        let s = seed >>> 0
        let prev = 0
        for (let i = a; i < b; i++) {
            s = (Math.imul(s, 1664525) + 1013904223) >>> 0
            const n = (s / 0xffffffff) * 2 - 1
            // High-pass: keep only the difference from the last sample.
            const hp = n - prev * 0.7
            prev = n
            const p = (i - a) / len
            signal[i] += hp * amp * Math.exp(-p * 24)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────
// Music loops (rewritten — proper composition, lower volumes)
// ─────────────────────────────────────────────────────────────────────

/**
 * Overworld adventure — C minor pentatonic. Sixteen-step pattern at
 * roughly 100 BPM. Soft bass + lead melody + kick on beats 1+5+9+13.
 *
 * Scale: C(130) Eb(155) F(174) G(196) Bb(233) — pentatonic stays
 * consonant on top of itself which is what we want for an
 * always-on background bed.
 */
function loopMusic(duration) {
    const signal = make(duration)
    const bass    = [130, 130, 174, 130, 196, 196, 174, 130, 130, 130, 174, 130, 233, 196, 174, 196]
    const lead    = [392, 466, 523, 466, 466, 392, 349, 392, 466, 523, 587, 523, 466, 392, 349, 392]
    const step = duration / 16
    for (let i = 0; i < 16; i++) {
        // Bass: short staccato every step.
        triNote(i * step, i * step + step * 0.5, bass[i] * 0.5, 0.14)(signal)
        // Lead: longer notes every two steps.
        if (i % 2 === 0) softNote(i * step, i * step + step * 1.6, lead[i], 0.07)(signal)
        // Kick on the downbeat of every 4-step bar.
        if (i % 4 === 0) kick(i * step, 0.32)(signal)
        // Hi-hat off-beat.
        if (i % 2 === 1) hihat(i * step, 0.06, 100 + i)(signal)
    }
    crossfadeEnds(signal, 0.15)
    return signal
}

/**
 * Calm bed — F major-pentatonic-ish. No drums. Sustained pad-like
 * tones with bell glints over the top. Designed to sit comfortably
 * behind ambience without competing for attention.
 *
 * Scale: F(174) G(196) A(220) C(262) D(294)
 */
function calmLoop(duration) {
    const signal = make(duration)
    const pad     = [87, 110, 131, 110, 87, 98, 131, 110] // F2 / A2 / C3 / etc
    const bells   = [523, 587, 659, 698, 783, 698, 587, 523]
    const step = duration / 16
    for (let i = 0; i < 16; i++) {
        // Pad: long sustained notes that overlap.
        softNote(i * step, i * step + step * 2.6, pad[i % pad.length], 0.06)(signal)
        // Bell glint every 4th step.
        if (i % 4 === 2) softNote(i * step, i * step + step * 1.2, bells[(i / 4) % bells.length] * 2, 0.04)(signal)
        // Soft mid-bell every other step at low volume.
        if (i % 2 === 1) softNote(i * step + step * 0.3, i * step + step * 1.0, bells[(i + 3) % bells.length], 0.035)(signal)
    }
    crossfadeEnds(signal, 0.40)
    return signal
}

/**
 * Action bed — A minor, driving. 32-step grid, kick on every other
 * 4-step bar plus on accents. Hi-hats at 16th-note resolution.
 *
 * Scale: A(220) C(262) D(294) E(330) G(392)
 */
function actionLoop(duration) {
    const signal = make(duration)
    const bass    = [55, 55, 65, 55, 73, 73, 65, 55, 55, 55, 65, 55, 82, 73, 65, 55]
    const lead    = [659, 587, 523, 587, 784, 659, 587, 523, 659, 740, 659, 587, 523, 587, 659, 587]
    const step = duration / 32
    for (let i = 0; i < 32; i++) {
        const idx = i >> 1 // bass + lead arrays are 16-long; double-step.
        triNote(i * step, i * step + step * 0.78, bass[idx % bass.length], 0.16)(signal)
        if (i % 2 === 0) softNote(i * step, i * step + step * 1.6, lead[idx % lead.length], 0.08)(signal)
        // Kick on quarter notes.
        if (i % 4 === 0) kick(i * step, 0.36)(signal)
        // Snare-ish noise burst on backbeat.
        if (i % 8 === 4) noiseBurst(i * step, i * step + 0.06, 0.14, 300 + i)(signal)
        // Hi-hat on every step.
        hihat(i * step, 0.045, 350 + i)(signal)
    }
    crossfadeEnds(signal, 0.14)
    return signal
}

/**
 * Cave — D minor drone with sparse melodic chimes at irregular
 * intervals. No drums. Filtered rumble underneath gives the depth.
 *
 * Scale: D(147) F(174) G(196) A(220) C(262)
 */
function caveLoop(duration) {
    const signal = make(duration)
    // Sustained drone tones — two long held notes per loop.
    softNote(0, duration * 0.55, 73, 0.10)(signal)   // D2
    softNote(duration * 0.45, duration, 65, 0.10)(signal) // C2
    softNote(0, duration, 110, 0.06)(signal)         // A2 pad
    // Sparse chimes at irregular positions.
    const chimes = [
        { at: 0.18, hz: 523, dur: 1.4 },
        { at: 0.42, hz: 392, dur: 1.8 },
        { at: 0.68, hz: 587, dur: 1.6 },
        { at: 0.85, hz: 440, dur: 1.4 },
    ]
    for (const c of chimes) {
        const s = duration * c.at
        softNote(s, s + c.dur, c.hz, 0.05)(signal)
        // Octave shimmer.
        softNote(s + 0.1, s + c.dur * 0.6, c.hz * 2, 0.025)(signal)
    }
    // Low rumble underneath.
    filteredNoise(0, duration, 0.05, 220, 4501)(signal)
    crossfadeEnds(signal, 0.45)
    return signal
}

// ─────────────────────────────────────────────────────────────────────
// Ambient loops (new)
// ─────────────────────────────────────────────────────────────────────

/**
 * Rain texture: a continuous filtered-noise hiss with sparse
 * higher-frequency crackle representing individual droplet impacts.
 * The cutoff is high enough that the body sits in the "shhhh" band
 * humans associate with light rain.
 */
function rainLoop(duration) {
    const signal = make(duration)
    filteredNoise(0, duration, 0.20, 4000, 5001)(signal)
    filteredNoise(0, duration, 0.10, 1600, 5011)(signal)
    crackle(0, duration, 0.32, 0.18, 5021)(signal)
    crossfadeEnds(signal, 0.20)
    return signal
}

/**
 * Heavier rain + gusty wind. The brown rumble underneath sells "this
 * storm has weight".
 */
function stormLoop(duration) {
    const signal = make(duration)
    filteredNoise(0, duration, 0.28, 5500, 5101)(signal)
    filteredNoise(0, duration, 0.14, 1400, 5111)(signal)
    rumble(0, duration, 50, 0.10, 5121)(signal)
    crackle(0, duration, 0.5, 0.18, 5131)(signal)
    // Slow LFO panned amplitude wobble simulating gusts.
    const len = signal.length
    for (let i = 0; i < len; i++) {
        const t = i / sampleRate
        const gust = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.18 * t) * Math.cos(2 * Math.PI * 0.07 * t + 1.3)
        signal[i] *= gust
    }
    crossfadeEnds(signal, 0.28)
    return signal
}

/**
 * Wind: a slow gusting band of filtered noise. The cutoff swings
 * between 600 and 1400 Hz to give the "ooooo→sssss→ooooo" of a real
 * wind.
 */
function windLoop(duration) {
    const signal = make(duration)
    filteredNoise(0, duration, 0.18, 900, 5201)(signal)
    const len = signal.length
    for (let i = 0; i < len; i++) {
        const t = i / sampleRate
        // Two LFOs at different rates → never-quite-repeating envelope.
        const gust = 0.55 + 0.45 * (
            0.5 * Math.sin(2 * Math.PI * 0.22 * t) +
            0.5 * Math.sin(2 * Math.PI * 0.13 * t + 0.7)
        )
        signal[i] *= gust
    }
    crossfadeEnds(signal, 0.30)
    return signal
}

/**
 * Quiet piano — short ascending phrases in C major pentatonic with a
 * slow held bass note underneath. Designed to sit behind ambience.
 *
 * Scale: C3(131) D3(147) E3(165) G3(196) A3(220) C4(262) D4(294) E4(330)
 */
function pianoQuietLoop(duration) {
    const signal = make(duration)
    // Sustained bass — fundamental of the key. Long, very quiet, just
    // gives the loop a tonal centre to lean on.
    pianoNote(0, duration, 65, 0.045)(signal)
    pianoNote(duration * 0.5, duration, 98, 0.030)(signal)
    // Top-line phrase. Sparse — 5 notes over the loop. Pentatonic
    // pattern keeps every note consonant with the bass without needing
    // explicit chord changes.
    const phrase = [
        { at: 0.05, hz: 262, dur: 1.0 },
        { at: 0.22, hz: 330, dur: 0.9 },
        { at: 0.40, hz: 392, dur: 1.4 },
        { at: 0.60, hz: 294, dur: 1.0 },
        { at: 0.80, hz: 220, dur: 1.6 },
    ]
    for (const n of phrase) {
        const start = n.at * duration
        pianoNote(start, start + n.dur, n.hz, 0.16)(signal)
    }
    crossfadeEnds(signal, 0.40)
    return signal
}

/**
 * Night piano — lower register, A minor, melodic notes spaced further
 * apart. Less optimistic than `pianoQuietLoop`.
 */
function pianoNightLoop(duration) {
    const signal = make(duration)
    pianoNote(0, duration, 55, 0.05)(signal)
    pianoNote(duration * 0.42, duration, 82, 0.035)(signal)
    const phrase = [
        { at: 0.04, hz: 220, dur: 1.3 },
        { at: 0.20, hz: 196, dur: 1.2 },
        { at: 0.34, hz: 247, dur: 1.4 },
        { at: 0.50, hz: 165, dur: 1.6 },
        { at: 0.66, hz: 196, dur: 1.0 },
        { at: 0.80, hz: 147, dur: 1.7 },
    ]
    for (const n of phrase) {
        const start = n.at * duration
        pianoNote(start, start + n.dur, n.hz, 0.14)(signal)
    }
    crossfadeEnds(signal, 0.45)
    return signal
}

/**
 * Drift piano — slow alternating two-note motif (a "minor 6th sigh")
 * over a sub-bass pad. Very few notes, lots of empty space, leans on
 * the decay tails for continuity.
 */
function pianoDriftLoop(duration) {
    const signal = make(duration)
    pianoNote(0, duration, 73, 0.05)(signal)
    pianoNote(duration * 0.5, duration, 110, 0.038)(signal)
    // Two-note sigh: high note → fall to lower neighbour. Repeats with
    // slight pitch variation each pass so the loop doesn't feel ticky.
    const passes = [
        { at: 0.08, hi: 392, lo: 330 },
        { at: 0.30, hi: 349, lo: 294 },
        { at: 0.55, hi: 415, lo: 349 },
        { at: 0.78, hi: 330, lo: 262 },
    ]
    for (const p of passes) {
        const start = p.at * duration
        pianoNote(start, start + 1.1, p.hi, 0.13)(signal)
        pianoNote(start + 0.55, start + 1.6, p.lo, 0.11)(signal)
    }
    crossfadeEnds(signal, 0.50)
    return signal
}

// ─────────────────────────────────────────────────────────────────────
// Ambient music set — "calm and intriguing" location beds
// ─────────────────────────────────────────────────────────────────────
// A C418-inspired family: sparse acoustic-ish piano (`pianoNote`) over a
// warm breathing pad (`padNote`), no drums, long loops, lots of empty
// space. Tuned to stay un-fatiguing across hours — low amplitudes, soft
// attacks, gentle modal colour for "intrigue" instead of big hooks. Each
// location gets its own key, register and density so they read as
// distinct places, not one track re-skinned.

/**
 * Start / spawn bed — "Threshold". C major with a single raised 4th
 * (F#, Lydian) that gives the otherwise-welcoming phrase a curious,
 * open-ended lift. Pad climbs C2 → G2 across the loop; A2 inner warmth
 * holds throughout.
 */
function ambStartLoop(duration) {
    const signal = make(duration)
    padNote(0, duration * 0.62, 65, 0.05)(signal)          // C2
    padNote(duration * 0.5, duration, 98, 0.045)(signal)   // G2 lift
    padNote(0, duration, 110, 0.03)(signal)                // A2 inner warmth
    const phrase = [
        { at: 0.05, hz: 330, dur: 1.6 }, // E4
        { at: 0.18, hz: 392, dur: 1.4 }, // G4
        { at: 0.32, hz: 440, dur: 1.8 }, // A4
        { at: 0.48, hz: 370, dur: 1.6 }, // F#4 — Lydian colour, the "intrigue"
        { at: 0.64, hz: 330, dur: 1.4 }, // E4
        { at: 0.78, hz: 294, dur: 2.0 }, // D4
        { at: 0.90, hz: 262, dur: 2.2 }, // C4 — resolve home
    ]
    for (const n of phrase) {
        const s = n.at * duration
        pianoNote(s, s + n.dur, n.hz, 0.15)(signal)
    }
    // High bell glints, octave up, very quiet — the "stars" over the bed.
    pianoNote(0.28 * duration, 0.28 * duration + 1.2, 659, 0.05)(signal)  // E5
    pianoNote(0.72 * duration, 0.72 * duration + 1.4, 587, 0.045)(signal) // D5
    // No noise bed — piano + pad carry it. A continuous high-cutoff hiss
    // reads as white noise and fatigues over a long session.
    crossfadeEnds(signal, 0.5)
    return signal
}

/**
 * Garden bed — "Verdant". F major with a natural B (F Lydian #4) for a
 * pastoral, slightly wistful brightness. A recurring two-note rise →
 * gentle fall, like a question answered. Warmer and a touch denser than
 * the start bed.
 */
function ambGardenLoop(duration) {
    const signal = make(duration)
    padNote(0, duration, 87, 0.05)(signal)                 // F2 root
    padNote(0, duration, 131, 0.03)(signal)                // C3 inner
    padNote(duration * 0.45, duration, 174, 0.028)(signal) // F3 lift
    const phrase = [
        { at: 0.05, hz: 440, dur: 1.2 }, // A4
        { at: 0.14, hz: 523, dur: 1.4 }, // C5 — question, rising
        { at: 0.30, hz: 494, dur: 1.6 }, // B4 — Lydian #4, the bright "intrigue"
        { at: 0.46, hz: 440, dur: 1.4 }, // A4
        { at: 0.60, hz: 392, dur: 1.6 }, // G4
        { at: 0.74, hz: 349, dur: 2.2 }, // F4 — answer, resolve
        { at: 0.88, hz: 262, dur: 1.8 }, // C4
    ]
    for (const n of phrase) {
        const s = n.at * duration
        pianoNote(s, s + n.dur, n.hz, 0.14)(signal)
    }
    pianoNote(0.22 * duration, 0.22 * duration + 1.0, 698, 0.045)(signal) // F5 glint
    pianoNote(0.66 * duration, 0.66 * duration + 1.2, 880, 0.04)(signal)  // A5 glint
    crossfadeEnds(signal, 0.5)
    return signal
}

/**
 * Town bed — "Commons". The only track with real harmonic motion: a
 * slow I–vi–IV–V in G major (G → Em → C → D) traced by the bass pad,
 * with a gentle rolling three-note arpeggio over each chord. Reads as
 * "a warm, lived-in place" without ever building to a hook.
 */
function ambTownLoop(duration) {
    const signal = make(duration)
    // Bass roots — one chord per quarter of the loop, overlapping so the
    // changes melt into each other.
    padNote(0.00 * duration, 0.30 * duration, 98, 0.05)(signal) // G2  (I)
    padNote(0.25 * duration, 0.55 * duration, 82, 0.05)(signal) // E2  (vi)
    padNote(0.50 * duration, 0.80 * duration, 65, 0.05)(signal) // C2  (IV)
    padNote(0.75 * duration, 1.00 * duration, 73, 0.05)(signal) // D2  (V)
    padNote(0, duration, 247, 0.022)(signal)                    // B3 inner warmth
    const chords = [
        { at: 0.02, notes: [392, 494, 587] }, // G:  G4 B4 D5
        { at: 0.27, notes: [330, 392, 494] }, // Em: E4 G4 B4
        { at: 0.52, notes: [262, 330, 392] }, // C:  C4 E4 G4
        { at: 0.77, notes: [294, 370, 440] }, // D:  D4 F#4 A4
    ]
    for (const c of chords) {
        for (let k = 0; k < c.notes.length; k++) {
            const s = c.at * duration + k * 0.5 // ~half-second roll, key-independent
            pianoNote(s, s + 2.4, c.notes[k], 0.11)(signal)
        }
    }
    crossfadeEnds(signal, 0.5)
    return signal
}

/**
 * Extreme-situation bed — "Unrest". Still ambient, NOT an action loop:
 * dread, not a drum-driven fight. A low D2 beats against a quiet Eb2 a
 * semitone above (the two frequencies clash and pulse on their own); a
 * tritone Ab2 swells in mid-loop; a sub-bass G1 is felt more than heard.
 * Sparse low piano picks out minor-third and tritone colours. Kept quiet
 * and slow on purpose — it should make the player uneasy, not annoyed.
 * Intended for script-triggered danger (e.g. an NPC turning hostile):
 *   audio.play('music.amb.tension', { fade: 1.5 })
 */
function ambTensionLoop(duration) {
    const signal = make(duration)
    padNote(0, duration, 73, 0.06)(signal)                       // D2
    padNote(0, duration, 78, 0.03)(signal)                       // Eb2 — semitone clash
    padNote(duration * 0.35, duration * 0.8, 104, 0.04)(signal)  // Ab2 — tritone swell
    padNote(0, duration, 49, 0.05)(signal)                       // G1 — sub rumble, felt
    pianoNote(0.10 * duration, 0.10 * duration + 2.0, 147, 0.10)(signal) // D3
    pianoNote(0.12 * duration, 0.12 * duration + 2.0, 175, 0.08)(signal) // F3 — minor 3rd
    pianoNote(0.42 * duration, 0.42 * duration + 1.8, 208, 0.09)(signal) // Ab3 — tritone, the dread note
    pianoNote(0.66 * duration, 0.66 * duration + 1.6, 156, 0.07)(signal) // Eb3 — minor 2nd, tension
    pianoNote(0.84 * duration, 0.84 * duration + 2.2, 147, 0.10)(signal) // D3 — unresolved settle
    filteredNoise(0, duration, 0.05, 700, 7031)(signal) // dark, low-cutoff air
    crossfadeEnds(signal, 0.45)
    return signal
}

/**
 * Cave bed — "Deepwater". The sparsest track: a deep D2 + A2 drone (C2
 * joins for depth in the second half), a handful of distant long-decay
 * piano notes, and rare echoing water drops at irregular spots. The low
 * 300 Hz air hum is the underground "pressure". Built so long stretches
 * are nearly silent — the drops are events, not a beat.
 *   audio.play('music.amb.cave', { fade: 1.5 })
 */
function ambCaveLoop(duration) {
    const signal = make(duration)
    padNote(0, duration, 73, 0.055)(signal)             // D2
    padNote(0, duration, 110, 0.03)(signal)             // A2
    padNote(duration * 0.5, duration, 65, 0.04)(signal) // C2 depth, second half
    pianoNote(0.15 * duration, 0.15 * duration + 2.6, 220, 0.08)(signal) // A3
    pianoNote(0.48 * duration, 0.48 * duration + 3.0, 175, 0.07)(signal) // F3
    pianoNote(0.78 * duration, 0.78 * duration + 3.4, 147, 0.07)(signal) // D3
    // Rare water drops — irregular spacing, varied pitch, each echoes.
    const drops = [
        { at: 0.07, hz: 880 },
        { at: 0.24, hz: 1175 },
        { at: 0.38, hz: 740 },
        { at: 0.55, hz: 988 },
        { at: 0.69, hz: 1318 },
        { at: 0.86, hz: 831 },
    ]
    for (const d of drops) waterDrop(d.at * duration, d.hz, 0.20)(signal)
    filteredNoise(0, duration, 0.04, 300, 7041)(signal) // deep underground hum
    crossfadeEnds(signal, 0.6)
    return signal
}

/**
 * Mine bed — "Hollowdeep". The abandoned dwarven deep, below the caves:
 * a heavy D2/A2 stone drone over a felt G1 sub, a slow solemn D-minor
 * motif (the faded dwarf-hall song) on distant long-decay piano with one
 * cold organ swell remembering the great hall, the ghost of the forge
 * (rare faint metal rings), echoing water drops from the flooded grotto,
 * old timber-support creaks, and a low shaft draft. Sparser and darker
 * than `ambCaveLoop` — long near-silent stretches make each event read as
 * a memory rather than a beat.
 *   environment.soundId = 'music.amb.mine'
 */
function ambMineLoop(duration) {
    const signal = make(duration)
    const d = duration
    // Bedrock drone — deeper and heavier than the cave bed (we're below it).
    padNote(0, d, 73, 0.06)(signal)               // D2 root
    padNote(0, d, 110, 0.032)(signal)             // A2 fifth
    padNote(0, d, 49, 0.05)(signal)               // G1 sub — felt weight of stone
    padNote(d * 0.55, d, 65, 0.035)(signal)       // C2 settles in, second half
    // Faded dwarf-hall motif — a slow falling D-minor phrase, distant piano.
    pianoNote(0.08 * d, 0.08 * d + 3.0, 147, 0.085)(signal) // D3
    pianoNote(0.21 * d, 0.21 * d + 2.8, 175, 0.075)(signal) // F3 (minor 3rd)
    pianoNote(0.34 * d, 0.34 * d + 3.2, 131, 0.070)(signal) // C3 (falling)
    pianoNote(0.53 * d, 0.53 * d + 3.6, 110, 0.075)(signal) // A2 (mournful settle)
    pianoNote(0.75 * d, 0.75 * d + 3.4, 147, 0.070)(signal) // D3 (unresolved return)
    // One cold organ swell — the great hall, long empty, briefly remembered.
    organNote(0.40 * d, 0.40 * d + 4.0, 73, 0.030)(signal)  // D2
    organNote(0.40 * d, 0.40 * d + 4.0, 110, 0.022)(signal) // A2
    // Ghost of the forge — rare faint metallic rings (anvils gone cold).
    shimmer(0.16 * d, 0.16 * d + 1.2, 587, 0.050)(signal)   // D5 distant ring
    shimmer(0.63 * d, 0.63 * d + 1.4, 440, 0.045)(signal)   // A4
    // Echoing drops — the flooded lower grotto. Irregular, varied pitch.
    const drops = [
        { at: 0.05, hz: 831 },
        { at: 0.29, hz: 1108 },
        { at: 0.47, hz: 698 },
        { at: 0.71, hz: 988 },
        { at: 0.91, hz: 740 },
    ]
    for (const dr of drops) waterDrop(dr.at * d, dr.hz, 0.18)(signal)
    // Timber-support creaks — old props settling, a woody downward groan.
    chirpNoise(0.37 * d, 0.37 * d + 0.6, 520, 220, 0.06, 7062)(signal)
    chirpNoise(0.83 * d, 0.83 * d + 0.7, 460, 190, 0.05, 7063)(signal)
    // Deep shaft draft — low-cutoff air pressure moving through the shafts.
    filteredNoise(0, d, 0.045, 260, 7061)(signal)
    crossfadeEnds(signal, 0.7)
    return signal
}

// ─────────────────────────────────────────────────────────────────────
// Themed music set
// ─────────────────────────────────────────────────────────────────────

/**
 * Menu — "Title". Warm and hopeful: the classic I–V–vi–IV (C–G–Am–F)
 * progression on a pad bed with a flowing piano melody and a couple of
 * high shimmer glints. More melodic than the ambient beds — you sit on it
 * while deciding, so it has an actual tune.
 */
function menuTheme(duration) {
    const signal = make(duration)
    const d = duration
    // Bass roots, one chord per quarter of the loop (I–V–vi–IV).
    padNote(0.00 * d, 0.28 * d, 65, 0.06)(signal)  // C2
    padNote(0.25 * d, 0.53 * d, 98, 0.06)(signal)  // G2
    padNote(0.50 * d, 0.78 * d, 110, 0.06)(signal) // A2 (vi)
    padNote(0.75 * d, 1.00 * d, 87, 0.06)(signal)  // F2 (IV)
    padNote(0, d, 196, 0.022)(signal)              // G3 inner warmth
    const melody = [
        { at: 0.03, hz: 330, dur: 1.6 }, // E4
        { at: 0.12, hz: 392, dur: 1.4 }, // G4
        { at: 0.22, hz: 523, dur: 2.0 }, // C5
        { at: 0.34, hz: 494, dur: 1.6 }, // B4
        { at: 0.44, hz: 440, dur: 1.6 }, // A4
        { at: 0.54, hz: 392, dur: 1.6 }, // G4
        { at: 0.64, hz: 440, dur: 1.4 }, // A4
        { at: 0.72, hz: 523, dur: 2.0 }, // C5
        { at: 0.82, hz: 587, dur: 1.6 }, // D5
        { at: 0.90, hz: 523, dur: 2.4 }, // C5 — resolve
    ]
    for (const n of melody) pianoNote(n.at * d, n.at * d + n.dur, n.hz, 0.15)(signal)
    shimmer(0.28 * d, 0.28 * d + 1.0, 1047, 0.05)(signal)  // C6 glint
    shimmer(0.78 * d, 0.78 * d + 1.2, 1319, 0.045)(signal) // E6 glint
    crossfadeEnds(signal, 0.6)
    return signal
}

/**
 * Tavern — "Merry". A bouncing folk jig in G major: an oom-pah bass
 * (root on the beat, fifth off it), a light off-beat hi-hat, a soft kick
 * on the downbeats, and a jaunty triangle-wave fiddle tune over the top.
 * The lively one — actual rhythm, unlike the calm beds.
 */
function tavernTheme(duration) {
    const signal = make(duration)
    const d = duration
    const step = d / 16
    const barRoot = [98, 131, 147, 98]   // G  C  D  G
    const barFifth = [147, 196, 220, 147] // D  G  A  D
    for (let i = 0; i < 16; i++) {
        const bar = Math.floor(i / 4)
        const bassHz = (i % 2 === 0 ? barRoot[bar] : barFifth[bar]) * 0.5 // octave-down oom-pah
        triNote(i * step, i * step + step * 0.55, bassHz, 0.16)(signal)
        if (i % 2 === 1) hihat(i * step, 0.05, 200 + i)(signal)        // off-beat tap
        if (i % 4 === 0) kick(i * step, 0.10)(signal)                 // downbeat bounce
    }
    // Merry fiddle line (triangle), one note per step with a couple of rests.
    const mel = [392, 440, 494, 587, 494, 440, 392, 440, 523, 494, 440, 392, 440, 392, 294, 0]
    for (let i = 0; i < mel.length; i++) {
        if (mel[i] === 0) continue
        triNote(i * step, i * step + step * 0.9, mel[i], 0.12)(signal)
    }
    crossfadeEnds(signal, 0.12)
    return signal
}

/**
 * Royal — "Court". A stately processional in D major: a sustained organ
 * brass-pad tracing I–IV–V–I (D–G–A–D), a marching octave bass pulse, a
 * soft timpani-ish kick on the downbeats, and a noble dotted horn call on
 * the triangle lead, capped with a shimmer fanfare sparkle.
 */
function royalTheme(duration) {
    const signal = make(duration)
    const d = duration
    const step = d / 16
    const barRoot = [73, 98, 110, 73] // D2 G2 A2 D2
    for (let bar = 0; bar < 4; bar++) {
        // Sustained organ pad chord (root + fifth) across the bar.
        organNote(bar * 4 * step, (bar * 4 + 4) * step, barRoot[bar], 0.05)(signal)
        organNote(bar * 4 * step, (bar * 4 + 4) * step, barRoot[bar] * 1.5, 0.035)(signal)
    }
    for (let i = 0; i < 16; i++) {
        const bar = Math.floor(i / 4)
        triNote(i * step, i * step + step * 0.5, barRoot[bar], 0.13)(signal) // march bass
        if (i % 4 === 0) kick(i * step, 0.18)(signal)                       // processional pulse
    }
    // Noble horn call (triangle), dotted rhythm — a proud rising motif.
    const call = [
        { at: 0.02, hz: 294, dur: 0.9 }, // D4
        { at: 0.10, hz: 440, dur: 0.7 }, // A4
        { at: 0.16, hz: 587, dur: 1.3 }, // D5 (rise of an octave)
        { at: 0.28, hz: 494, dur: 0.7 }, // B4
        { at: 0.34, hz: 587, dur: 1.4 }, // D5
        { at: 0.52, hz: 440, dur: 0.9 }, // A4
        { at: 0.60, hz: 587, dur: 0.7 }, // D5
        { at: 0.66, hz: 659, dur: 1.6 }, // E5
        { at: 0.80, hz: 587, dur: 0.8 }, // D5
        { at: 0.87, hz: 440, dur: 1.6 }, // A4 — settle
    ]
    for (const n of call) triNote(n.at * d, n.at * d + n.dur, n.hz, 0.12)(signal)
    shimmer(0.16 * d, 0.16 * d + 0.9, 1175, 0.05)(signal) // D6 fanfare sparkle
    crossfadeEnds(signal, 0.4)
    return signal
}

/**
 * Cathedral — "Sanctum". Solemn and sacred: deep pipe-organ triads on a
 * slow Aeolian hymn (Dm–Bb–F–C) over a held low pedal, with a high choir
 * line (vibrato shimmer) drifting above. Very slow and legato; long
 * crossfade so the loop is seamless. Awe, not action.
 */
function cathedralTheme(duration) {
    const signal = make(duration)
    const d = duration
    // Low pedal organ — the cathedral's foundation, held throughout.
    organNote(0, d, 73, 0.05)(signal) // D2
    // Sustained triads, one chord per quarter of the loop (i–VI–III–VII).
    const chords = [
        [147, 175, 220], // Dm:  D3 F3 A3
        [117, 147, 175], // Bb:  Bb2 D3 F3
        [175, 220, 262], // F:   F3 A3 C4
        [131, 165, 196], // C:   C3 E3 G3
    ]
    for (let c = 0; c < 4; c++) {
        const s = (c * 0.25) * d
        const e = (c * 0.25 + 0.27) * d // slight overlap so chords melt together
        for (const hz of chords[c]) organNote(s, e, hz, 0.04)(signal)
    }
    // High choir line above (vibrato shimmer), a slow descending hymn.
    const choir = [
        { at: 0.02, hz: 587, dur: 2.4 }, // D5
        { at: 0.27, hz: 523, dur: 2.4 }, // C5
        { at: 0.52, hz: 440, dur: 2.4 }, // A4
        { at: 0.77, hz: 392, dur: 2.8 }, // G4 — settle
    ]
    for (const n of choir) shimmer(n.at * d, n.at * d + n.dur, n.hz, 0.06)(signal)
    crossfadeEnds(signal, 0.8)
    return signal
}

/**
 * Fire crackle ambience. Two crackle densities layered over a low
 * filtered "roar" — the eye+ear picks "fire" out of the combination
 * without any specific frequency standing out.
 */
function fireLoop(duration) {
    const signal = make(duration)
    filteredNoise(0, duration, 0.10, 600, 5301)(signal)
    crackle(0, duration, 0.85, 0.32, 5311)(signal)
    crackle(0, duration, 0.30, 0.18, 5321)(signal)
    // Slow flicker amplitude.
    const len = signal.length
    for (let i = 0; i < len; i++) {
        const t = i / sampleRate
        const flicker = 0.88 + 0.12 * Math.sin(2 * Math.PI * 1.7 * t + Math.sin(t * 0.9))
        signal[i] *= flicker
    }
    crossfadeEnds(signal, 0.22)
    return signal
}

/**
 * Torch loop — much smaller than `fireLoop`. Drops the low-frequency
 * "roar" filtered-noise bed (a torch is just a stick of fire, not a
 * burning log) and keeps a single-density crackle layer with a higher
 * cutoff so individual snaps read as pops, not whumps. Lower amplitude
 * overall — the runtime plays many of these simultaneously near the
 * player.
 */
function torchLoop(duration) {
    const signal = make(duration)
    // High-pass-ish filler — narrow band 1.2 kHz noise so the bed sits
    // *above* environmental rumble instead of competing with it.
    filteredNoise(0, duration, 0.06, 1500, 5331)(signal)
    crackle(0, duration, 0.45, 0.22, 5341)(signal)
    crackle(0, duration, 0.18, 0.12, 5351)(signal)
    const len = signal.length
    for (let i = 0; i < len; i++) {
        const t = i / sampleRate
        const flicker = 0.86 + 0.14 * Math.sin(2 * Math.PI * 2.6 * t + Math.sin(t * 1.4))
        signal[i] *= flicker
    }
    crossfadeEnds(signal, 0.22)
    return signal
}

/**
 * Water lapping — soft filtered noise with bubble pops scattered
 * across the loop.
 */
function waterLoop(duration) {
    const signal = make(duration)
    filteredNoise(0, duration, 0.10, 1200, 5401)(signal)
    // Sparse bubbles.
    for (let i = 0; i < 24; i++) {
        const t = (i + 0.5) * (duration / 24) - 0.05
        bubble(t, t + 0.22, 320 + (i * 41) % 200, 0.14, 5410 + i)(signal)
    }
    const len = signal.length
    for (let i = 0; i < len; i++) {
        const t = i / sampleRate
        const wave = 0.7 + 0.30 * Math.sin(2 * Math.PI * 0.35 * t)
        signal[i] *= wave
    }
    crossfadeEnds(signal, 0.24)
    return signal
}

/**
 * Lava bubbling — sparser, deeper, hotter than water. The base
 * noise has a lower cutoff and the bubbles use a wider pitch range.
 */
function lavaLoop(duration) {
    const signal = make(duration)
    filteredNoise(0, duration, 0.14, 700, 5501)(signal)
    rumble(0, duration, 40, 0.08, 5511)(signal)
    for (let i = 0; i < 22; i++) {
        const t = (i + 0.5) * (duration / 22) - 0.06
        bubble(t, t + 0.32, 180 + (i * 53) % 240, 0.22, 5520 + i)(signal)
    }
    crackle(0, duration, 0.10, 0.14, 5550)(signal)
    crossfadeEnds(signal, 0.26)
    return signal
}

/**
 * Magic ambience — slow, harmonic, ethereal. Stack of soft notes at
 * just-intoned intervals, each fading in and out at its own rate so
 * the timbre never quite settles.
 */
function magicLoop(duration) {
    const signal = make(duration)
    const tones = [220, 277, 329, 369, 440, 554]
    for (let i = 0; i < tones.length; i++) {
        const hz = tones[i]
        const phase = (i * 0.37) % 1
        const start = phase * duration
        const dur = 0.7 * duration
        const end = start + dur
        if (end <= duration) {
            note(start, end, hz, 0.07)(signal)
        } else {
            // Wraps the loop — play tail at start so the loop point
            // doesn't drop a voice.
            note(start, duration, hz, 0.07)(signal)
            note(0, end - duration, hz, 0.07)(signal)
        }
    }
    // Soft, dark shimmer — a low cutoff and low amplitude so it adds a hint
    // of "air" without the bright 6 kHz hiss that fatigues when a magic zone
    // (e.g. the demo portal) loops next to the player for minutes.
    filteredNoise(0, duration, 0.022, 2600, 5601)(signal)
    crossfadeEnds(signal, 0.30)
    return signal
}

/**
 * Rail-cart rolling loop — a loaded mine cart on iron rails. A low wheel
 * rumble + mid friction hiss carry the body; evenly spaced rail-joint
 * clacks (wheel pluck + metallic ring) give the "clack-clack" of crossing
 * sleepers, spaced so the loop wraps seamlessly; a faint axle squeak
 * drifts up then back so the bed never feels frozen. Played spatially with
 * `loop: true` while the cart moves and stopped (fade-out) when it halts.
 */
function cartRollingLoop(duration) {
    const signal = make(duration)
    const d = duration
    rumble(0, d, 70, 0.16, 8101)(signal)             // loaded wheels on rail
    filteredNoise(0, d, 0.10, 1400, 8103)(signal)    // wheel / rail friction hiss
    const joints = 6                                  // rail-joint clacks
    for (let i = 0; i < joints; i++) {
        const t = (i / joints) * d
        pluck(t, t + 0.05, 220, 0.18)(signal)        // wheel strikes the joint
        triNote(t, t + 0.04, 660, 0.06)(signal)      // metallic ring of the rail
    }
    sineChirp(0.10 * d, 0.55 * d, 900, 1150, 0.03)(signal) // axle squeak drifts up…
    sineChirp(0.55 * d, d, 1150, 900, 0.03)(signal)        // …and back
    crossfadeEnds(signal, 0.08)
    return signal
}

// ─────────────────────────────────────────────────────────────────────
// Loop-point smoothing
// ─────────────────────────────────────────────────────────────────────

/** Equal-power crossfade of the last `fadeS` seconds with the start —
 *  ensures the loop point doesn't click. */
function crossfadeEnds(signal, fadeS) {
    const fade = Math.min(Math.floor(fadeS * sampleRate), Math.floor(signal.length * 0.45))
    if (fade <= 4) return
    for (let i = 0; i < fade; i++) {
        const p = i / fade
        const fIn = Math.sin(p * Math.PI * 0.5)
        const fOut = Math.cos(p * Math.PI * 0.5)
        const head = signal[i]
        const tail = signal[signal.length - fade + i]
        signal[i] = head * fIn + tail * fOut
        signal[signal.length - fade + i] = head * fOut + tail * fIn
    }
}

// ─────────────────────────────────────────────────────────────────────
// Wave shapes + envelopes
// ─────────────────────────────────────────────────────────────────────

function square(hz, t) {
    return (t * hz) % 1 < 0.5 ? 1 : -1
}

function envelope(p) {
    const attack = Math.min(1, p / 0.08)
    const release = Math.min(1, (1 - p) / 0.22)
    return Math.max(0, Math.min(attack, release))
}

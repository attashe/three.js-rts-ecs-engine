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
    filteredNoise(0, duration, 0.04, 6000, 5601)(signal)
    crossfadeEnds(signal, 0.30)
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

import { Color } from 'three'

/**
 * Day/night cycle table + lerp.
 *
 * `sampleDayCycle(t)` returns a fully-resolved palette (sky, fog, sun,
 * ambient, hemisphere) for any hour `t` in `[0, 24)`. It's a pure
 * function of `t` — no Three.js scene state, no allocations on the hot
 * path beyond the returned object. Authors pick a *time*; the renderer
 * uses the resulting palette without the author having to hand-match
 * seven colour swatches.
 *
 * The table covers a single canonical "outdoor day". Per-level
 * stylisation goes through the `skyTint` / `sunIntensityMul` /
 * `fogDensityMul` multipliers in `AmbientWeatherState`, layered on top
 * of the sampled palette in `AmbientWeather.applyDerivedFromTime`.
 */

export interface CycleStop {
    /** Hour of day in [0, 24). The 0 stop wraps to the 24 stop. */
    hour: number
    skyTop: [number, number, number]
    skyBottom: [number, number, number]
    fogColor: [number, number, number]
    fogDensity: number
    sunColor: [number, number, number]
    /** Pre-horizon-falloff. `AmbientWeather` still applies its own
     *  sin-of-elevation falloff so sun below the horizon doesn't bleed. */
    sunIntensity: number
    ambientColor: [number, number, number]
    ambientIntensity: number
    hemiSky: [number, number, number]
    hemiGround: [number, number, number]
    hemiIntensity: number
}

/**
 * Canonical stops covering one full day. Values are chosen so adjacent
 * stops interpolate cleanly with linear blending — no need for
 * smoothstep along the time axis. Colours are linear-space.
 */
export const DAY_CYCLE_STOPS: readonly CycleStop[] = [
    {
        // 00:00 — midnight. Deep indigo sky, low cool ambient, no sun.
        hour: 0,
        skyTop: [0.02, 0.03, 0.08],
        skyBottom: [0.05, 0.07, 0.14],
        fogColor: [0.04, 0.05, 0.10],
        fogDensity: 0.022,
        sunColor: [0.55, 0.62, 0.95],
        sunIntensity: 0.0,
        ambientColor: [0.16, 0.20, 0.34],
        ambientIntensity: 0.22,
        hemiSky: [0.10, 0.14, 0.28],
        hemiGround: [0.05, 0.06, 0.10],
        hemiIntensity: 0.12,
    },
    {
        // 05:00 — pre-dawn. First blue starts to climb the horizon.
        hour: 5,
        skyTop: [0.10, 0.13, 0.28],
        skyBottom: [0.32, 0.30, 0.40],
        fogColor: [0.30, 0.28, 0.36],
        fogDensity: 0.024,
        sunColor: [0.95, 0.55, 0.32],
        sunIntensity: 0.12,
        ambientColor: [0.30, 0.30, 0.42],
        ambientIntensity: 0.32,
        hemiSky: [0.30, 0.32, 0.46],
        hemiGround: [0.12, 0.10, 0.10],
        hemiIntensity: 0.25,
    },
    {
        // 06:30 — dawn. Orange + pink horizon, warm low sun.
        hour: 6.5,
        skyTop: [0.22, 0.30, 0.55],
        skyBottom: [0.94, 0.66, 0.48],
        fogColor: [0.92, 0.70, 0.55],
        fogDensity: 0.018,
        sunColor: [1.00, 0.72, 0.42],
        sunIntensity: 0.85,
        ambientColor: [0.55, 0.45, 0.45],
        ambientIntensity: 0.48,
        hemiSky: [0.65, 0.58, 0.60],
        hemiGround: [0.20, 0.14, 0.10],
        hemiIntensity: 0.32,
    },
    {
        // 09:00 — morning. Warm but lifting toward neutral.
        hour: 9,
        skyTop: [0.36, 0.58, 0.86],
        skyBottom: [0.85, 0.90, 1.00],
        fogColor: [0.78, 0.84, 0.92],
        fogDensity: 0.010,
        sunColor: [1.00, 0.92, 0.78],
        sunIntensity: 1.10,
        ambientColor: [0.62, 0.66, 0.75],
        ambientIntensity: 0.55,
        hemiSky: [0.68, 0.78, 0.90],
        hemiGround: [0.20, 0.16, 0.10],
        hemiIntensity: 0.35,
    },
    {
        // 12:00 — noon. Full sun, neutral white, light haze.
        hour: 12,
        skyTop: [0.36, 0.58, 0.86],
        skyBottom: [0.85, 0.92, 1.00],
        fogColor: [0.78, 0.86, 0.94],
        fogDensity: 0.008,
        sunColor: [1.00, 0.96, 0.88],
        sunIntensity: 1.30,
        ambientColor: [0.62, 0.68, 0.78],
        ambientIntensity: 0.58,
        hemiSky: [0.70, 0.82, 0.95],
        hemiGround: [0.20, 0.16, 0.10],
        hemiIntensity: 0.38,
    },
    {
        // 17:30 — dusk. Warm low sun, orange/violet horizon.
        hour: 17.5,
        skyTop: [0.24, 0.30, 0.55],
        skyBottom: [0.96, 0.58, 0.36],
        fogColor: [0.85, 0.55, 0.42],
        fogDensity: 0.018,
        sunColor: [1.00, 0.62, 0.32],
        sunIntensity: 0.90,
        ambientColor: [0.56, 0.42, 0.40],
        ambientIntensity: 0.45,
        hemiSky: [0.65, 0.50, 0.52],
        hemiGround: [0.18, 0.12, 0.08],
        hemiIntensity: 0.30,
    },
    {
        // 19:30 — twilight. Sun is dropping; sky violet-blue.
        hour: 19.5,
        skyTop: [0.10, 0.12, 0.30],
        skyBottom: [0.35, 0.25, 0.42],
        fogColor: [0.30, 0.22, 0.36],
        fogDensity: 0.022,
        sunColor: [0.85, 0.46, 0.42],
        sunIntensity: 0.18,
        ambientColor: [0.32, 0.28, 0.42],
        ambientIntensity: 0.32,
        hemiSky: [0.28, 0.28, 0.42],
        hemiGround: [0.10, 0.08, 0.08],
        hemiIntensity: 0.20,
    },
    {
        // 22:00 — night. Indigo sky, cool moon ambient, no sun.
        hour: 22,
        skyTop: [0.03, 0.05, 0.12],
        skyBottom: [0.08, 0.10, 0.18],
        fogColor: [0.05, 0.07, 0.12],
        fogDensity: 0.020,
        sunColor: [0.55, 0.62, 0.95],
        sunIntensity: 0.0,
        ambientColor: [0.18, 0.22, 0.36],
        ambientIntensity: 0.24,
        hemiSky: [0.12, 0.16, 0.30],
        hemiGround: [0.05, 0.06, 0.10],
        hemiIntensity: 0.14,
    },
] as const

/**
 * Sample the day cycle at `hour ∈ [0, 24)`. Out-of-range values wrap
 * (negative or ≥ 24) so callers can pass `(time + dt)` without worrying
 * about the boundary. Returns a fresh `CycleStop` — small enough that
 * the per-frame allocation is not worth pooling away.
 */
export function sampleDayCycle(hour: number): CycleStop {
    if (!Number.isFinite(hour)) return cloneStop(DAY_CYCLE_STOPS[0]!)
    const t = ((hour % 24) + 24) % 24
    const stops = DAY_CYCLE_STOPS
    let aIndex = stops.length - 1
    let bIndex = 0
    for (let i = 0; i < stops.length; i++) {
        const cur = stops[i]!
        const next = stops[(i + 1) % stops.length]!
        const nextHour = next.hour <= cur.hour ? next.hour + 24 : next.hour
        const tt = t < cur.hour ? t + 24 : t
        if (tt >= cur.hour && tt <= nextHour) {
            aIndex = i
            bIndex = (i + 1) % stops.length
            break
        }
    }
    const a = stops[aIndex]!
    const b = stops[bIndex]!
    const aHour = a.hour
    const bHour = b.hour <= aHour ? b.hour + 24 : b.hour
    const tHour = t < aHour ? t + 24 : t
    const span = bHour - aHour
    const k = span > 0 ? (tHour - aHour) / span : 0
    return {
        hour: t,
        skyTop: lerpRgb(a.skyTop, b.skyTop, k),
        skyBottom: lerpRgb(a.skyBottom, b.skyBottom, k),
        fogColor: lerpRgb(a.fogColor, b.fogColor, k),
        fogDensity: lerp(a.fogDensity, b.fogDensity, k),
        sunColor: lerpRgb(a.sunColor, b.sunColor, k),
        sunIntensity: lerp(a.sunIntensity, b.sunIntensity, k),
        ambientColor: lerpRgb(a.ambientColor, b.ambientColor, k),
        ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, k),
        hemiSky: lerpRgb(a.hemiSky, b.hemiSky, k),
        hemiGround: lerpRgb(a.hemiGround, b.hemiGround, k),
        hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, k),
    }
}

/** Apply an RGB triplet from the cycle to a Three.js Color in-place. */
export function applyColor(target: Color, rgb: [number, number, number]): void {
    target.setRGB(rgb[0], rgb[1], rgb[2])
}

/** Apply an RGB triplet with a per-channel tint multiplier. */
export function applyColorTinted(target: Color, rgb: [number, number, number], tint: [number, number, number]): void {
    target.setRGB(rgb[0] * tint[0], rgb[1] * tint[1], rgb[2] * tint[2])
}

function lerp(a: number, b: number, k: number): number {
    // Short-circuit endpoints so colour values at a stop hour round-trip
    // exactly — IEEE 754 makes `a + (b - a) * 1` drift by an ULP, which
    // visually doesn't matter but breaks deepEqual assertions in tests.
    if (k <= 0) return a
    if (k >= 1) return b
    return a + (b - a) * k
}

function lerpRgb(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
    if (k <= 0) return [a[0], a[1], a[2]]
    if (k >= 1) return [b[0], b[1], b[2]]
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}

function cloneStop(stop: CycleStop): CycleStop {
    return {
        hour: stop.hour,
        skyTop: [...stop.skyTop] as [number, number, number],
        skyBottom: [...stop.skyBottom] as [number, number, number],
        fogColor: [...stop.fogColor] as [number, number, number],
        fogDensity: stop.fogDensity,
        sunColor: [...stop.sunColor] as [number, number, number],
        sunIntensity: stop.sunIntensity,
        ambientColor: [...stop.ambientColor] as [number, number, number],
        ambientIntensity: stop.ambientIntensity,
        hemiSky: [...stop.hemiSky] as [number, number, number],
        hemiGround: [...stop.hemiGround] as [number, number, number],
        hemiIntensity: stop.hemiIntensity,
    }
}

/**
 * Format an hour-of-day value as HH:MM. Wraps negative + ≥24 input the
 * same way `sampleDayCycle` does so editor labels stay consistent.
 */
export function formatHourLabel(hour: number): string {
    if (!Number.isFinite(hour)) return '--:--'
    const t = ((hour % 24) + 24) % 24
    const hh = Math.floor(t)
    const mm = Math.floor((t - hh) * 60)
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** Canonical time-of-day stops used by the editor's preset chips. */
export const DAY_CYCLE_PRESET_HOURS: readonly { id: string; label: string; hour: number }[] = [
    { id: 'dawn', label: 'Dawn', hour: 6.5 },
    { id: 'morning', label: 'Morning', hour: 9 },
    { id: 'noon', label: 'Noon', hour: 12 },
    { id: 'dusk', label: 'Dusk', hour: 17.5 },
    { id: 'night', label: 'Night', hour: 21 },
    { id: 'midnight', label: 'Midnight', hour: 0 },
]

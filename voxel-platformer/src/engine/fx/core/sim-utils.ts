/**
 * Shared math + RNG helpers for the FX simulation. Pure functions, zero
 * Three dependencies — easy to unit-test, easy to inline.
 */

export const TAU = Math.PI * 2

export function clamp(v: number, a: number, b: number): number {
    return v < a ? a : v > b ? b : v
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

export function smoothstep(x: number, edge0: number, edge1: number): number {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
}

/**
 * Frame-rate independent damping. Equivalent to applying `coef` once
 * per second of simulated time — `Math.pow(coef, dt)` is the closed
 * form of repeating it dt/Δt times in the limit Δt→0. Match the
 * source demos' damping by passing their per-frame constant as `coef`
 * (already roughly per-second since they assumed ~60 FPS but we
 * smooth it out here).
 */
export function damping(coef: number, dt: number): number {
    return Math.pow(coef, dt)
}

/**
 * Seeded mulberry32 RNG. Deterministic across runs given the same
 * seed — used so a re-initialized zone produces the same noise
 * pattern. Returns a function that yields `[0, 1)`.
 */
export function makeRng(seed: number): () => number {
    let a = (seed | 0) >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function rand(rng: () => number, a: number, b: number): number {
    return a + rng() * (b - a)
}

/** Random sign ±1. */
export function randSign(rng: () => number): number {
    return rng() < 0.5 ? -1 : 1
}

/** Cheap 3D pseudo-curl noise used by fog / fire / boiling. Not
 *  physically a curl, but produces vortex-like advection at almost
 *  zero cost. */
export function curlNoise3(x: number, y: number, z: number, t: number): { x: number; y: number; z: number } {
    const a = Math.sin(x * 0.23 + t * 0.6) + Math.cos(y * 0.21 + t * 0.4)
    const b = Math.sin(y * 0.27 + t * 0.5) + Math.cos(z * 0.19 + t * 0.45)
    const c = Math.sin(z * 0.25 + t * 0.55) + Math.cos(x * 0.22 + t * 0.42)
    return { x: a, y: b, z: c }
}

/**
 * Wrap a coordinate that has drifted out of `[-half, +half]` back to
 * the other side. Used by fog/firefly/lightning to keep particles
 * inside their zone without obvious teleport boundaries.
 */
export function wrap(value: number, half: number): number {
    if (value > half) return value - half * 2
    if (value < -half) return value + half * 2
    return value
}

/** Convert CSS hex (#rrggbb / #rgb) to packed integer for Three. */
export function hexToInt(css: string): number {
    let s = css.trim()
    if (s.startsWith('#')) s = s.slice(1)
    if (s.length === 3) s = s.split('').map((c) => c + c).join('')
    return parseInt(s, 16) | 0
}

export type Rng = () => number

export function makeRng(seed: string | number): Rng {
    return mulberry32(xmur3(String(seed))())
}

function xmur3(str: string): () => number {
    let h = 1779033703 ^ str.length
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
        h = h << 13 | h >>> 19
    }
    return () => {
        h = Math.imul(h ^ h >>> 16, 2246822507)
        h = Math.imul(h ^ h >>> 13, 3266489909)
        return (h ^ h >>> 16) >>> 0
    }
}

function mulberry32(a: number): Rng {
    return () => {
        let t = a += 0x6D2B79F5
        t = Math.imul(t ^ t >>> 15, t | 1)
        t ^= t + Math.imul(t ^ t >>> 7, t | 61)
        return ((t ^ t >>> 14) >>> 0) / 4294967296
    }
}

export function randInt(rng: Rng, a: number, b: number): number {
    const lo = Math.ceil(Math.min(a, b))
    const hi = Math.floor(Math.max(a, b))
    return Math.floor(rng() * (hi - lo + 1)) + lo
}

export function randFloat(rng: Rng, a: number, b: number): number {
    return a + (b - a) * rng()
}

export function choose<T extends string>(value: T | 'mixed', list: readonly T[], rng: Rng): T {
    return value !== 'mixed' ? value : list[Math.floor(rng() * list.length)]!
}

export function clamp(v: number, a: number, b: number): number {
    return Math.max(a, Math.min(b, v))
}

export function clamp01(v: number): number {
    return clamp(v, 0, 1)
}

export function clampInt(v: number | undefined, a: number, b: number, fallback: number): number {
    return Math.round(clamp(finite(v, fallback), a, b))
}

export function finite(v: number | undefined, fallback: number): number {
    return Number.isFinite(v) ? v! : fallback
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

export function hash2(x: number, z: number, seed = 0): number {
    let h = (x * 374761393 + z * 668265263 + seed * 1442695041) | 0
    h = (h ^ (h >>> 13)) * 1274126177
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

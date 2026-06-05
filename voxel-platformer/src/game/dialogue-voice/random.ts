export type Rng = () => number

export function xmur3(str: string): () => number {
    let h = 1779033703 ^ str.length
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
        h = (h << 13) | (h >>> 19)
    }
    return () => {
        h = Math.imul(h ^ (h >>> 16), 2246822507)
        h = Math.imul(h ^ (h >>> 13), 3266489909)
        return (h ^= h >>> 16) >>> 0
    }
}

export function mulberry32(seed: number): Rng {
    return () => {
        let t = seed += 0x6D2B79F5
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function rngFrom(seed: string): Rng {
    return mulberry32(xmur3(String(seed))())
}

export function pick<T>(items: readonly T[], rng: Rng): T {
    if (items.length === 0) throw new Error('Cannot pick from an empty list')
    return items[Math.floor(rng() * items.length)]!
}

export function chance(probability: number, rng: Rng): boolean {
    return rng() < probability
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export function clamp01(value: number): number {
    return clamp(value, 0, 1)
}

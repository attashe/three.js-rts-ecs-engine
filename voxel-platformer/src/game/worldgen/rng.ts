export function hash32(...parts: readonly unknown[]): number {
    const s = parts.map((part) => typeof part === 'string' ? part : stableJson(part)).join('/')
    let h = 2166136261 >>> 0
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619) >>> 0
    }
    h ^= h >>> 16
    h = Math.imul(h, 2246822507) >>> 0
    h ^= h >>> 13
    h = Math.imul(h, 3266489909) >>> 0
    h ^= h >>> 16
    return h >>> 0
}

export function hashHex(value: unknown): string {
    return hash32(value).toString(16).padStart(8, '0')
}

export function rand01(...parts: readonly unknown[]): number {
    return hash32(...parts) / 4294967296
}

export function randInt(lo: number, hi: number, ...parts: readonly unknown[]): number {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) throw new Error('randInt invalid range')
    const a = Math.ceil(lo)
    const b = Math.floor(hi)
    if (a > b) throw new Error('randInt empty integer range')
    return a + (hash32(...parts) % (b - a + 1))
}

export function stableJson(value: unknown): string {
    return stableJsonInner(value, new Set())
}

function stableJsonInner(value: unknown, seen: Set<object>): string {
    if (value === null) return 'null'
    if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return 'null'
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJsonInner(item, seen)).join(',')}]`
    }
    if (typeof value === 'object') {
        if (seen.has(value)) throw new Error('stableJson cannot serialize cyclic values')
        seen.add(value)
        const entries = Object.keys(value as Record<string, unknown>)
            .sort()
            .filter((key) => {
                const item = (value as Record<string, unknown>)[key]
                return typeof item !== 'undefined' && typeof item !== 'function' && typeof item !== 'symbol'
            })
            .map((key) => `${JSON.stringify(key)}:${stableJsonInner((value as Record<string, unknown>)[key], seen)}`)
        seen.delete(value)
        return `{${entries.join(',')}}`
    }
    return 'null'
}

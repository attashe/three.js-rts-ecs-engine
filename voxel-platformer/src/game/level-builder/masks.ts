export interface TerrainPoint {
    x: number
    z: number
}

export type TerrainMask = (x: number, z: number) => boolean
export type TerrainValue = (x: number, z: number) => number
export type MaskSpan = readonly [number, number]

export interface FbmNoiseOptions {
    seed: number
    frequency?: number
    octaves?: number
    lacunarity?: number
    gain?: number
}

export function circle(center: TerrainPoint, radius: number): TerrainMask {
    const r2 = radius * radius
    return (x, z) => {
        const dx = x - center.x
        const dz = z - center.z
        return dx * dx + dz * dz <= r2
    }
}

export function ellipse(center: TerrainPoint, radiusX: number, radiusZ: number): TerrainMask {
    const invX = 1 / Math.max(0.0001, radiusX)
    const invZ = 1 / Math.max(0.0001, radiusZ)
    return (x, z) => {
        const dx = (x - center.x) * invX
        const dz = (z - center.z) * invZ
        return dx * dx + dz * dz <= 1
    }
}

export function rect(x: MaskSpan, z: MaskSpan): TerrainMask {
    const [x0, x1] = order(x)
    const [z0, z1] = order(z)
    return (xx, zz) => xx >= x0 && xx <= x1 && zz >= z0 && zz <= z1
}

export function pathMask(points: readonly TerrainPoint[], width: number): TerrainMask {
    const half = Math.max(0, width) / 2
    if (points.length === 0) return () => false
    if (points.length === 1) return circle(points[0]!, half)
    return (x, z) => {
        for (let i = 0; i < points.length - 1; i += 1) {
            if (distanceToSegment(x, z, points[i]!, points[i + 1]!) <= half) return true
        }
        return false
    }
}

export function anyMask(...masks: readonly TerrainMask[]): TerrainMask {
    return (x, z) => masks.some((mask) => mask(x, z))
}

export function allMask(...masks: readonly TerrainMask[]): TerrainMask {
    return (x, z) => masks.every((mask) => mask(x, z))
}

export function notMask(mask: TerrainMask): TerrainMask {
    return (x, z) => !mask(x, z)
}

export function subtractMask(base: TerrainMask, ...cutters: readonly TerrainMask[]): TerrainMask {
    return (x, z) => base(x, z) && cutters.every((mask) => !mask(x, z))
}

export function valueNoise2D(seed: number, frequency = 1): TerrainValue {
    const f = Math.max(0.000001, frequency)
    const s = seed | 0
    return (x, z) => {
        const fx = x * f
        const fz = z * f
        const x0 = Math.floor(fx)
        const z0 = Math.floor(fz)
        const tx = smooth(fx - x0)
        const tz = smooth(fz - z0)
        const a = hash01(x0, z0, s)
        const b = hash01(x0 + 1, z0, s)
        const c = hash01(x0, z0 + 1, s)
        const d = hash01(x0 + 1, z0 + 1, s)
        return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
    }
}

export function fbmNoise2D(opts: FbmNoiseOptions): TerrainValue {
    const octaves = Math.max(1, Math.floor(opts.octaves ?? 4))
    const lacunarity = opts.lacunarity ?? 2
    const gain = opts.gain ?? 0.5
    const layers = Array.from({ length: octaves }, (_, i) => valueNoise2D((opts.seed | 0) + i * 1013, (opts.frequency ?? 0.08) * Math.pow(lacunarity, i)))
    const weights = Array.from({ length: octaves }, (_, i) => Math.pow(gain, i))
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0)
    return (x, z) => {
        let value = 0
        for (let i = 0; i < layers.length; i += 1) value += layers[i]!(x, z) * weights[i]!
        return value / weightSum
    }
}

export function noiseThreshold(noise: TerrainValue, threshold: number): TerrainMask {
    return (x, z) => noise(x, z) >= threshold
}

function distanceToSegment(x: number, z: number, a: TerrainPoint, b: TerrainPoint): number {
    const vx = b.x - a.x
    const vz = b.z - a.z
    const len2 = vx * vx + vz * vz
    if (len2 <= 0.000001) {
        const dx = x - a.x
        const dz = z - a.z
        return Math.sqrt(dx * dx + dz * dz)
    }
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / len2))
    const px = a.x + vx * t
    const pz = a.z + vz * t
    const dx = x - px
    const dz = z - pz
    return Math.sqrt(dx * dx + dz * dz)
}

function order(span: MaskSpan): [number, number] {
    return span[0] <= span[1] ? [span[0], span[1]] : [span[1], span[0]]
}

function smooth(t: number): number {
    return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

function hash01(x: number, z: number, seed: number): number {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    h = (h ^ (h >>> 16)) >>> 0
    return h / 0xffffffff
}

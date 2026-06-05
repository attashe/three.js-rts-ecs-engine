import type { WorldgenCompileContext } from './compile-context'
import { clamp, lerp } from './compile-context'
import type { Vec3Tuple } from './spec-types'
import type { Bounds3 } from './underground-types'

export function boundsAround(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): Bounds3 {
    return { minX: Math.floor(cx - rx), maxX: Math.ceil(cx + rx), minY: Math.floor(cy - ry), maxY: Math.ceil(cy + ry), minZ: Math.floor(cz - rz), maxZ: Math.ceil(cz + rz) }
}

export function mergeBounds(a: Bounds3 | null, b: Bounds3): Bounds3 {
    return a
        ? { minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minY: Math.min(a.minY, b.minY), maxY: Math.max(a.maxY, b.maxY), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) }
        : { ...b }
}

export function boundsForSpline(points: readonly Vec3Tuple[], xzPad: number, yPad: number): Bounds3 {
    return {
        minX: Math.floor(Math.min(...points.map((p) => p[0])) - xzPad),
        maxX: Math.ceil(Math.max(...points.map((p) => p[0])) + xzPad),
        minY: Math.floor(Math.min(...points.map((p) => p[1])) - yPad),
        maxY: Math.ceil(Math.max(...points.map((p) => p[1])) + yPad),
        minZ: Math.floor(Math.min(...points.map((p) => p[2])) - xzPad),
        maxZ: Math.ceil(Math.max(...points.map((p) => p[2])) + xzPad),
    }
}

export function pointOnSpline3(points: readonly Vec3Tuple[], targetT: number): Vec3Tuple {
    const lengths: number[] = []
    let total = 0
    for (let i = 0; i < points.length - 1; i += 1) {
        const length = distance3(points[i]!, points[i + 1]!)
        lengths.push(length)
        total += length
    }
    let distance = clamp(targetT, 0, 1) * total
    for (let i = 0; i < lengths.length; i += 1) {
        const length = lengths[i]!
        if (distance <= length || i === lengths.length - 1) {
            const t = length === 0 ? 0 : distance / length
            const a = points[i]!
            const b = points[i + 1]!
            return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
        }
        distance -= length
    }
    return points[points.length - 1]!
}

export function splineTangentXZ(points: readonly Vec3Tuple[], t: number): { x: number; z: number } {
    const a = pointOnSpline3(points, Math.max(0, t - 0.01))
    const b = pointOnSpline3(points, Math.min(1, t + 0.01))
    return { x: b[0] - a[0], z: b[2] - a[2] }
}

export function closestSplinePointXZ(points: readonly Vec3Tuple[], x: number, z: number): { dist: number; y: number; globalT: number } {
    let best = { dist: Number.POSITIVE_INFINITY, y: points[0]?.[1] ?? 0, globalT: 0 }
    const lengths: number[] = []
    let total = 0
    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i]!
        const b = points[i + 1]!
        const length = Math.hypot(b[0] - a[0], b[2] - a[2])
        lengths.push(length)
        total += length
    }
    let before = 0
    for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i]!
        const b = points[i + 1]!
        const dx = b[0] - a[0]
        const dz = b[2] - a[2]
        const denom = dx * dx + dz * dz || 1
        const t = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / denom, 0, 1)
        const cx = a[0] + dx * t
        const cz = a[2] + dz * t
        const dist = Math.hypot(x - cx, z - cz)
        const globalT = total === 0 ? 0 : (before + lengths[i]! * t) / total
        if (dist < best.dist) best = { dist, y: lerp(a[1], b[1], t), globalT }
        before += lengths[i]!
    }
    return best
}

export function signedNoise(ctx: WorldgenCompileContext, id: string, x: number, y: number, z: number, scale: number): number {
    return ctx.rand01(id, Math.floor(x / scale), Math.floor(y / scale), Math.floor(z / scale)) * 2 - 1
}

export function signedNoise2(ctx: WorldgenCompileContext, id: string, x: number, z: number, scale: number): number {
    return ctx.rand01(id, Math.floor(x / scale), Math.floor(z / scale)) * 2 - 1
}

export function distance3(a: readonly number[], b: readonly number[]): number {
    return Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0))
}

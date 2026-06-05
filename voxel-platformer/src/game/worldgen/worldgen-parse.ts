import { clamp, type WorldgenCompileContext } from './compile-context'
import type { Vec2Tuple, Vec3Tuple } from './spec-types'

export function readVec2(ctx: WorldgenCompileContext, value: unknown, path: string): Vec2Tuple | null {
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, z] tuple.`, path, details: { value } })
    return null
}

export function readVec3(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple | null {
    if (Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number, value[2] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, y, z] tuple.`, path, details: { value } })
    return null
}

export function readNumberRange(ctx: WorldgenCompileContext, value: unknown, path: string, fallback: [number, number]): [number, number] | null {
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number]
    }
    if (typeof value === 'number' && Number.isFinite(value)) return [value, value]
    if (value === undefined) return fallback
    ctx.error({ code: 'invalid_feature', message: `${path} must be a number or [min, max] tuple.`, path, details: { value } })
    return null
}

export function readYRange(ctx: WorldgenCompileContext, value: unknown, path: string, fallbackMin: number, fallbackMax: number): { min: number; max: number } {
    if (typeof value === 'string') {
        const parts = value.split('..').map((part) => Number(part.trim()))
        if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
            return clampYRange(ctx, parts[0]!, parts[1]!)
        }
    }
    const range = readNumberRange(ctx, value, path, [fallbackMin, fallbackMax])
    return range ? clampYRange(ctx, range[0], range[1]) : { min: fallbackMin, max: fallbackMax }
}

export function readPointList3(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple[] {
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: `${path} must be an array of [x, y, z] tuples.`, path, details: { value } })
        return []
    }
    const out: Vec3Tuple[] = []
    for (let i = 0; i < value.length; i += 1) {
        const point = readVec3(ctx, value[i], `${path}[${i}]`)
        if (point) out.push(point)
    }
    return out
}

export function readCorridors(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple[][] {
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: `${path} must be an array of point arrays.`, path, details: { value } })
        return []
    }
    const out: Vec3Tuple[][] = []
    for (let i = 0; i < value.length; i += 1) {
        const corridor = readPointList3(ctx, value[i], `${path}[${i}]`)
        if (corridor.length >= 2) out.push(corridor)
    }
    return out
}

function clampYRange(ctx: WorldgenCompileContext, a: number, b: number): { min: number; max: number } {
    return { min: clamp(Math.round(Math.min(a, b)), 0, ctx.sizeY - 1), max: clamp(Math.round(Math.max(a, b)), 0, ctx.sizeY - 1) }
}

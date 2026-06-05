import type { WorldgenCompileContext } from './compile-context'
import { readYRange } from './worldgen-parse'

interface UndergroundFillRange {
    min: number
    max: number
}

export function fillUnderground(ctx: WorldgenCompileContext): void {
    const volume = ctx.spec.volume ?? {}
    const initial = typeof volume.initial === 'string' ? volume.initial : 'solid'
    if (initial !== 'solid') {
        ctx.error({
            code: 'unsupported_feature',
            message: `Unsupported underground volume.initial "${initial}".`,
            path: '$.volume.initial',
            details: { initial },
        })
    }
    const block = ctx.material(volume.default_material, 'stone2', '$.volume.default_material')
    const range = undergroundFillRange(ctx)
    for (let y = range.min; y <= range.max; y += 1) {
        for (let z = 0; z < ctx.sizeZ; z += 1) {
            for (let x = 0; x < ctx.sizeX; x += 1) ctx.setVoxel(x, y, z, block)
        }
    }
}

export function applyStrata(ctx: WorldgenCompileContext): void {
    const strata = ctx.spec.volume?.strata ?? []
    const fillRange = undergroundFillRange(ctx)
    for (let i = 0; i < strata.length; i += 1) {
        const layer = strata[i]!
        const path = `$.volume.strata[${i}]`
        const range = readYRange(ctx, layer.y, `${path}.y`, 0, ctx.sizeY - 1)
        const minY = Math.max(range.min, fillRange.min)
        const maxY = Math.min(range.max, fillRange.max)
        if (minY > maxY) continue
        const block = ctx.material(layer.material, 'stone2', `${path}.material`)
        for (let y = minY; y <= maxY; y += 1) {
            for (let z = 0; z < ctx.sizeZ; z += 1) {
                for (let x = 0; x < ctx.sizeX; x += 1) ctx.setVoxel(x, y, z, block)
            }
        }
    }
}

export function undergroundFillRange(ctx: WorldgenCompileContext): UndergroundFillRange {
    return readYRange(ctx, ctx.spec.volume?.y_range, '$.volume.y_range', 0, ctx.sizeY - 1)
}

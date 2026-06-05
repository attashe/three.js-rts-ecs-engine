import { BLOCK } from '../../engine/voxel/palette'
import { clamp, type WorldgenCompileContext } from './compile-context'
import { coordKey, keyToCoord } from './underground-stamping'
import type { UndergroundState } from './underground-types'
import { undergroundFillRange } from './underground-volume'
import { isRecord } from './worldgen-util'

interface PruneOptions {
    mode: string
    horizontalMargin: number
    verticalMargin: number
    materials: Set<number> | null
    features: Set<string> | null
}

export function pruneUndergroundFiller(ctx: WorldgenCompileContext, state: UndergroundState): void {
    const options = readPruneOptions(ctx)
    if (!options) return
    if (options.mode !== 'feature_shell') {
        ctx.error({
            code: 'unsupported_feature',
            message: `Unsupported underground prune mode "${options.mode}".`,
            path: '$.volume.prune.mode',
            details: { mode: options.mode },
        })
        return
    }

    const keep = buildFeatureShell(ctx, state, options)
    const removable = options.materials ?? defaultPrunableMaterials(ctx)
    const fillRange = undergroundFillRange(ctx)
    let removedVoxels = 0

    for (let y = fillRange.min; y <= fillRange.max; y += 1) {
        for (let z = 0; z < ctx.sizeZ; z += 1) {
            for (let x = 0; x < ctx.sizeX; x += 1) {
                const block = ctx.chunks.getVoxel(x, y, z)
                if (block === BLOCK.air || !removable.has(block)) continue
                if (keep.has(coordKey(x, y, z))) continue
                ctx.setVoxel(x, y, z, BLOCK.air)
                removedVoxels++
            }
        }
    }

    const removedChunks = ctx.chunks.pruneEmptyChunks()
    ctx.report.placements.push({
        id: 'volume.prune',
        kind: 'underground_prune',
        mode: options.mode,
        horizontalMargin: options.horizontalMargin,
        verticalMargin: options.verticalMargin,
        keptShellVoxels: keep.size,
        removedVoxels,
        removedChunks,
    })
}

function readPruneOptions(ctx: WorldgenCompileContext): PruneOptions | null {
    const source = ctx.spec.volume?.prune
    if (source === undefined || source === false) return null
    const mode = typeof source === 'string'
        ? source.trim()
        : isRecord(source) && typeof source.mode === 'string'
            ? source.mode.trim()
            : 'feature_shell'
    const horizontalMargin = isRecord(source)
        ? Math.max(1, Math.floor(ctx.number(source.horizontal_margin, 4, '$.volume.prune.horizontal_margin', { min: 1 })))
        : 4
    const verticalMargin = isRecord(source)
        ? Math.max(1, Math.floor(ctx.number(source.vertical_margin, 4, '$.volume.prune.vertical_margin', { min: 1 })))
        : 4
    const materials = isRecord(source) && source.materials !== undefined
        ? readMaterialFilter(ctx, source.materials)
        : null
    const features = isRecord(source) && source.features !== undefined
        ? readFeatureFilter(ctx, source.features)
        : null
    return { mode: mode || 'feature_shell', horizontalMargin, verticalMargin, materials, features }
}

function buildFeatureShell(ctx: WorldgenCompileContext, state: UndergroundState, options: PruneOptions): Set<string> {
    const keep = new Set<string>()
    for (const feature of state.features.values()) {
        if (options.features && !options.features.has(feature.id)) continue
        for (const key of feature.cells) addShellAround(key, ctx, keep, options)
        for (const key of feature.floor) addShellAround(key, ctx, keep, options)
    }
    return keep
}

function addShellAround(key: string, ctx: WorldgenCompileContext, keep: Set<string>, options: PruneOptions): void {
    const [cx, cy, cz] = keyToCoord(key)
    const minY = clamp(cy - options.verticalMargin, 0, ctx.sizeY - 1)
    const maxY = clamp(cy + options.verticalMargin, 0, ctx.sizeY - 1)
    for (let y = minY; y <= maxY; y += 1) {
        for (let dz = -options.horizontalMargin; dz <= options.horizontalMargin; dz += 1) {
            for (let dx = -options.horizontalMargin; dx <= options.horizontalMargin; dx += 1) {
                if (Math.hypot(dx, dz) > options.horizontalMargin + 0.25) continue
                const x = cx + dx
                const z = cz + dz
                if (ctx.inXZ(x, z)) keep.add(coordKey(x, y, z))
            }
        }
    }
}

function defaultPrunableMaterials(ctx: WorldgenCompileContext): Set<number> {
    const out = new Set<number>()
    const volume = ctx.spec.volume ?? {}
    out.add(ctx.material(volume.default_material, 'stone2', '$.volume.default_material'))
    const strata = volume.strata ?? []
    for (let i = 0; i < strata.length; i += 1) {
        out.add(ctx.material(strata[i]!.material, 'stone2', `$.volume.strata[${i}].material`))
    }
    return out
}

function readMaterialFilter(ctx: WorldgenCompileContext, value: unknown): Set<number> {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
        ctx.error({
            code: 'invalid_feature',
            message: '$.volume.prune.materials must be an array of material ids.',
            path: '$.volume.prune.materials',
            details: { value },
        })
        return new Set()
    }
    return new Set(value.map((entry, index) => ctx.material(entry, 'stone2', `$.volume.prune.materials[${index}]`)))
}

function readFeatureFilter(ctx: WorldgenCompileContext, value: unknown): Set<string> {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
        ctx.error({
            code: 'invalid_feature',
            message: '$.volume.prune.features must be an array of feature ids.',
            path: '$.volume.prune.features',
            details: { value },
        })
        return new Set()
    }
    return new Set(value.map((entry) => entry.trim()))
}

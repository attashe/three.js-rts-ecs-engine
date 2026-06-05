import { BLOCK } from '../../engine/voxel/palette'
import { clamp, type WorldgenCompileContext } from './compile-context'
import type { UndergroundState } from './underground-types'
import { keyToCoord } from './underground-stamping'
import { isRecord } from './worldgen-util'

interface CutawayOptions {
    mode: string
    clearance: number
    shellMargin: number
    rimHeight: number
    rimMaterial: number
    features: Set<string> | null
}

interface CutawayColumn {
    x: number
    z: number
    floorY: number
    distanceSq: number
    floorColumn: boolean
}

export function applyUndergroundCutaway(ctx: WorldgenCompileContext, state: UndergroundState): void {
    const options = readCutawayOptions(ctx)
    if (!options) return
    if (options.mode !== 'open_top') {
        ctx.error({
            code: 'unsupported_feature',
            message: `Unsupported underground cutaway mode "${options.mode}".`,
            path: '$.volume.cutaway.mode',
            details: { mode: options.mode },
        })
        return
    }

    const columns = collectCutawayColumns(ctx, state, options)
    let clearedVoxels = 0
    let rimVoxels = 0
    const exposedColumns = new Set<string>()
    for (const column of columns.values()) {
        exposedColumns.add(`${column.x},${column.z}`)
        if (column.floorColumn) {
            clearedVoxels += clearRoofColumn(ctx, column.x, column.floorY, column.z, options.clearance)
        } else {
            rimVoxels += normalizeRimColumn(ctx, column.x, column.floorY, column.z, options)
            clearedVoxels += clearRoofColumn(ctx, column.x, column.floorY, column.z, options.rimHeight + 1)
        }
    }

    ctx.report.placements.push({
        id: 'volume.cutaway',
        kind: 'underground_cutaway',
        mode: options.mode,
        clearance: options.clearance,
        shellMargin: options.shellMargin,
        rimHeight: options.rimHeight,
        exposedColumns: exposedColumns.size,
        clearedVoxels,
        rimVoxels,
    })
}

function collectCutawayColumns(ctx: WorldgenCompileContext, state: UndergroundState, options: CutawayOptions): Map<string, CutawayColumn> {
    const columns = new Map<string, CutawayColumn>()
    const floorColumns = new Set<string>()
    for (const feature of state.features.values()) {
        if (options.features && !options.features.has(feature.id)) continue
        for (const key of feature.floor) {
            const [x, floorY, z] = keyToCoord(key)
            floorColumns.add(columnKey(x, z))
            for (let dz = -options.shellMargin; dz <= options.shellMargin; dz += 1) {
                for (let dx = -options.shellMargin; dx <= options.shellMargin; dx += 1) {
                    const distance = Math.hypot(dx, dz)
                    if (distance > options.shellMargin + 0.25) continue
                    rememberColumn(ctx, columns, x + dx, z + dz, floorY, distance * distance)
                }
            }
        }
    }
    for (const key of floorColumns) {
        const column = columns.get(key)
        if (column) column.floorColumn = true
    }
    return columns
}

function rememberColumn(
    ctx: WorldgenCompileContext,
    columns: Map<string, CutawayColumn>,
    x: number,
    z: number,
    floorY: number,
    distanceSq: number,
): void {
    if (!ctx.inXZ(x, z)) return
    const key = columnKey(x, z)
    const current = columns.get(key)
    if (
        !current ||
        distanceSq < current.distanceSq ||
        (distanceSq === current.distanceSq && floorY > current.floorY)
    ) {
        columns.set(key, { x, z, floorY, distanceSq, floorColumn: false })
    }
}

function readCutawayOptions(ctx: WorldgenCompileContext): CutawayOptions | null {
    const source = ctx.spec.volume?.cutaway
    if (source === undefined || source === false) return null
    const objectSource = isRecord(source) ? source : {}
    const mode = typeof source === 'string'
        ? source.trim()
        : typeof objectSource.mode === 'string'
            ? objectSource.mode.trim()
            : 'open_top'
    const clearance = isRecord(source)
        ? Math.max(2, Math.floor(ctx.number(objectSource.clearance, 6, '$.volume.cutaway.clearance', { min: 2 })))
        : 6
    // `shell_margin` is the horizontal exposure radius around floor cells;
    // `wall_margin`/`horizontal_margin` are accepted as aliases for it.
    const shellMargin = isRecord(source)
        ? Math.max(0, Math.floor(ctx.number(
            objectSource.shell_margin ?? objectSource.wall_margin ?? objectSource.horizontal_margin,
            defaultShellMargin(ctx),
            '$.volume.cutaway.shell_margin',
            { min: 0 },
        )))
        : defaultShellMargin(ctx)
    const rimFallback = Math.max(1, Math.min(2, clearance - 2))
    const rimHeight = isRecord(source)
        ? Math.max(0, Math.floor(ctx.number(objectSource.rim_height ?? objectSource.wall_height, rimFallback, '$.volume.cutaway.rim_height', { min: 0 })))
        : rimFallback
    const rimMaterialName = isRecord(source) ? objectSource.rim_material ?? ctx.spec.volume?.default_material : ctx.spec.volume?.default_material
    const rimMaterial = ctx.material(rimMaterialName, 'stone2', '$.volume.cutaway.rim_material')
    const features = isRecord(source) && objectSource.features !== undefined
        ? readFeatureFilter(ctx, objectSource.features)
        : null
    return { mode: mode || 'open_top', clearance, shellMargin, rimHeight, rimMaterial, features }
}

function readFeatureFilter(ctx: WorldgenCompileContext, value: unknown): Set<string> {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)) {
        ctx.error({
            code: 'invalid_feature',
            message: '$.volume.cutaway.features must be an array of feature ids.',
            path: '$.volume.cutaway.features',
            details: { value },
        })
        return new Set()
    }
    return new Set(value.map((entry) => entry.trim()))
}

function clearRoofColumn(ctx: WorldgenCompileContext, x: number, floorY: number, z: number, clearance: number): number {
    if (!ctx.inXZ(x, z)) return 0
    let cleared = 0
    const startY = cutawayStartY(ctx, floorY, clearance)
    for (let y = startY; y < ctx.sizeY; y += 1) {
        if (ctx.chunks.getVoxel(x, y, z) === BLOCK.air) continue
        ctx.setVoxel(x, y, z, BLOCK.air)
        cleared += 1
    }
    return cleared
}

function normalizeRimColumn(ctx: WorldgenCompileContext, x: number, floorY: number, z: number, options: CutawayOptions): number {
    if (options.rimHeight <= 0) return 0
    const minY = clamp(Math.round(floorY), 0, ctx.sizeY - 1)
    const maxY = clamp(Math.round(floorY + options.rimHeight), 0, ctx.sizeY - 1)
    let filled = 0
    for (let y = minY; y <= maxY; y += 1) {
        if (ctx.chunks.getVoxel(x, y, z) !== BLOCK.air) continue
        ctx.setVoxel(x, y, z, options.rimMaterial)
        filled += 1
    }
    return filled
}

function cutawayStartY(ctx: WorldgenCompileContext, floorY: number, clearance: number): number {
    return clamp(Math.round(floorY + clearance), 0, ctx.sizeY)
}

/** When the cutaway has no explicit shell margin, match the prune shell so the
 *  exposed rim and the pruned terrain line up. Falls back to 1 (just the floor
 *  cells plus one ring) when there is no feature-shell prune. */
function defaultShellMargin(ctx: WorldgenCompileContext): number {
    const prune = ctx.spec.volume?.prune
    if (prune === undefined || prune === false) return 1
    if (typeof prune === 'string') return prune.trim().length > 0 ? 4 : 1
    if (!isRecord(prune)) return 1
    const mode = typeof prune.mode === 'string' ? prune.mode.trim() : 'feature_shell'
    if (mode !== 'feature_shell') return 1
    return typeof prune.horizontal_margin === 'number' && Number.isFinite(prune.horizontal_margin)
        ? Math.max(1, Math.floor(prune.horizontal_margin))
        : 4
}

function columnKey(x: number, z: number): string {
    return `${x},${z}`
}

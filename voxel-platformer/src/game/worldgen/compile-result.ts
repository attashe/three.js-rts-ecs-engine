import { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { LevelMeta } from '../level'
import { defineLevel } from '../level-builder'
import { DEFAULT_PALETTE } from '../../engine/voxel/palette'
import { WorldgenCompileContext } from './compile-context'
import { finalizeWorldgenReport, setWorldgenMetricCounts } from './report'
import { collectWorldgenChunkMetrics } from './region-metrics'
import { hash32, stableJson } from './rng'
import type { NormalizedWorldSpec, WorldgenCompileOptions, WorldgenCompileResult } from './spec-types'

const RESIDENT_WORLD_CHUNK_BUDGET = 96
const RESIDENT_WORLD_VOXEL_BUDGET = 1_500_000
const RESIDENT_WORLD_REGION_BUDGET = 4

export function finishWorldgenCompile(ctx: WorldgenCompileContext, meta: LevelMeta): WorldgenCompileResult {
    ctx.report.worldHash = hashWorldOutput(ctx.chunks, meta)
    const chunkMetrics = collectWorldgenChunkMetrics(ctx.chunks)
    setWorldgenMetricCounts(ctx.report, {
        size: ctx.spec.world.size,
        ...chunkMetrics,
        anchorCount: ctx.spec.anchors?.length ?? 0,
        terrainFeatureCount: ctx.spec.terrain?.features?.length ?? 0,
        carverCount: ctx.spec.carvers?.length ?? 0,
        connectorCount: ctx.spec.connectors?.length ?? 0,
        pathCount: (ctx.spec.paths?.length ?? 0) + (ctx.spec.main_paths?.length ?? 0),
        structureCount: ctx.spec.structures?.length ?? 0,
        scatterRuleCount: ctx.spec.scatter?.length ?? 0,
        validationRuleCount: ctx.spec.validation?.require_paths?.length ?? 0,
        npcCount: meta.npcs.length,
        zoneCount: meta.zones.length,
        scriptCount: meta.scripts.length,
    })
    warnIfResidentBudgetExceeded(ctx)
    finalizeWorldgenReport(ctx.report)
    return { chunks: ctx.chunks, meta, report: ctx.report }
}

export function emptyWorldgenMeta(spec: NormalizedWorldSpec): LevelMeta {
    const sizeX = spec.world.size[0] ?? 1
    const sizeZ = spec.world.size[2] ?? 1
    return defineLevel({
        name: spec.world.name,
        size: Math.max(sizeX, sizeZ),
        sizeX,
        sizeZ,
        spawn: { x: 0.5, y: 1, z: 0.5 },
        zones: [],
        props: [],
    })
}

export function invalidWorldgenMeta(name = 'Invalid WorldSpec'): LevelMeta {
    return defineLevel({
        name,
        size: 1,
        spawn: { x: 0.5, y: 1, z: 0.5 },
        zones: [],
        props: [],
    })
}

export function worldgenChunks(opts: WorldgenCompileOptions = {}): ChunkManager {
    return opts.chunks ?? new ChunkManager(DEFAULT_PALETTE)
}

export function shouldStopWorldgen(ctx: WorldgenCompileContext, opts: WorldgenCompileOptions): boolean {
    return opts.failFast === true && ctx.report.errors.length > 0
}

function hashWorldOutput(chunks: ChunkManager, meta: unknown): string {
    let h = hash32('worldgen-output', stableJson(meta))
    const sorted = [...chunks.allChunks()].sort((a, b) => a.cx - b.cx || a.cy - b.cy || a.cz - b.cz)
    for (const chunk of sorted) {
        h = mixHash(h, chunk.cx)
        h = mixHash(h, chunk.cy)
        h = mixHash(h, chunk.cz)
        for (let i = 0; i < chunk.data.length; i += 1) h = mixHash(h, chunk.data[i]!)
    }
    return h.toString(16).padStart(8, '0')
}

function warnIfResidentBudgetExceeded(ctx: WorldgenCompileContext): void {
    const metrics = ctx.report.metrics
    const exceeded: { metric: string; value: number; limit: number }[] = []
    if (metrics.chunkCount > RESIDENT_WORLD_CHUNK_BUDGET) {
        exceeded.push({ metric: 'chunkCount', value: metrics.chunkCount, limit: RESIDENT_WORLD_CHUNK_BUDGET })
    }
    if (metrics.writtenVoxels > RESIDENT_WORLD_VOXEL_BUDGET) {
        exceeded.push({ metric: 'writtenVoxels', value: metrics.writtenVoxels, limit: RESIDENT_WORLD_VOXEL_BUDGET })
    }
    if (metrics.regionCount > RESIDENT_WORLD_REGION_BUDGET) {
        exceeded.push({ metric: 'regionCount', value: metrics.regionCount, limit: RESIDENT_WORLD_REGION_BUDGET })
    }
    if (exceeded.length === 0) return
    ctx.warning({
        code: 'resident_world_budget',
        message: 'Generated world exceeds the comfortable resident-load budget; compile output is still usable, but future work should split or stream this footprint.',
        path: '$',
        details: {
            exceeded,
            regionSizeChunks: metrics.regionSizeChunks,
        },
    })
}

function mixHash(current: number, value: number): number {
    let h = current >>> 0
    h ^= value & 0xffff
    h = Math.imul(h, 16777619) >>> 0
    h ^= value >>> 16
    h = Math.imul(h, 16777619) >>> 0
    return h >>> 0
}

import type {
    NormalizedWorldSpec,
    WorldgenCompileOptions,
    WorldgenCompileResult,
} from './spec-types'
import { createWorldgenReport } from './report'
import { hashHex, stableJson } from './rng'
import { WorldgenCompileContext } from './compile-context'
import { emptyWorldgenMeta, finishWorldgenCompile, shouldStopWorldgen, worldgenChunks } from './compile-result'
import { WorldgenLevelDraft } from './level-draft'
import { resolveContent } from './resolve-content'
import { validateRequiredPaths } from './validate'
import { createUndergroundState } from './underground-types'
import { fillUnderground, applyStrata } from './underground-volume'
import { applyCarvers, applyConnectors, applyMainPaths } from './underground-carvers'
import { applyUndergroundCutaway } from './underground-cutaway'
import { pruneUndergroundFiller } from './underground-prune'
import {
    findBestSurfaceNear,
    refreshAllFeatureSurfaces,
    undergroundFallbackSpawn,
    undergroundSpawn,
} from './underground-surfaces'
import { placeUndergroundStructures } from './underground-structures'
import { scatterUnderground } from './underground-scatter'

export function compileUndergroundWorld(
    spec: NormalizedWorldSpec,
    opts: WorldgenCompileOptions = {},
): WorldgenCompileResult {
    const report = createWorldgenReport(spec.world.id, hashHex(stableJson(spec)))
    const chunks = worldgenChunks(opts)
    const ctx = new WorldgenCompileContext(spec, report, chunks)
    const state = createUndergroundState()

    if (spec.world.type !== 'underground') {
        ctx.error({
            code: 'unsupported_world_type',
            message: `Phase 6 underground compiler only supports underground worlds, got "${spec.world.type}".`,
            path: '$.world.type',
            details: { type: spec.world.type },
        })
        return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    }

    ctx.chunks.withBulkEdit(() => {
        fillUnderground(ctx)
        applyStrata(ctx)
        applyCarvers(ctx, state)
        applyConnectors(ctx, state)
        applyMainPaths(ctx, state)
        applyUndergroundCutaway(ctx, state)
        pruneUndergroundFiller(ctx, state)
        refreshAllFeatureSurfaces(ctx, state)
    })
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))

    const draft = new WorldgenLevelDraft({
        name: spec.world.name,
        size: Math.max(ctx.sizeX, ctx.sizeZ),
        sizeX: ctx.sizeX,
        sizeZ: ctx.sizeZ,
        spawn: undergroundFallbackSpawn(ctx, state),
    })

    placeUndergroundStructures(ctx, state, draft)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    scatterUnderground(ctx, state)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    draft.spawn = undergroundSpawn(ctx, state)

    resolveContent(ctx, draft, {
        standYAtXZ: (x, z) => findBestSurfaceNear(ctx, state, x, z, { kind: 'floor', yRange: [1, ctx.sizeY - 2], searchRadius: 4 })?.y ?? 1,
    })
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
    validateRequiredPaths(ctx)
    if (shouldStopWorldgen(ctx, opts)) return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))

    return finishWorldgenCompile(ctx, draft.toMeta())
}

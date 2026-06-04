import { WorldgenCompileContext } from './compile-context'
import { emptyWorldgenMeta, finishWorldgenCompile, invalidWorldgenMeta, worldgenChunks } from './compile-result'
import { compileSurfaceWorld } from './compile-surface'
import { compileUndergroundWorld } from './compile-underground'
import { normalizeWorldSpec } from './normalize-spec'
import { createWorldgenReport } from './report'
import { hashHex, stableJson } from './rng'
import type { NormalizedWorldSpec, WorldSpec, WorldgenCompileOptions, WorldgenCompileResult } from './spec-types'

export function compileWorldSpec(
    spec: WorldSpec,
    opts: WorldgenCompileOptions = {},
): WorldgenCompileResult {
    const normalized = normalizeWorldSpec(spec)
    if (!normalized.ok) {
        return {
            chunks: worldgenChunks(opts),
            meta: invalidWorldgenMeta(),
            report: normalized.report,
        }
    }
    return compileNormalizedWorldSpec(normalized.spec, opts)
}

export function compileNormalizedWorldSpec(
    spec: NormalizedWorldSpec,
    opts: WorldgenCompileOptions = {},
): WorldgenCompileResult {
    switch (spec.world.type) {
        case 'surface':
            return compileSurfaceWorld(spec, opts)
        case 'underground':
            return compileUndergroundWorld(spec, opts)
        case 'hybrid':
            return unsupportedWorldType(spec, opts)
    }
}

function unsupportedWorldType(spec: NormalizedWorldSpec, opts: WorldgenCompileOptions): WorldgenCompileResult {
    const report = createWorldgenReport(spec.world.id, hashHex(stableJson(spec)))
    const ctx = new WorldgenCompileContext(spec, report, worldgenChunks(opts))
    ctx.error({
        code: 'unsupported_world_type',
        message: `Worldgen compiler does not support "${spec.world.type}" worlds yet.`,
        path: '$.world.type',
        details: { type: spec.world.type },
    })
    return finishWorldgenCompile(ctx, emptyWorldgenMeta(spec))
}

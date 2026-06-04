import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { compileWorldSpec } from './compile-world'
import type { VoxelCoord, WorldgenCompileResult, WorldgenReport } from './spec-types'

export function compileSurfaceLevelOrThrow(
    spec: unknown,
    chunks?: ChunkManager,
): WorldgenCompileResult {
    const result = compileWorldSpec(spec, { chunks })
    if (result.report.status === 'failed') {
        throw new Error(formatWorldgenDiagnostics('Worldgen surface compilation failed', result.report))
    }
    return result
}

export function requireResolvedAnchor(report: WorldgenReport, id: string): VoxelCoord {
    const anchor = report.resolvedAnchors[id]
    if (!anchor) throw new Error(`Worldgen anchor "${id}" was not resolved`)
    return { ...anchor }
}

export function formatWorldgenDiagnostics(prefix: string, report: WorldgenReport): string {
    const diagnostics = [...report.errors, ...report.warnings]
    if (diagnostics.length === 0) return `${prefix}.`
    const lines = diagnostics.map((d) => {
        const path = d.path ? ` at ${d.path}` : ''
        return `- ${d.code}${path}: ${d.message}`
    })
    return `${prefix}:\n${lines.join('\n')}`
}

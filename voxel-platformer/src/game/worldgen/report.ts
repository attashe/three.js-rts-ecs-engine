import type {
    Vec3Tuple,
    WorldgenDiagnostic,
    WorldgenError,
    WorldgenMetrics,
    WorldgenReport,
    WorldgenWarning,
} from './spec-types'
import { WORLDGEN_REGION_SIZE_CHUNKS } from './region-metrics'

export function createWorldgenReport(specId: string | undefined, specHash: string): WorldgenReport {
    return {
        specId,
        specHash,
        status: 'ok',
        warnings: [],
        errors: [],
        metrics: createEmptyMetrics(),
        resolvedAnchors: {},
        resolvedObjects: {},
        placements: [],
        validation: [],
    }
}

export function createEmptyMetrics(): WorldgenMetrics {
    return {
        chunkCount: 0,
        writtenVoxels: 0,
        regionSizeChunks: WORLDGEN_REGION_SIZE_CHUNKS,
        regionCount: 0,
        regions: [],
        anchorCount: 0,
        terrainFeatureCount: 0,
        carverCount: 0,
        connectorCount: 0,
        pathCount: 0,
        structureCount: 0,
        scatterRuleCount: 0,
        validationRuleCount: 0,
        npcCount: 0,
        zoneCount: 0,
        scriptCount: 0,
    }
}

export function addWorldgenWarning(report: WorldgenReport, warning: WorldgenDiagnostic): WorldgenWarning {
    report.warnings.push(warning)
    return warning
}

export function addWorldgenError(report: WorldgenReport, error: WorldgenDiagnostic): WorldgenError {
    report.errors.push(error)
    return error
}

export function finalizeWorldgenReport(report: WorldgenReport): WorldgenReport {
    report.status = report.errors.length > 0
        ? 'failed'
        : report.warnings.length > 0
            ? 'warning'
            : 'ok'
    return report
}

export function setWorldgenMetricCounts(
    report: WorldgenReport,
    counts: Partial<WorldgenMetrics> & { size?: Vec3Tuple },
): void {
    report.metrics = {
        ...report.metrics,
        ...counts,
    }
}

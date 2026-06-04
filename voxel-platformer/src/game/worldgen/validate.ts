import { findPath } from '../../engine/voxel/voxel-path'
import { WorldgenCompileContext } from './compile-context'
import type { VoxelCoord } from './spec-types'

export function validateRequiredPaths(ctx: WorldgenCompileContext): void {
    const rules = ctx.spec.validation?.require_paths ?? []
    for (let i = 0; i < rules.length; i += 1) {
        const rule = rules[i]!
        const path = `$.validation.require_paths[${i}]`
        const from = resolveValidationPoint(ctx, rule.from)
        const to = resolveValidationPoint(ctx, rule.to)
        const report = {
            rule: rule.id ?? `${rule.from}->${rule.to}`,
            ok: false,
            from: rule.from,
            to: rule.to,
            actor: rule.actor ?? 'player_basic',
        }
        if (!from || !to) {
            const diagnostic = {
                code: 'missing_reference',
                message: `Validation path "${report.rule}" references an unresolved anchor or object.`,
                path,
                details: { from: rule.from, to: rule.to },
            }
            if (rule.optional) ctx.warning(diagnostic)
            else ctx.error(diagnostic)
            ctx.report.validation.push(report)
            continue
        }
        const found = findPath(ctx.chunks, voxelPoint(from), voxelPoint(to), {
            maxStepUp: 1,
            maxDrop: 3,
            maxNodes: Math.max(4096, ctx.sizeX * ctx.sizeZ * 4),
            surfaceSearchRange: ctx.sizeY,
        })
        if (!found) {
            const diagnostic = {
                code: 'validation_failed',
                message: `Required path "${report.rule}" did not validate.`,
                path,
                details: { from, to },
            }
            if (rule.optional) ctx.warning(diagnostic)
            else ctx.error(diagnostic)
            ctx.report.validation.push(report)
            continue
        }
        ctx.report.validation.push({ ...report, ok: true, pathLength: found.length })
    }
}

function resolveValidationPoint(ctx: WorldgenCompileContext, id: string): VoxelCoord | null {
    return ctx.report.resolvedAnchors[id] ?? ctx.report.resolvedObjects[id] ?? null
}

function voxelPoint(point: VoxelCoord): { x: number; y: number; z: number } {
    return { x: Math.floor(point.x), y: Math.floor(point.y), z: Math.floor(point.z) }
}

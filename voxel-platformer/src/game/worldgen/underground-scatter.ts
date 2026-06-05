import { BLOCK } from '../../engine/voxel/palette'
import type { WorldgenCompileContext } from './compile-context'
import type { ScatterSpec } from './spec-types'
import type { SurfaceCandidate, UndergroundState } from './underground-types'
import { keyToCoord, setSolid } from './underground-stamping'
import { surfaceAt } from './underground-surfaces'
import { distance3 } from './worldgen-math'

export function scatterUnderground(ctx: WorldgenCompileContext, state: UndergroundState): void {
    const scatter = ctx.spec.scatter ?? []
    for (let i = 0; i < scatter.length; i += 1) {
        const spec = scatter[i]!
        const path = `$.scatter[${i}]`
        const count = Math.max(0, Math.floor(ctx.number(spec.count, 0, `${path}.count`, { min: 0 })))
        const asset = typeof spec.asset === 'string' ? spec.asset.trim() : ''
        if (!['proc.mushroom.glow_cluster', 'proc.crystal.wall_cluster', 'proc.stalactite', 'proc.ore.wall_cluster', 'proc.ore.floor_pile'].includes(asset)) {
            ctx.warning({ code: 'unsupported_structure_asset', message: `Unsupported underground scatter asset "${asset}".`, path: `${path}.asset`, details: { id: spec.id, asset } })
            ctx.report.placements.push({ id: spec.id, kind: 'scatter_summary', requested: count, placed: 0, surface: spec.surface ?? 'floor', feature: spec.feature ?? 'any' })
            continue
        }
        const candidates = undergroundScatterCandidates(ctx, state, spec)
        candidates.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y || a.z - b.z)
        const minDistance = ctx.number(spec.min_distance, 1, `${path}.min_distance`, { min: 0 })
        const used: SurfaceCandidate[] = []
        let placed = 0
        for (const candidate of candidates) {
            if (placed >= count) break
            if (used.some((other) => distance3([other.x, other.y, other.z], [candidate.x, candidate.y, candidate.z]) < minDistance)) continue
            if (asset === 'proc.mushroom.glow_cluster') {
                setSolid(ctx, candidate.x, candidate.y, candidate.z, BLOCK.mushroom)
                setSolid(ctx, candidate.x, candidate.y + 1, candidate.z, BLOCK.torch)
            } else if (asset === 'proc.crystal.wall_cluster') {
                setSolid(ctx, candidate.x, candidate.y, candidate.z, BLOCK.glow)
            } else if (asset === 'proc.ore.wall_cluster') {
                setSolid(ctx, candidate.x, candidate.y, candidate.z, oreBlockFor(ctx, spec.id, placed))
            } else if (asset === 'proc.ore.floor_pile') {
                setSolid(ctx, candidate.x, candidate.y - 1, candidate.z, oreBlockFor(ctx, spec.id, placed))
            } else {
                const maxLength = Math.max(2, Math.floor(ctx.number(spec.max_length, 7, `${path}.max_length`, { min: 2 })))
                const length = ctx.randInt(2, maxLength, spec.id, placed, 'length')
                for (let y = candidate.y; y > candidate.y - length; y -= 1) setSolid(ctx, candidate.x, y, candidate.z, BLOCK.stone2)
            }
            used.push(candidate)
            placed += 1
        }
        ctx.report.placements.push({ id: spec.id, kind: 'scatter_summary', requested: count, placed, surface: spec.surface ?? 'floor', feature: spec.feature ?? 'any' })
        if (placed < count) ctx.warning({ code: 'placement_failed', message: `Underground scatter "${spec.id}" placed ${placed} of ${count}.`, path, details: { requested: count, placed } })
    }
}

function oreBlockFor(ctx: WorldgenCompileContext, id: string, index: number): number {
    const roll = ctx.rand01(id, index, 'ore-kind')
    if (roll < 0.42) return BLOCK.oreIron
    if (roll < 0.78) return BLOCK.oreCopper
    return BLOCK.oreCrystal
}

function undergroundScatterCandidates(ctx: WorldgenCompileContext, state: UndergroundState, spec: ScatterSpec): SurfaceCandidate[] {
    const surfaceKind = typeof spec.surface === 'string' ? spec.surface : 'floor'
    const featureId = typeof spec.feature === 'string' ? spec.feature : ''
    const feature = featureId ? state.features.get(featureId) : null
    const out: SurfaceCandidate[] = []
    if (feature && (surfaceKind === 'floor' || surfaceKind === 'wall' || surfaceKind === 'ceiling')) {
        for (const key of feature[surfaceKind]) {
            const [x, y, z] = keyToCoord(key)
            out.push({ x, y, z, kind: surfaceKind, score: ctx.rand01(spec.id, x, y, z) })
        }
        return out
    }
    for (let z = 1; z < ctx.sizeZ - 1; z += 2) {
        for (let x = 1; x < ctx.sizeX - 1; x += 2) {
            for (let y = 1; y < ctx.sizeY - 2; y += 1) {
                const candidate = surfaceAt(ctx, x, y, z, surfaceKind, 2)
                if (candidate) out.push({ ...candidate, score: ctx.rand01(spec.id, x, y, z) })
            }
        }
    }
    return out
}

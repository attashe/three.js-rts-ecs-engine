import {
    getPrefab,
    prefabSource,
    proceduralSource,
    type StructureSource,
} from '../../procedural-structures'
import type {
    HouseStyle,
    PartialStructureGenerationOptions,
    StructureKind,
    TowerStyle,
    TreeStyle,
    WallStyle,
} from '../../procedural-structures/types'
import { WorldgenCompileContext } from './compile-context'
import { stableJson } from './rng'
import type { WorldgenDiagnostic } from './spec-types'

export type WorldgenAssetKind = 'portal' | 'house' | 'tree' | 'tower' | 'wall' | 'shop' | 'forge' | 'generic'

export interface ResolvedWorldgenAsset {
    id: string
    source: StructureSource
    structuralOnly: boolean
    kind: WorldgenAssetKind
    sourceKind: StructureSource['kind']
}

const HOUSE_STYLES = new Set<HouseStyle>(['mixed', 'cottage', 'timber', 'stone', 'workshop'])
const TREE_STYLES = new Set<TreeStyle>(['mixed', 'oak', 'pine', 'birch', 'willow', 'dead'])
const TOWER_STYLES = new Set<TowerStyle>(['mixed', 'round', 'square', 'lighthouse', 'ruined'])
const WALL_STYLES = new Set<WallStyle>(['curtain', 'stone', 'timber', 'ruined'])

export function resolveWorldgenAsset(
    ctx: WorldgenCompileContext,
    assetId: unknown,
    assetPath: string,
    ownerId: string,
    required: boolean,
    paramsValue?: unknown,
): ResolvedWorldgenAsset | null {
    if (typeof assetId !== 'string' || assetId.trim().length === 0) {
        return reportAssetProblem(ctx, required, {
            code: 'unsupported_structure_asset',
            message: `Structure "${ownerId}" must declare an asset id.`,
            path: assetPath,
            details: { id: ownerId, asset: assetId },
        })
    }

    const asset = assetId.trim()
    const params = readParams(ctx, paramsValue, assetPath.replace(/\.asset$/, '.params'), required)
    if (paramsValue !== undefined && !params) return null

    if (asset === 'fixed.portal.blue_stone' || asset === 'prefab.portal-gate') {
        return resolved(asset, prefabSource('portal-gate'), false, 'portal')
    }

    if (asset === 'proc.house.hermit_cottage') {
        return resolved(
            asset,
            proceduralSource('house', assetSeed(ctx, ownerId, asset, params), mergeProceduralParams({
                house: {
                    scale: 'folk',
                    style: 'cottage',
                    width: 7,
                    depth: 6,
                    floors: 1,
                    floorHeight: 3,
                    roofStyle: 'gable',
                    sideWing: false,
                    porch: true,
                    chimney: true,
                },
            }, params)),
            true,
            'house',
        )
    }

    if (asset === 'proc.tree.pine') {
        return resolved(asset, prefabSource('compact-pine'), false, 'tree')
    }

    if (asset.startsWith('prefab.')) {
        const prefabId = asset.slice('prefab.'.length)
        if (getPrefab(prefabId)) return resolved(asset, prefabSource(prefabId), false, classifyPrefab(prefabId))
    }

    const proc = resolveProceduralAsset(ctx, asset, ownerId, params)
    if (proc) return proc

    return reportAssetProblem(ctx, required, {
        code: 'unsupported_structure_asset',
        message: `Unsupported structure asset "${asset}".`,
        path: assetPath,
        details: { id: ownerId, asset },
    })
}

function resolveProceduralAsset(
    ctx: WorldgenCompileContext,
    asset: string,
    ownerId: string,
    params: Record<string, unknown> | null,
): ResolvedWorldgenAsset | null {
    const parts = asset.split('.')
    if (parts.length !== 3 || parts[0] !== 'proc') return null
    const [, kind, style] = parts
    const seed = assetSeed(ctx, ownerId, asset, params)
    switch (kind) {
        case 'house':
            if (!HOUSE_STYLES.has(style as HouseStyle)) return null
            return procedural(asset, 'house', seed, mergeProceduralParams({ house: { style: style as HouseStyle } }, params), 'house', true)
        case 'tree': {
            const resolvedStyle = style === 'full_pine' ? 'pine' : style
            if (!TREE_STYLES.has(resolvedStyle as TreeStyle)) return null
            return procedural(asset, 'tree', seed, mergeProceduralParams({ tree: { style: resolvedStyle as TreeStyle } }, params), 'tree', false)
        }
        case 'tower':
            if (!TOWER_STYLES.has(style as TowerStyle)) return null
            return procedural(asset, 'tower', seed, mergeProceduralParams({ tower: { style: style as TowerStyle } }, params), 'tower', true)
        case 'wall':
            if (!WALL_STYLES.has(style as WallStyle)) return null
            return procedural(asset, 'wall', seed, mergeProceduralParams({ wall: { style: style as WallStyle } }, params), 'wall', true)
        default:
            return null
    }
}

function procedural(
    id: string,
    kind: StructureKind,
    seed: number,
    overrides: PartialStructureGenerationOptions,
    assetKind: WorldgenAssetKind,
    structuralOnly: boolean,
): ResolvedWorldgenAsset {
    return resolved(id, proceduralSource(kind, seed, overrides), structuralOnly, assetKind)
}

function resolved(id: string, source: StructureSource, structuralOnly: boolean, kind: WorldgenAssetKind): ResolvedWorldgenAsset {
    return { id, source, structuralOnly, kind, sourceKind: source.kind }
}

function assetSeed(ctx: WorldgenCompileContext, ownerId: string, asset: string, params: Record<string, unknown> | null): number {
    return params && Object.keys(params).length > 0 ? ctx.key(ownerId, asset, stableJson(params)) : ctx.key(ownerId, asset)
}

function classifyPrefab(prefabId: string): WorldgenAssetKind {
    if (prefabId === 'portal-gate') return 'portal'
    if (prefabId === 'compact-pine') return 'tree'
    if (prefabId === 'forge' || prefabId.endsWith('-forge-shop')) return 'forge'
    if (
        prefabId.includes('product-market') ||
        prefabId.includes('clothes-store') ||
        prefabId.includes('alchemy-stall') ||
        prefabId.endsWith('-shop')
    ) {
        return 'shop'
    }
    return 'generic'
}

function readParams(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): Record<string, unknown> | null {
    if (value === undefined) return {}
    if (isRecord(value)) return value
    const diagnostic = {
        code: 'invalid_feature',
        message: `${path} must be an object when provided.`,
        path,
        details: { value },
    }
    if (required) ctx.error(diagnostic)
    else ctx.warning(diagnostic)
    return null
}

function mergeProceduralParams(
    base: PartialStructureGenerationOptions,
    params: Record<string, unknown> | null,
): PartialStructureGenerationOptions {
    if (!params) return base
    const merged: Record<string, unknown> = { ...base, ...params }
    for (const key of ['tree', 'house', 'landmark', 'tower', 'wall'] as const) {
        if (isRecord(base[key]) || isRecord(params[key])) merged[key] = { ...(isRecord(base[key]) ? base[key] : {}), ...(isRecord(params[key]) ? params[key] : {}) }
    }
    return merged as PartialStructureGenerationOptions
}

function reportAssetProblem<T extends WorldgenDiagnostic>(
    ctx: WorldgenCompileContext,
    required: boolean,
    diagnostic: T,
): null {
    if (required) ctx.error(diagnostic)
    else ctx.warning(diagnostic)
    return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

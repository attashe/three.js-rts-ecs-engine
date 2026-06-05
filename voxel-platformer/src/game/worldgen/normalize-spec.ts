import type {
    ContentSpec,
    EngineBlockKey,
    IdSpec,
    NormalizedMaterialAliasMap,
    NormalizedWorldSpec,
    Vec3Tuple,
    WorldSpec,
    WorldgenNormalizeResult,
    WorldgenReport,
    WorldgenWorldType,
} from './spec-types'
import { hashHex, stableJson } from './rng'
import { addWorldgenError, createWorldgenReport, finalizeWorldgenReport, setWorldgenMetricCounts } from './report'
import { isEngineBlockKey, normalizeMaterialName, resolveMaterial } from './material-map'
import { isRecord } from './worldgen-util'
import { expandWorldSpecRefs } from './composition'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const WORLD_TYPES = new Set<WorldgenWorldType>(['surface', 'underground', 'hybrid'])
const MATERIAL_FIELD_KEYS = new Set([
    'material',
    'default_material',
    'floor_material',
    'bed_material',
    'wall_material',
    'ceiling_material',
    'surface_material',
    'shore_material',
    'water_material',
    'floor_block',
    'edge_block',
    'bed_block',
    'block',
    'top',
    'soil',
    'base',
    'fill',
])

export function normalizeWorldSpec(input: unknown): WorldgenNormalizeResult {
    const initialHash = hashHex(input)
    const report = createWorldgenReport(undefined, initialHash)

    if (!isRecord(input)) {
        addWorldgenError(report, {
            code: 'invalid_spec',
            message: 'WorldSpec must be an object.',
            path: '$',
        })
        finalizeWorldgenReport(report)
        return { ok: false, report }
    }

    const expanded = expandWorldSpecRefs(input, report)

    if (expanded.version !== 1) {
        addWorldgenError(report, {
            code: 'invalid_version',
            message: 'WorldSpec.version must be 1.',
            path: '$.version',
            details: { value: expanded.version },
        })
    }

    const world = isRecord(expanded.world) ? expanded.world : null
    if (!world) {
        addWorldgenError(report, {
            code: 'missing_world',
            message: 'WorldSpec.world is required.',
            path: '$.world',
        })
    }

    const id = world ? requireStringField(world, 'id', '$.world.id', report) : null
    const name = world ? requireStringField(world, 'name', '$.world.name', report) : null
    const type = world ? requireWorldType(world.type, '$.world.type', report) : null
    const seed = world ? requireStringField(world, 'seed', '$.world.seed', report) : null
    const size = world ? requireSize(world.size, '$.world.size', report) : null
    const defaultGroundY = world && size ? readDefaultGroundY(world.defaultGroundY, size[1], report) : undefined

    if (id) {
        report.specId = id
        validateId(id, '$.world.id', report)
    }

    const materials = normalizeMaterialAliases(expanded.materials, report)
    validateKnownSectionShapes(expanded, report)
    validateIds(expanded, report)
    validateMaterialReferences(expanded, materials, report)

    if (report.errors.length > 0 || !id || !name || !type || !seed || !size) {
        finalizeWorldgenReport(report)
        return { ok: false, report }
    }

    const normalized = deepClone(expanded) as unknown as NormalizedWorldSpec
    normalized.world = {
        id,
        name,
        type,
        seed,
        size,
        ...(defaultGroundY !== undefined ? { defaultGroundY } : {}),
    }
    if (Object.keys(materials).length > 0) normalized.materials = materials
    else delete normalized.materials
    delete normalized.defs

    report.specHash = hashHex(stableJson(normalized))
    setWorldgenMetricCounts(report, collectMetrics(normalized))
    finalizeWorldgenReport(report)
    return { ok: true, spec: normalized, report }
}

function requireStringField(record: Record<string, unknown>, key: string, path: string, report: WorldgenReport): string | null {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    addWorldgenError(report, {
        code: 'missing_world_field',
        message: `WorldSpec.world.${key} must be a non-empty string.`,
        path,
        details: { value },
    })
    return null
}

function readDefaultGroundY(value: unknown, sizeY: number, report: WorldgenReport): number | undefined {
    if (value === undefined) return undefined
    if (Number.isInteger(value) && (value as number) >= 0 && (value as number) < sizeY) return value as number
    addWorldgenError(report, {
        code: 'invalid_world_field',
        message: 'WorldSpec.world.defaultGroundY must be an integer within the world Y bounds.',
        path: '$.world.defaultGroundY',
        details: { value, sizeY },
    })
    return undefined
}

function requireWorldType(value: unknown, path: string, report: WorldgenReport): WorldgenWorldType | null {
    if (typeof value === 'string' && WORLD_TYPES.has(value as WorldgenWorldType)) {
        return value as WorldgenWorldType
    }
    addWorldgenError(report, {
        code: 'invalid_world_type',
        message: 'WorldSpec.world.type must be surface, underground, or hybrid.',
        path,
        details: { value },
    })
    return null
}

function requireSize(value: unknown, path: string, report: WorldgenReport): Vec3Tuple | null {
    if (
        Array.isArray(value) &&
        value.length === 3 &&
        value.every((part) => Number.isInteger(part) && part > 0)
    ) {
        return [value[0] as number, value[1] as number, value[2] as number]
    }
    addWorldgenError(report, {
        code: 'invalid_world_size',
        message: 'WorldSpec.world.size must be a [x, y, z] tuple of positive integers.',
        path,
        details: { value },
    })
    return null
}

function normalizeMaterialAliases(value: unknown, report: WorldgenReport): NormalizedMaterialAliasMap {
    const out: NormalizedMaterialAliasMap = {}
    if (value === undefined) return out
    if (!isRecord(value)) {
        addWorldgenError(report, {
            code: 'invalid_material',
            message: 'WorldSpec.materials must be an object mapping aliases to engine block keys.',
            path: '$.materials',
            details: { value },
        })
        return out
    }

    const seen = new Map<string, string>()
    for (const [alias, target] of Object.entries(value)) {
        const path = `$.materials.${alias}`
        const normalizedAlias = normalizeMaterialName(alias)
        const previous = seen.get(normalizedAlias)
        if (previous) {
            addWorldgenError(report, {
                code: 'duplicate_id',
                message: `Duplicate material alias "${alias}" normalizes to "${normalizedAlias}".`,
                path,
                details: { firstPath: previous },
            })
            continue
        }
        seen.set(normalizedAlias, path)
        if (typeof target !== 'string' || !isEngineBlockKey(target)) {
            addWorldgenError(report, {
                code: 'invalid_material',
                message: `Material alias "${alias}" must target an engine BLOCK key.`,
                path,
                details: { target },
            })
            continue
        }
        out[normalizedAlias] = target as EngineBlockKey
    }
    return out
}

function validateIds(input: Record<string, unknown>, report: WorldgenReport): void {
    const seen = new Map<string, string>()
    const check = (id: unknown, path: string) => {
        if (id === undefined) return
        if (typeof id !== 'string' || !validateId(id, path, report)) return
        const previous = seen.get(id)
        if (previous) {
            addWorldgenError(report, {
                code: 'duplicate_id',
                message: `Duplicate worldgen id "${id}".`,
                path,
                details: { firstPath: previous },
            })
            return
        }
        seen.set(id, path)
    }

    forEachRequiredIdSpec(input.terrain, '$.terrain.features', report, (item, path) => check(item.id, path))
    forEachRequiredIdSpec(input.carvers, '$.carvers', report, (item, path) => check(item.id, path))
    forEachRequiredIdSpec(input.connectors, '$.connectors', report, (item, path) => check(item.id, path))
    forEachRequiredIdSpec(input.paths, '$.paths', report, (item, path) => check(item.id, path))
    forEachRequiredIdSpec(input.main_paths, '$.main_paths', report, (item, path) => check(item.id, path))
    forEachRequiredIdSpec(input.anchors, '$.anchors', report, (item, path) => check(item.id, path))
    forEachRequiredIdSpec(input.structures, '$.structures', report, (item, path) => check(item.id, path))
    forEachRequiredIdSpec(input.scatter, '$.scatter', report, (item, path) => check(item.id, path))
    forEachContentId(input.content, report, check)
    forEachIdSpec(input.validation, '$.validation.require_paths', (item, path) => check(item.id, path))
}

function validateId(id: string, path: string, report: WorldgenReport): boolean {
    if (ID_RE.test(id)) return true
    addWorldgenError(report, {
        code: 'invalid_id',
        message: `Invalid worldgen id "${id}". IDs may contain letters, numbers, dot, underscore, colon, and hyphen.`,
        path,
        details: { id },
    })
    return false
}

function forEachIdSpec(source: unknown, path: string, fn: (item: Partial<IdSpec>, path: string) => void): void {
    const items = path.endsWith('.features') && isRecord(source)
        ? source.features
        : path.endsWith('.require_paths') && isRecord(source)
            ? source.require_paths
            : source
    if (!Array.isArray(items)) return
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        if (isRecord(item)) fn(item as Partial<IdSpec>, `${path}[${i}].id`)
    }
}

function forEachRequiredIdSpec(source: unknown, path: string, report: WorldgenReport, fn: (item: Partial<IdSpec>, path: string) => void): void {
    const items = path.endsWith('.features') && isRecord(source)
        ? source.features
        : source
    if (!Array.isArray(items)) return
    for (let i = 0; i < items.length; i += 1) {
        const item = items[i]
        const itemPath = path.endsWith('.features') ? `$.terrain.features[${i}]` : `${path}[${i}]`
        if (!isRecord(item)) {
            addWorldgenError(report, {
                code: 'invalid_section',
                message: `${itemPath} must be an object.`,
                path: itemPath,
                details: { value: item },
            })
            continue
        }
        if (item.id === undefined) {
            addWorldgenError(report, {
                code: 'missing_id',
                message: `${itemPath}.id is required.`,
                path: `${itemPath}.id`,
            })
            continue
        }
        fn(item as Partial<IdSpec>, `${itemPath}.id`)
    }
}

function forEachContentId(content: unknown, report: WorldgenReport, fn: (id: unknown, path: string) => void): void {
    if (!isRecord(content)) return
    for (const [key, value] of Object.entries(content as ContentSpec)) {
        if (!Array.isArray(value)) continue
        for (let i = 0; i < value.length; i += 1) {
            const item = value[i]
            const itemPath = `$.content.${key}[${i}]`
            if (!isRecord(item)) {
                addWorldgenError(report, {
                    code: 'invalid_section',
                    message: `${itemPath} must be an object.`,
                    path: itemPath,
                    details: { value: item },
                })
                continue
            }
            if (item.id === undefined) {
                addWorldgenError(report, {
                    code: 'missing_id',
                    message: `${itemPath}.id is required.`,
                    path: `${itemPath}.id`,
                })
                continue
            }
            fn(item.id, `${itemPath}.id`)
        }
    }
}

function validateKnownSectionShapes(input: Record<string, unknown>, report: WorldgenReport): void {
    validateObjectSection(input.terrain, '$.terrain', report)
    validateObjectSection(input.volume, '$.volume', report)
    validateObjectSection(input.validation, '$.validation', report)
    validateObjectSection(input.content, '$.content', report)
    validateArraySection(isRecord(input.terrain) ? input.terrain.features : undefined, '$.terrain.features', report)
    validateArraySection(input.carvers, '$.carvers', report)
    validateArraySection(input.connectors, '$.connectors', report)
    validateArraySection(input.paths, '$.paths', report)
    validateArraySection(input.main_paths, '$.main_paths', report)
    validateArraySection(input.anchors, '$.anchors', report)
    validateArraySection(input.structures, '$.structures', report)
    validateArraySection(input.scatter, '$.scatter', report)
    validateArraySection(isRecord(input.validation) ? input.validation.require_paths : undefined, '$.validation.require_paths', report)
    if (isRecord(input.content)) {
        for (const key of ['npcs', 'zones', 'quests', 'shops', 'pickups', 'props', 'scripts', 'cinematics', 'travel', 'rail_carts']) {
            validateArraySection(input.content[key], `$.content.${key}`, report)
        }
    }
}

function validateObjectSection(value: unknown, path: string, report: WorldgenReport): void {
    if (value === undefined || isRecord(value)) return
    addWorldgenError(report, {
        code: 'invalid_section',
        message: `${path} must be an object.`,
        path,
        details: { value },
    })
}

function validateArraySection(value: unknown, path: string, report: WorldgenReport): void {
    if (value === undefined || Array.isArray(value)) return
    addWorldgenError(report, {
        code: 'invalid_section',
        message: `${path} must be an array.`,
        path,
        details: { value },
    })
}

function validateMaterialReferences(
    input: Record<string, unknown>,
    aliases: NormalizedMaterialAliasMap,
    report: WorldgenReport,
): void {
    scanMaterialRefs(input.terrain, '$.terrain', aliases, report)
    scanMaterialRefs(input.volume, '$.volume', aliases, report)
    scanMaterialRefs(input.carvers, '$.carvers', aliases, report)
    scanMaterialRefs(input.connectors, '$.connectors', aliases, report)
    scanMaterialRefs(input.paths, '$.paths', aliases, report)
    scanMaterialRefs(input.main_paths, '$.main_paths', aliases, report)
    scanMaterialRefs(input.structures, '$.structures', aliases, report)
    scanMaterialRefs(input.scatter, '$.scatter', aliases, report)
}

function scanMaterialRefs(value: unknown, path: string, aliases: NormalizedMaterialAliasMap, report: WorldgenReport): void {
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) scanMaterialRefs(value[i], `${path}[${i}]`, aliases, report)
        return
    }
    if (!isRecord(value)) return
    for (const [key, item] of Object.entries(value)) {
        const nextPath = `${path}.${key}`
        if (typeof item === 'string' && MATERIAL_FIELD_KEYS.has(key)) {
            const resolved = resolveMaterial(item, aliases)
            if (!resolved.ok) {
                addWorldgenError(report, {
                    code: 'invalid_material',
                    message: `Unknown or invalid material "${item}".`,
                    path: nextPath,
                    details: resolved,
                })
            }
            continue
        }
        if (Array.isArray(item) || isRecord(item)) scanMaterialRefs(item, nextPath, aliases, report)
    }
}

function collectMetrics(spec: NormalizedWorldSpec) {
    const content = spec.content
    const terrainFeatureCount = spec.terrain?.features?.length ?? 0
    return {
        size: spec.world.size,
        anchorCount: spec.anchors?.length ?? 0,
        terrainFeatureCount,
        carverCount: spec.carvers?.length ?? 0,
        connectorCount: spec.connectors?.length ?? 0,
        pathCount: (spec.paths?.length ?? 0) + (spec.main_paths?.length ?? 0),
        structureCount: spec.structures?.length ?? 0,
        scatterRuleCount: spec.scatter?.length ?? 0,
        validationRuleCount: spec.validation?.require_paths?.length ?? 0,
        npcCount: content?.npcs?.length ?? 0,
        zoneCount: content?.zones?.length ?? 0,
        scriptCount: (content?.quests?.length ?? 0) + (content?.shops?.length ?? 0) + (content?.scripts?.length ?? 0),
    }
}

function deepClone<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => deepClone(item)) as T
    if (isRecord(value)) {
        const out: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value)) out[key] = deepClone(item)
        return out as T
    }
    return value
}

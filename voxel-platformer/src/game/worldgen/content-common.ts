import type { Zone } from '../../engine/ecs/zones'
import type { ScriptEntry } from '../../engine/script/types'
import type { NpcConfig } from '../npcs/npc-types'
import type { ContentEntrySpec, ContentSpec, Vec2Tuple, Vec3Tuple, VoxelCoord, WorldgenDiagnostic } from './spec-types'
import { WorldgenCompileContext } from './compile-context'
import type { WorldgenLevelDraft } from './level-draft'
import { isRecord } from './worldgen-util'

// Re-exported so existing `import { isRecord } from './content-common'` sites
// keep working; the canonical definition lives in worldgen-util.ts.
export { isRecord }

const WORLDGEN_TEMPLATE_SCRIPT_PREFIX = '// worldgen-template-script:'

export interface WorldgenContentResolveOptions {
    standYAtXZ?: (x: number, z: number) => number
    contentIndex?: ContentResolutionIndex
}

export type ContentResolutionKind = 'props' | 'zones' | 'npcs' | 'pickups' | 'travel' | 'rail_carts' | 'chests'

export interface ContentResolutionEntry {
    id: string
    kind: ContentResolutionKind
    spec: ContentEntrySpec
    path: string
    required: boolean
}

export interface ContentResolutionIndex {
    entries: Map<string, ContentResolutionEntry>
    positions: Map<string, VoxelCoord>
    resolving: string[]
    failed: Set<string>
}

export function contentEntryRequired(spec: ContentEntrySpec): boolean {
    return spec.required !== false
}

export function contentId(ctx: WorldgenCompileContext, spec: ContentEntrySpec, path: string, required: boolean): string | null {
    if (typeof spec.id === 'string' && spec.id.trim().length > 0) return spec.id.trim()
    contentDiagnostic(ctx, required, {
        code: 'missing_id',
        message: `${path}.id is required.`,
        path: `${path}.id`,
        details: { value: spec.id },
    })
    return null
}

export function contentDiagnostic(ctx: WorldgenCompileContext, required: boolean, diagnostic: WorldgenDiagnostic): void {
    if (required) ctx.error(diagnostic)
    else ctx.warning(diagnostic)
}

export function createContentResolutionIndex(content: ContentSpec): ContentResolutionIndex {
    const entries = new Map<string, ContentResolutionEntry>()
    for (const kind of ['props', 'zones', 'npcs', 'pickups', 'travel', 'rail_carts', 'chests'] as const) {
        const list = content[kind]
        if (!Array.isArray(list)) continue
        for (let i = 0; i < list.length; i += 1) {
            const spec = list[i]!
            if (typeof spec.id !== 'string' || spec.id.trim().length === 0) continue
            const id = spec.id.trim()
            if (!entries.has(id)) {
                entries.set(id, {
                    id,
                    kind,
                    spec,
                    path: `$.content.${kind}[${i}]`,
                    required: contentEntryRequired(spec),
                })
            }
        }
    }
    return { entries, positions: new Map(), resolving: [], failed: new Set() }
}

export function resolveContentPosition(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    required: boolean,
    opts: WorldgenContentResolveOptions,
): VoxelCoord | null {
    const ownId = typeof spec.id === 'string' ? spec.id.trim() : ''
    if (ownId && opts.contentIndex?.entries.has(ownId)) {
        return resolveIndexedContentPosition(ctx, ownId, path, required, opts)
    }
    return resolveContentPositionDirect(ctx, spec, path, required, opts)
}

function resolveIndexedContentPosition(
    ctx: WorldgenCompileContext,
    id: string,
    requestPath: string,
    required: boolean,
    opts: WorldgenContentResolveOptions,
): VoxelCoord | null {
    const index = opts.contentIndex
    if (!index) return null
    const cached = index.positions.get(id)
    if (cached) return { ...cached }
    if (index.failed.has(id)) return null
    const entry = index.entries.get(id)
    if (!entry) return null
    if (index.resolving.includes(id)) {
        contentDiagnostic(ctx, required, {
            code: 'ref_cycle',
            message: `${requestPath} creates a cycle between content placements.`,
            path: requestPath,
            details: { id, stack: [...index.resolving, id] },
        })
        index.failed.add(id)
        return null
    }

    index.resolving.push(id)
    const position = resolveContentPositionDirect(ctx, entry.spec, entry.path, entry.required, opts)
    index.resolving.pop()
    if (!position) {
        index.failed.add(id)
        return null
    }
    index.positions.set(id, position)
    ctx.resolveObject(id, position)
    return { ...position }
}

function resolveContentPositionDirect(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    required: boolean,
    opts: WorldgenContentResolveOptions,
): VoxelCoord | null {
    let coord: VoxelCoord | null = null
    if (typeof spec.place_at === 'string' && spec.place_at.trim().length > 0) {
        const id = spec.place_at.trim()
        const found = resolvedContentObject(ctx, id, opts, `${path}.place_at`, required)
        if (!found) {
            const message = isDeclaredContentId(ctx, id)
                ? `${path}.place_at references "${id}", but that content id is not a resolved spatial target.`
                : `${path}.place_at references unknown anchor or object "${id}".`
            contentDiagnostic(ctx, required, {
                code: 'missing_reference',
                message,
                path: `${path}.place_at`,
                details: { id },
            })
            return null
        }
        coord = { ...found }
    } else if (spec.place_at_xz !== undefined) {
        const point = readOptionalVec2(ctx, spec.place_at_xz, `${path}.place_at_xz`)
        if (!point) return null
        const x = Math.round(point[0])
        const z = Math.round(point[1])
        if (!ctx.inXZ(x, z)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.place_at_xz leaves world bounds.`,
                path: `${path}.place_at_xz`,
                details: { x, z },
            })
            return null
        }
        if (!opts.standYAtXZ && typeof spec.y !== 'number') {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.place_at_xz needs a surface resolver or explicit y.`,
                path: `${path}.place_at_xz`,
                details: { x, z },
            })
            return null
        }
        coord = { x: x + 0.5, y: finiteNumber(spec.y, opts.standYAtXZ ? opts.standYAtXZ(x, z) : 1), z: z + 0.5 }
    } else if (spec.position !== undefined) {
        coord = readPosition(ctx, spec.position, `${path}.position`, required)
        if (!coord) return null
    } else if (spec.railCell !== undefined || spec.rail_cell !== undefined) {
        coord = readRailCellPosition(ctx, spec.railCell ?? spec.rail_cell, `${path}.railCell`, required)
        if (!coord) return null
    } else {
        contentDiagnostic(ctx, required, {
            code: 'missing_reference',
            message: `${path} must declare place_at, place_at_xz, position, or railCell.`,
            path,
        })
        return null
    }

    const offset = readOptionalVec3(ctx, spec.offset, `${path}.offset`)
    if (offset) coord = { x: coord.x + offset[0], y: coord.y + offset[1], z: coord.z + offset[2] }
    const offsetXZ = readOptionalVec2(ctx, spec.offset_xz, `${path}.offset_xz`)
    if (offsetXZ) coord = { x: coord.x + offsetXZ[0], y: coord.y, z: coord.z + offsetXZ[1] }
    const dy = spec.dy ?? spec.offset_y ?? spec.offsetY
    if (typeof dy === 'number' && Number.isFinite(dy)) coord = { ...coord, y: coord.y + dy }
    return coord
}

export function resolvedContentObject(
    ctx: WorldgenCompileContext,
    id: string,
    opts: WorldgenContentResolveOptions = {},
    requestPath = '$',
    required = true,
): VoxelCoord | null {
    const resolved = ctx.report.resolvedAnchors[id] ?? ctx.report.resolvedObjects[id]
    if (resolved) return { ...resolved }
    if (opts.contentIndex?.entries.has(id)) return resolveIndexedContentPosition(ctx, id, requestPath, required, opts)
    return null
}

export function resolveContentTarget(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    value: unknown,
    path: string,
    required: boolean,
): { id: string; kind: 'npc'; npc: NpcConfig } | { id: string; kind: 'zone'; zone: Zone } | null {
    if (typeof value !== 'string' || value.trim().length === 0) {
        contentDiagnostic(ctx, required, {
            code: 'missing_reference',
            message: `${path} must reference an NPC or interact zone id.`,
            path,
            details: { value },
        })
        return null
    }
    const id = value.trim()
    const npc = draft.npcs.find((entry) => entry.id === id)
    if (npc) return { id, kind: 'npc', npc }
    const zone = draft.zones.find((entry) => entry.id === id)
    if (zone) {
        if (zone.kind === 'interact') return { id, kind: 'zone', zone }
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} references zone "${id}", but generated content targets must be NPCs or interact zones.`,
            path,
            details: { id, zoneKind: zone.kind },
        })
        return null
    }
    contentDiagnostic(ctx, required, {
        code: 'missing_reference',
        message: `${path} references unknown NPC or zone "${id}".`,
        path,
        details: { id },
    })
    return null
}

export function appendGeneratedScript(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    entry: ScriptEntry,
    path: string,
    required: boolean,
): boolean {
    const conflict = runtimeScriptIdConflict(draft, entry.id)
    if (conflict) {
        contentDiagnostic(ctx, required, {
            code: 'duplicate_id',
            message: `Generated script id "${entry.id}" conflicts with ${conflict}.`,
            path,
            details: { id: entry.id },
        })
        return false
    }
    draft.scripts.push(entry)
    ctx.report.placements.push({ id: entry.id, kind: 'content_script', name: entry.name, generated: true })
    return true
}

export function appendAuthoredScript(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    entry: ScriptEntry,
    path: string,
    required: boolean,
): boolean {
    const conflict = runtimeScriptIdConflict(draft, entry.id)
    if (conflict) {
        contentDiagnostic(ctx, required, {
            code: 'duplicate_id',
            message: `Script id "${entry.id}" conflicts with ${conflict}.`,
            path,
            details: { id: entry.id },
        })
        return false
    }
    draft.scripts.push(entry)
    ctx.report.placements.push({ id: entry.id, kind: 'content_script', name: entry.name })
    return true
}

export function markTemplateScript(templateId: string, source: string): string {
    const trimmed = source.trim()
    return trimmed ? `${WORLDGEN_TEMPLATE_SCRIPT_PREFIX}${templateId}\n${trimmed}` : ''
}

export function appendNpcScript(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    npcId: string,
    source: string,
    path: string,
    required: boolean,
    opts: { replaceMarkedTemplateScript?: boolean } = {},
): boolean {
    const npc = draft.npcs.find((entry) => entry.id === npcId)
    if (!npc) {
        contentDiagnostic(ctx, required, {
            code: 'missing_reference',
            message: `${path} references unknown NPC "${npcId}".`,
            path,
            details: { npcId },
        })
        return false
    }
    const current = npc.scriptSource.trim()
    if (opts.replaceMarkedTemplateScript && current.startsWith(WORLDGEN_TEMPLATE_SCRIPT_PREFIX)) {
        npc.scriptSource = source.trim()
    } else {
        npc.scriptSource = [current, source.trim()].filter(Boolean).join('\n\n')
    }
    npc.scriptEnabled = true
    return true
}

// INVARIANT for all generated `ScriptEntry` source: every *runtime value*
// (ids, names, dialogue text, item configs, positions) interpolated into a
// generated script string MUST be emitted through `scriptLiteral()` so it is
// JSON-escaped. Only hard-coded literals and identifiers produced by
// `scriptIdent()` may be interpolated raw. This keeps generated scripts immune
// to injection/syntax breakage from author-supplied strings.
export function scriptLiteral(value: unknown): string {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? 'null' : encoded
}

export function scriptLines(lines: readonly string[]): string {
    return lines.join('\n')
}

export function scriptConst(name: string, value: unknown): string {
    return `const ${name} = ${scriptLiteral(value)}`
}

export function generatedScriptEntry(kind: string, id: string, source: string): ScriptEntry {
    return {
        id: `worldgen:${kind}:${id}`,
        name: `worldgen-${kind}-${id}.js`,
        source,
    }
}

/** Sanitise an arbitrary content id into a safe JS identifier suffix, for use
 *  in generated `const QUEST_<suffix>`/`SHOP_<suffix>` names. */
export function scriptIdent(id: string): string {
    const cleaned = id.replace(/[^A-Za-z0-9_$]/g, '_')
    return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`
}

export function readRequiredString(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): string | null {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a non-empty string.`,
        path,
        details: { value },
    })
    return null
}

export function readOptionalVec2(ctx: WorldgenCompileContext, value: unknown, path: string): Vec2Tuple | null {
    if (value === undefined) return null
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, z] tuple.`, path, details: { value } })
    return null
}

export function readOptionalVec3(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple | null {
    if (value === undefined) return null
    if (Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number, value[2] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, y, z] tuple.`, path, details: { value } })
    return null
}

export function readString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

export function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function positiveNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Parse a voxel coordinate from a `[x, y, z]` tuple or `{ x, y, z }` object.
 *  Returns null on an invalid shape. When `round` is true every component is
 *  rounded to an integer (for cell references); otherwise kept as authored. */
export function readVoxelCoord(value: unknown, round = false): VoxelCoord | null {
    const map = round ? Math.round : (n: number) => n
    if (Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return { x: map(value[0] as number), y: map(value[1] as number), z: map(value[2] as number) }
    }
    if (
        isRecord(value) &&
        typeof value.x === 'number' && Number.isFinite(value.x) &&
        typeof value.y === 'number' && Number.isFinite(value.y) &&
        typeof value.z === 'number' && Number.isFinite(value.z)
    ) {
        return { x: map(value.x), y: map(value.y), z: map(value.z) }
    }
    return null
}

function readPosition(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): VoxelCoord | null {
    const coord = readVoxelCoord(value)
    if (coord) return coord
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a [x, y, z] tuple or { x, y, z } object.`,
        path,
        details: { value },
    })
    return null
}

function readRailCellPosition(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): VoxelCoord | null {
    const cell = readVoxelCoord(value, true)
    if (!cell) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be a [x, y, z] tuple or { x, y, z } object.`,
            path,
            details: { value },
        })
        return null
    }
    if (!ctx.inXYZ(cell.x, cell.y, cell.z)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} leaves world bounds.`,
            path,
            details: { railCell: cell },
        })
        return null
    }
    return { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }
}

function isDeclaredContentId(ctx: WorldgenCompileContext, id: string): boolean {
    if (ctx.spec.anchors?.some((anchor) => anchor.id === id)) return true
    const content = ctx.spec.content
    if (!content) return false
    for (const entries of Object.values(content)) {
        if (Array.isArray(entries) && entries.some((entry) => isRecord(entry) && entry.id === id)) return true
    }
    return false
}

function runtimeScriptIdConflict(draft: WorldgenLevelDraft, id: string): string | null {
    const script = draft.scripts.find((entry) => entry.id === id)
    if (script) return `level script "${script.name}"`
    const npc = draft.npcs.find((entry) => entry.scriptEnabled && entry.scriptSource.trim().length > 0 && `npc-script:${entry.id}` === id)
    if (npc) return `NPC script for "${npc.id}"`
    return null
}

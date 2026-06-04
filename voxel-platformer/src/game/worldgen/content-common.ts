import type { Zone } from '../../engine/ecs/zones'
import type { ScriptEntry } from '../../engine/script/types'
import type { NpcConfig } from '../npcs/npc-types'
import type { ContentEntrySpec, Vec2Tuple, Vec3Tuple, VoxelCoord, WorldgenDiagnostic } from './spec-types'
import { WorldgenCompileContext } from './compile-context'
import type { WorldgenLevelDraft } from './level-draft'

const WORLDGEN_TEMPLATE_SCRIPT_PREFIX = '// worldgen-template-script:'

export interface WorldgenContentResolveOptions {
    standYAtXZ?: (x: number, z: number) => number
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

export function resolveContentPosition(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    required: boolean,
    opts: WorldgenContentResolveOptions,
): VoxelCoord | null {
    let coord: VoxelCoord | null = null
    if (typeof spec.place_at === 'string' && spec.place_at.trim().length > 0) {
        const id = spec.place_at.trim()
        const found = resolvedContentObject(ctx, id)
        if (!found) {
            const message = isDeclaredContentId(ctx, id)
                ? `${path}.place_at references "${id}", which is declared but has not resolved yet. `
                    + 'Content resolves in order props -> zones -> npcs -> travel/metadata -> pickups -> shops -> quests -> scripts, '
                    + 'so place_at may only target an anchor or an earlier-resolved object.'
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
    } else {
        contentDiagnostic(ctx, required, {
            code: 'missing_reference',
            message: `${path} must declare place_at or place_at_xz.`,
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

export function resolvedContentObject(ctx: WorldgenCompileContext, id: string): VoxelCoord | null {
    return ctx.report.resolvedAnchors[id] ?? ctx.report.resolvedObjects[id] ?? null
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

export function scriptLiteral(value: unknown): string {
    const encoded = JSON.stringify(value)
    return encoded === undefined ? 'null' : encoded
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

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
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

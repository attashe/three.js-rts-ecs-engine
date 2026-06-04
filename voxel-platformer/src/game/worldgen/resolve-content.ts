import type { Zone, ZoneTriggerSource } from '../../engine/ecs/zones'
import type { ScriptEntry } from '../../engine/script/types'
import {
    applyNpcTemplate,
    npcTemplateById,
} from '../npcs/npc-templates'
import {
    normalizeNpcConfig,
    type NpcBehaviourConfig,
    type NpcConfig,
} from '../npcs/npc-types'
import { mergeBehaviourIntoScript } from '../npcs/npc-behaviour-script'
import { PROP_KINDS, type EditorPropKind } from '../props/prop-types'
import { WorldgenCompileContext } from './compile-context'
import type { ContentEntrySpec, Vec2Tuple, Vec3Tuple, VoxelCoord, WorldgenDiagnostic } from './spec-types'
import type { WorldgenLevelDraft } from './level-draft'

export interface WorldgenContentResolveOptions {
    standYAtXZ?: (x: number, z: number) => number
}

const PROP_KIND_SET = new Set<string>(PROP_KINDS)
const TRIGGER_SOURCES = new Set<ZoneTriggerSource>(['player', 'arrow'])

export function resolveContent(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, opts: WorldgenContentResolveOptions = {}): void {
    const content = ctx.spec.content
    if (!content) return
    resolveContentProps(ctx, draft, content.props ?? [], opts)
    resolveContentZones(ctx, draft, content.zones ?? [], opts)
    resolveContentNpcs(ctx, draft, content.npcs ?? [], opts)
    resolveContentScripts(ctx, draft, content.scripts ?? [])
}

function resolveContentProps(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    props: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    for (let i = 0; i < props.length; i += 1) {
        const spec = props[i]!
        const path = `$.content.props[${i}]`
        const required = spec.required !== false
        const id = contentId(spec, path, ctx, required)
        if (!id) continue
        const kind = readPropKind(ctx, spec.kind, `${path}.kind`, required)
        if (!kind) continue
        const position = resolveContentPosition(ctx, spec, path, required, opts)
        if (!position) continue
        const prop = {
            id,
            kind,
            position,
            yaw: finiteNumber(spec.yaw, 0),
            scale: positiveNumber(spec.scale, 1),
            gridAligned: typeof spec.gridAligned === 'boolean' ? spec.gridAligned : false,
            ...(typeof spec.visible === 'boolean' ? { visible: spec.visible } : {}),
        }
        draft.props.push(prop)
        ctx.resolveObject(id, position)
        ctx.report.placements.push({ id, kind: 'content_prop', propKind: kind, x: position.x, y: position.y, z: position.z })
    }
}

function resolveContentZones(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    zones: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    for (let i = 0; i < zones.length; i += 1) {
        const spec = zones[i]!
        const path = `$.content.zones[${i}]`
        const required = spec.required !== false
        const id = contentId(spec, path, ctx, required)
        if (!id) continue
        const center = resolveContentPosition(ctx, spec, path, required, opts)
        if (!center) continue
        const type = readString(spec.type ?? spec.kind, 'trigger')
        const kind = type === 'interact' || type === 'arrival' || type === 'portal' ? type : readString(spec.kind, type)
        const half = readOptionalVec2(ctx, spec.half_xz ?? spec.half, `${path}.half_xz`) ?? [1, 1]
        const height = positiveNumber(spec.height, 2.2)
        const yMin = finiteNumber(spec.y_min, center.y)
        const yMax = finiteNumber(spec.y_max, yMin + height)
        const portal = kind === 'portal' ? readZonePortal(ctx, spec, path, required) : null
        if (kind === 'portal' && !portal) continue
        const zone: Zone = {
            id,
            kind,
            label: typeof spec.label === 'string' ? spec.label : undefined,
            min: { x: center.x - half[0], y: yMin, z: center.z - half[1] },
            max: { x: center.x + half[0], y: yMax, z: center.z + half[1] },
            ...(readTriggerSources(ctx, spec.triggerSources, `${path}.triggerSources`) ?? {}),
            ...(portal ?? {}),
            ...(readZoneInteraction(spec, kind, center, yMin, yMax) ?? {}),
            ...(typeof spec.active === 'boolean' ? { active: spec.active } : {}),
        }
        draft.zones.push(zone)
        ctx.resolveObject(id, center)
        ctx.report.placements.push({ id, kind: 'content_zone', zoneKind: zone.kind, x: center.x, y: center.y, z: center.z })
    }
}

function resolveContentNpcs(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    npcs: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    for (let i = 0; i < npcs.length; i += 1) {
        const spec = npcs[i]!
        const path = `$.content.npcs[${i}]`
        const required = spec.required !== false
        const id = contentId(spec, path, ctx, required)
        if (!id) continue
        const position = resolveContentPosition(ctx, spec, path, required, opts)
        if (!position) continue
        const partial = npcPartial(spec, id, position)
        const templateId = typeof spec.template === 'string' ? spec.template.trim() : ''
        const template = templateId ? npcTemplateById(templateId) : undefined
        if (templateId && !template) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `Unknown NPC template "${templateId}".`,
                path: `${path}.template`,
                details: { id, template: templateId },
            })
            continue
        }
        const templated = template ? applyNpcTemplate(partial, template) : normalizeNpcConfig(partial)
        const npc = normalizeNpcConfig({
            ...templated,
            ...partial,
            equipment: partial.equipment ?? templated.equipment,
            voice: partial.voice ?? templated.voice,
            behaviour: partial.behaviour ?? templated.behaviour,
            scriptSource: partial.scriptSource ?? templated.scriptSource,
        })
        if (npc.behaviour) npc.scriptSource = mergeBehaviourIntoScript(npc.scriptSource, npc.behaviour)
        draft.npcs.push(npc)
        ctx.resolveObject(id, position)
        ctx.report.placements.push({ id, kind: 'content_npc', model: npc.model, x: position.x, y: position.y, z: position.z })
    }
}

function resolveContentScripts(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, scripts: readonly ContentEntrySpec[]): void {
    for (let i = 0; i < scripts.length; i += 1) {
        const spec = scripts[i]!
        const path = `$.content.scripts[${i}]`
        const required = spec.required !== false
        const id = contentId(spec, path, ctx, required)
        if (!id) continue
        if (typeof spec.source !== 'string' || spec.source.trim().length === 0) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.source must be a non-empty script source string.`,
                path: `${path}.source`,
                details: { id },
            })
            continue
        }
        const entry: ScriptEntry = {
            id,
            name: typeof spec.name === 'string' && spec.name.trim().length > 0 ? spec.name.trim() : `${id}.js`,
            source: spec.source,
            ...(typeof spec.enabled === 'boolean' ? { enabled: spec.enabled } : {}),
        }
        draft.scripts.push(entry)
        ctx.report.placements.push({ id, kind: 'content_script', name: entry.name })
    }
}

function resolveContentPosition(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    required: boolean,
    opts: WorldgenContentResolveOptions,
): VoxelCoord | null {
    let coord: VoxelCoord | null = null
    if (typeof spec.place_at === 'string' && spec.place_at.trim().length > 0) {
        const id = spec.place_at.trim()
        const found = ctx.report.resolvedAnchors[id] ?? ctx.report.resolvedObjects[id]
        if (!found) {
            contentDiagnostic(ctx, required, {
                code: 'missing_reference',
                message: `${path}.place_at references unresolved anchor or object "${id}".`,
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
    if (typeof spec.dy === 'number' && Number.isFinite(spec.dy)) coord = { ...coord, y: coord.y + spec.dy }
    return coord
}

function npcPartial(spec: ContentEntrySpec, id: string, position: VoxelCoord): Partial<NpcConfig> & Pick<NpcConfig, 'id' | 'position'> {
    const partial: Partial<NpcConfig> & Pick<NpcConfig, 'id' | 'position'> = {
        id,
        position,
        name: typeof spec.name === 'string' && spec.name.trim().length > 0 ? spec.name.trim() : id,
    }
    if (typeof spec.model === 'string') partial.model = spec.model as NpcConfig['model']
    if (typeof spec.variant === 'string') partial.variant = spec.variant as NpcConfig['variant']
    if (typeof spec.beard === 'string') partial.beard = spec.beard as NpcConfig['beard']
    if (typeof spec.yaw === 'number' && Number.isFinite(spec.yaw)) partial.yaw = spec.yaw
    if (typeof spec.scale === 'number' && Number.isFinite(spec.scale)) partial.scale = spec.scale
    if (typeof spec.gridAligned === 'boolean') partial.gridAligned = spec.gridAligned
    if (typeof spec.collisionEnabled === 'boolean') partial.collisionEnabled = spec.collisionEnabled
    if (typeof spec.colliderRadius === 'number' && Number.isFinite(spec.colliderRadius)) partial.colliderRadius = spec.colliderRadius
    if (typeof spec.colliderHeight === 'number' && Number.isFinite(spec.colliderHeight)) partial.colliderHeight = spec.colliderHeight
    if (typeof spec.interactionEnabled === 'boolean') partial.interactionEnabled = spec.interactionEnabled
    if (typeof spec.interactionPrompt === 'string') partial.interactionPrompt = spec.interactionPrompt
    if (typeof spec.interactionRadius === 'number' && Number.isFinite(spec.interactionRadius)) partial.interactionRadius = spec.interactionRadius
    if (typeof spec.invulnerable === 'boolean') partial.invulnerable = spec.invulnerable
    if (typeof spec.unprovokable === 'boolean') partial.unprovokable = spec.unprovokable
    if (typeof spec.threatMemorySeconds === 'number' && Number.isFinite(spec.threatMemorySeconds)) partial.threatMemorySeconds = spec.threatMemorySeconds
    if (isRecord(spec.equipment)) partial.equipment = spec.equipment as unknown as NpcConfig['equipment']
    if (isRecord(spec.voice)) partial.voice = spec.voice as NpcConfig['voice']
    if (typeof spec.scriptSource === 'string') partial.scriptSource = spec.scriptSource
    if (typeof spec.scriptEnabled === 'boolean') partial.scriptEnabled = spec.scriptEnabled
    if (isRecord(spec.behaviour)) partial.behaviour = spec.behaviour as Partial<NpcBehaviourConfig> as NpcConfig['behaviour']
    return partial
}

function readZoneInteraction(spec: ContentEntrySpec, kind: string, center: VoxelCoord, yMin: number, yMax: number): Pick<Zone, 'interaction'> | null {
    if (kind !== 'interact') return null
    const anchorDy = finiteNumber(spec.anchor_dy, (yMax - yMin) / 2)
    return {
        interaction: {
            prompt: typeof spec.prompt === 'string' ? spec.prompt : undefined,
            anchor: { x: center.x, y: yMin + anchorDy, z: center.z },
            radius: positiveNumber(spec.radius, 2.5),
        },
    }
}

function readZonePortal(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    required: boolean,
): Pick<Zone, 'portal'> | null {
    const targetLevelId = readString(spec.targetLevelId ?? spec.target_level_id, '')
    if (!targetLevelId) {
        contentDiagnostic(ctx, required, {
            code: 'missing_reference',
            message: `${path}.targetLevelId is required for portal zones.`,
            path: `${path}.targetLevelId`,
            details: { id: spec.id },
        })
        return null
    }
    const targetArrivalId = readString(spec.targetArrivalId ?? spec.target_arrival_id, '')
    return { portal: { targetLevelId, ...(targetArrivalId ? { targetArrivalId } : {}) } }
}

function readTriggerSources(ctx: WorldgenCompileContext, value: unknown, path: string): Pick<Zone, 'triggerSources'> | null {
    if (value === undefined) return null
    if (!Array.isArray(value)) {
        ctx.error({ code: 'invalid_feature', message: `${path} must be an array.`, path, details: { value } })
        return null
    }
    const sources: ZoneTriggerSource[] = []
    for (let i = 0; i < value.length; i += 1) {
        if (TRIGGER_SOURCES.has(value[i] as ZoneTriggerSource)) sources.push(value[i] as ZoneTriggerSource)
        else ctx.error({ code: 'invalid_feature', message: `${path}[${i}] must be player or arrow.`, path: `${path}[${i}]`, details: { value: value[i] } })
    }
    return { triggerSources: sources }
}

function readPropKind(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): EditorPropKind | null {
    if (typeof value === 'string' && PROP_KIND_SET.has(value)) return value as EditorPropKind
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a known prop kind.`,
        path,
        details: { value },
    })
    return null
}

function contentId(spec: ContentEntrySpec, path: string, ctx: WorldgenCompileContext, required: boolean): string | null {
    if (typeof spec.id === 'string' && spec.id.trim().length > 0) return spec.id.trim()
    contentDiagnostic(ctx, required, {
        code: 'missing_id',
        message: `${path}.id is required.`,
        path: `${path}.id`,
        details: { value: spec.id },
    })
    return null
}

function contentDiagnostic(ctx: WorldgenCompileContext, required: boolean, diagnostic: WorldgenDiagnostic): void {
    if (required) ctx.error(diagnostic)
    else ctx.warning(diagnostic)
}

function readOptionalVec2(ctx: WorldgenCompileContext, value: unknown, path: string): Vec2Tuple | null {
    if (value === undefined) return null
    if (Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, z] tuple.`, path, details: { value } })
    return null
}

function readOptionalVec3(ctx: WorldgenCompileContext, value: unknown, path: string): Vec3Tuple | null {
    if (value === undefined) return null
    if (Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number' && Number.isFinite(part))) {
        return [value[0] as number, value[1] as number, value[2] as number]
    }
    ctx.error({ code: 'invalid_feature', message: `${path} must be a [x, y, z] tuple.`, path, details: { value } })
    return null
}

function readString(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function finiteNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positiveNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import type { Zone, ZoneTriggerSource } from '../../engine/ecs/zones'
import type { RailCartFacing } from '../../engine/ecs/world'
import type { ScriptEntry } from '../../engine/script/types'
import { BLOCK, isCollidable, isRailBlock } from '../../engine/voxel/palette'
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
import type { ContentEntrySpec, VoxelCoord } from './spec-types'
import type { WorldgenLevelDraft } from './level-draft'
import {
    appendAuthoredScript,
    contentDiagnostic,
    contentEntryRequired,
    contentId,
    createContentResolutionIndex,
    finiteNumber,
    isRecord,
    markTemplateScript,
    positiveNumber,
    readOptionalVec2,
    readString,
    readVoxelCoord,
    resolveContentPosition,
    type WorldgenContentResolveOptions,
} from './content-common'
import { resolveContentMetadata } from './resolve-content-metadata'
import { resolveContentPickups } from './resolve-pickups'
import { resolveContentShops } from './resolve-shops'
import { resolveContentQuests } from './resolve-quests'
import type { LootChestItem } from '../chests'

export type { WorldgenContentResolveOptions } from './content-common'

const PROP_KIND_SET = new Set<string>(PROP_KINDS)
const TRIGGER_SOURCES = new Set<ZoneTriggerSource>(['player', 'arrow'])
const RAIL_CART_FACINGS = new Set<RailCartFacing>(['north', 'east', 'south', 'west'])
// Zone kinds the runtime understands (see src/engine/ecs/zones.ts consumers),
// plus 'custom' for script-handled generic zones. Unknown kinds compile to a
// zone the runtime silently ignores, so reject them instead.
const ZONE_KINDS = new Set<string>(['trigger', 'interact', 'arrival', 'portal', 'custom', 'killzone'])

export function resolveContent(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, opts: WorldgenContentResolveOptions = {}): void {
    const content = ctx.spec.content
    if (!content) return
    const resolveOpts = { ...opts, contentIndex: createContentResolutionIndex(content) }
    resolveContentProps(ctx, draft, content.props ?? [], resolveOpts)
    resolveContentZones(ctx, draft, content.zones ?? [], resolveOpts)
    resolveContentNpcs(ctx, draft, content.npcs ?? [], resolveOpts)
    resolveContentMetadata(ctx, draft, content, resolveOpts)
    resolveContentRailCarts(ctx, draft, content.rail_carts ?? [], resolveOpts)
    resolveContentChests(ctx, draft, content.chests ?? [], resolveOpts)
    resolveContentPickups(ctx, draft, content.pickups ?? [], resolveOpts)
    resolveContentShops(ctx, draft, content.shops ?? [])
    resolveContentQuests(ctx, draft, content.quests ?? [], resolveOpts)
    resolveContentScripts(ctx, draft, content.scripts ?? [])
}

function resolveContentChests(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    chests: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    for (let i = 0; i < chests.length; i += 1) {
        const spec = chests[i]!
        const path = `$.content.chests[${i}]`
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
        if (!id) continue
        const cell = readChestCell(ctx, spec, path, required, opts)
        if (!cell) continue
        const loot = readChestLoot(ctx, spec.loot, `${path}.loot`, required)
        if (!loot) continue
        // Fail closed like rail carts: a chest must land on an open cell. A
        // solid target would bury the chest inside terrain (or overwrite a
        // real block), so diagnose and skip rather than place it silently.
        const occupant = ctx.chunks.getVoxel(cell.x, cell.y, cell.z)
        if (occupant !== BLOCK.chest && occupant !== BLOCK.openChest && isCollidable(ctx.chunks.palette, occupant)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path} resolves to ${formatCell(cell)}, which is a solid block — a chest there would be buried. Place it on an open cell.`,
                path,
                details: { id, cell, block: occupant },
            })
            continue
        }
        ctx.setVoxel(cell.x, cell.y, cell.z, BLOCK.chest)
        draft.chests.push({
            id,
            cell,
            loot,
            prompt: typeof spec.prompt === 'string' ? spec.prompt : undefined,
            interactionRadius: positiveNumber(spec.interactionRadius ?? spec.interaction_radius, 1.85),
        })
        const position = { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }
        ctx.resolveObject(id, position)
        ctx.report.placements.push({ id, kind: 'content_chest', cell, lootCount: loot.length })
    }
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
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
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
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
        if (!id) continue
        const center = resolveContentPosition(ctx, spec, path, required, opts)
        if (!center) continue
        const type = readString(spec.type ?? spec.kind, 'trigger')
        const kind = type === 'interact' || type === 'arrival' || type === 'portal' ? type : readString(spec.kind, type)
        if (!ZONE_KINDS.has(kind)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path} has unknown zone kind "${kind}". Expected one of: ${[...ZONE_KINDS].join(', ')}.`,
                path: `${path}.type`,
                details: { id, kind },
            })
            continue
        }
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
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
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
        // Two-phase precedence. `applyNpcTemplate` builds the archetype with the
        // template winning over `partial` for most fields, then we overlay the
        // author's explicit `partial` fields on top so spec values win again.
        // `partial` only carries keys the author actually set (see npcPartial),
        // so the `?? templated` fallbacks below just keep the template's value
        // for these optional objects when the author omitted them.
        const templated = template ? applyNpcTemplate(partial, template) : normalizeNpcConfig(partial)
        const templateScript = partial.scriptSource === undefined && templateId
            ? markTemplateScript(templateId, templated.scriptSource)
            : templated.scriptSource
        const npc = normalizeNpcConfig({
            ...templated,
            ...partial,
            equipment: partial.equipment ?? templated.equipment,
            voice: partial.voice ?? templated.voice,
            behaviour: partial.behaviour ?? templated.behaviour,
            scriptSource: partial.scriptSource ?? templateScript,
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
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
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
        appendAuthoredScript(ctx, draft, entry, `${path}.id`, required)
    }
}

function resolveContentRailCarts(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    railCarts: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    for (let i = 0; i < railCarts.length; i += 1) {
        const spec = railCarts[i]!
        const path = `$.content.rail_carts[${i}]`
        const required = contentEntryRequired(spec)
        const id = contentId(ctx, spec, path, required)
        if (!id) continue
        const railCell = readRailCartCell(ctx, spec, path, required, opts)
        if (!railCell) continue
        const front = readRailCartFacing(ctx, spec.front ?? spec.facing, `${path}.front`, required)
        if (!front) continue
        if (!isRailBlock(ctx.chunks.palette, ctx.chunks.getVoxel(railCell.x, railCell.y, railCell.z))) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path} resolves to ${formatCell(railCell)}, but that voxel is not a rail block.`,
                path: spec.railCell !== undefined || spec.rail_cell !== undefined ? `${path}.railCell` : path,
                details: { id, railCell },
            })
            continue
        }
        draft.railCarts.push({
            id,
            railCell,
            front,
            speed: positiveNumber(spec.speed, 4),
            interactionRadius: positiveNumber(spec.interactionRadius ?? spec.interaction_radius, 1.75),
            enabled: typeof spec.enabled === 'boolean' ? spec.enabled : true,
        })
        const position = { x: railCell.x + 0.5, y: railCell.y, z: railCell.z + 0.5 }
        ctx.resolveObject(id, position)
        ctx.report.placements.push({ id, kind: 'content_rail_cart', railCell, front, enabled: spec.enabled !== false })
    }
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

function readRailCartCell(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    required: boolean,
    opts: WorldgenContentResolveOptions,
): VoxelCoord | null {
    const explicit = spec.railCell ?? spec.rail_cell
    if (explicit !== undefined) {
        const cell = readVoxelCoord(explicit, true)
        if (!cell) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.railCell must be a [x, y, z] tuple or { x, y, z } object.`,
                path: `${path}.railCell`,
                details: { value: explicit },
            })
            return null
        }
        if (!ctx.inXYZ(cell.x, cell.y, cell.z)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.railCell leaves world bounds.`,
                path: `${path}.railCell`,
                details: { railCell: cell },
            })
            return null
        }
        return cell
    }

    const position = resolveContentPosition(ctx, spec, path, required, opts)
    if (!position) return null
    const cell = {
        x: Math.floor(position.x),
        y: Math.round(position.y),
        z: Math.floor(position.z),
    }
    if (!ctx.inXYZ(cell.x, cell.y, cell.z)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} resolves to an out-of-bounds rail cell.`,
            path,
            details: { position, railCell: cell },
        })
        return null
    }
    return cell
}

function readChestCell(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    required: boolean,
    opts: WorldgenContentResolveOptions,
): VoxelCoord | null {
    const explicit = spec.cell ?? spec.chestCell ?? spec.chest_cell ?? spec.voxel
    if (explicit !== undefined) {
        const cell = readVoxelCoord(explicit, true)
        if (!cell) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.cell must be a [x, y, z] tuple or { x, y, z } object.`,
                path: `${path}.cell`,
                details: { value: explicit },
            })
            return null
        }
        if (!ctx.inXYZ(cell.x, cell.y, cell.z)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${path}.cell leaves world bounds.`,
                path: `${path}.cell`,
                details: { cell },
            })
            return null
        }
        return cell
    }

    const position = resolveContentPosition(ctx, spec, path, required, opts)
    if (!position) return null
    const cell = {
        x: Math.floor(position.x),
        y: Math.round(position.y),
        z: Math.floor(position.z),
    }
    if (!ctx.inXYZ(cell.x, cell.y, cell.z)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} resolves to an out-of-bounds chest cell.`,
            path,
            details: { position, cell },
        })
        return null
    }
    return cell
}

function readChestLoot(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): LootChestItem[] | null {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be an array.`,
            path,
            details: { value },
        })
        return null
    }
    const out: LootChestItem[] = []
    for (let i = 0; i < value.length; i += 1) {
        const itemPath = `${path}[${i}]`
        const item = readChestLootItem(ctx, value[i], itemPath, required)
        if (item) out.push(item)
    }
    return out
}

function readChestLootItem(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): LootChestItem | null {
    if (typeof value === 'string') {
        const id = value.trim()
        if (id) return { id, quantity: 1 }
    }
    if (!isRecord(value)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be an item id string or an object with id/resource/kind.`,
            path,
            details: { value },
        })
        return null
    }
    const id = readString(value.id ?? value.itemId ?? value.item_id ?? value.resource ?? value.kind, '')
    if (!id) {
        contentDiagnostic(ctx, required, {
            code: 'missing_id',
            message: `${path}.id is required for chest loot.`,
            path: `${path}.id`,
            details: { value },
        })
        return null
    }
    const quantity = Math.max(1, Math.floor(finiteNumber(value.quantity ?? value.amount, 1)))
    return {
        id,
        quantity,
        name: typeof value.name === 'string' ? value.name : undefined,
        description: typeof value.description === 'string' ? value.description : undefined,
        category: typeof value.category === 'string' ? value.category as LootChestItem['category'] : undefined,
        icon: typeof value.icon === 'string' ? value.icon as LootChestItem['icon'] : undefined,
    }
}

function readRailCartFacing(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): RailCartFacing | null {
    const facing = readString(value, 'east')
    if (RAIL_CART_FACINGS.has(facing as RailCartFacing)) return facing as RailCartFacing
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be north, east, south, or west.`,
        path,
        details: { value },
    })
    return null
}

function formatCell(cell: VoxelCoord): string {
    return `${cell.x},${cell.y},${cell.z}`
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

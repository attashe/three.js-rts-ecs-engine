import type { PickupSpawnOptions } from '../../engine/script/types'
import type { ContentEntrySpec } from './spec-types'
import { WorldgenCompileContext } from './compile-context'
import type { WorldgenLevelDraft } from './level-draft'
import {
    appendGeneratedScript,
    appendNpcScript,
    contentDiagnostic,
    contentEntryRequired,
    contentId,
    finiteNumber,
    isRecord,
    readRequiredString,
    readString,
    resolveContentTarget,
    scriptLiteral,
    type WorldgenContentResolveOptions,
} from './content-common'
import { readGeneratedPickup, type GeneratedPickup } from './resolve-pickups'

interface QuestRequiredItem {
    id: string
    quantity: number
}

interface QuestRewardItem {
    id: string
    quantity: number
    options?: PickupSpawnOptions['inventoryItem']
}

interface QuestReward {
    gold?: number
    arrows?: number
    mana?: number
    items?: QuestRewardItem[]
}

interface QuestDialogue {
    start: DialogueLineSpec[]
    active: DialogueLineSpec[]
    ready: DialogueLineSpec[]
    complete: DialogueLineSpec[]
    done: DialogueLineSpec[]
}

interface DialogueLineSpec {
    speaker?: string
    text: string
    choices?: Array<{ id: string; text: string; disabled?: boolean }>
}

export function resolveContentQuests(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    quests: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    for (let i = 0; i < quests.length; i += 1) resolveContentQuest(ctx, draft, quests[i]!, `$.content.quests[${i}]`, opts)
}

function resolveContentQuest(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    spec: ContentEntrySpec,
    path: string,
    opts: WorldgenContentResolveOptions,
): void {
    const required = contentEntryRequired(spec)
    const id = contentId(ctx, spec, path, required)
    if (!id) return
    const questType = readString(spec.type, 'collect_return')
    if (questType !== 'collect_return' && questType !== 'collect-and-return') {
        contentDiagnostic(ctx, required, {
            code: 'unsupported_feature',
            message: `${path}.type "${questType}" is not supported in Phase 7. Use "collect_return".`,
            path: `${path}.type`,
            details: { id, type: questType },
        })
        return
    }
    const targetValue = spec.target ?? spec.targetId ?? spec.target_id ?? spec.npc_id ?? spec.zone_id ?? (typeof spec.npc === 'string' ? spec.npc : undefined)
    const target = resolveContentTarget(ctx, draft, targetValue, `${path}.target`, required)
    if (!target) return
    const pickups = readQuestPickups(ctx, spec.pickups, `${path}.pickups`, opts, required)
    if (!pickups) return
    const requiredItems = readQuestRequiredItems(ctx, spec.requiredItems ?? spec.required_items, `${path}.requiredItems`, required)
        ?? pickups.map((pickup) => ({
            id: pickup.inventoryItem?.id ?? pickup.kind,
            quantity: pickup.amount ?? 1,
        }))
    if (requiredItems.length === 0) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must declare pickups or requiredItems.`,
            path,
            details: { id },
        })
        return
    }
    const reward = readQuestReward(ctx, spec.reward, `${path}.reward`, required)
    if (reward === null) return
    const dialogue = readQuestDialogue(spec)
    const title = readString(spec.title ?? spec.name, id)
    const consumeItems = typeof spec.consumeItems === 'boolean'
        ? spec.consumeItems
        : typeof spec.consume_items === 'boolean'
            ? spec.consume_items
            : true
    const speaker = isRecord(spec.speaker) ? spec.speaker : isRecord(spec.npc) ? spec.npc : null
    const source = questScriptSource({
        id,
        title,
        npcBound: target.kind === 'npc',
        targetId: target.id,
        stateFlag: readString(spec.stateFlag ?? spec.state_flag, `worldgen.quest.${id}.state`),
        rewardFlag: readString(spec.rewardFlag ?? spec.reward_flag, `worldgen.quest.${id}.rewarded`),
        pickups,
        requiredItems,
        consumeItems,
        reward,
        dialogue,
        speaker,
    })

    if (target.kind === 'npc') {
        if (!appendNpcScript(ctx, draft, target.id, source, `${path}.target`, required)) return
    } else if (!appendGeneratedScript(ctx, draft, {
        id: `worldgen:quest:${id}`,
        name: `worldgen-quest-${id}.js`,
        source,
    }, path, required)) {
        return
    }
    ctx.report.placements.push({ id, kind: 'content_quest', target: target.id, targetKind: target.kind, pickupCount: pickups.length, requiredItemCount: requiredItems.length })
}

function readQuestPickups(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    opts: WorldgenContentResolveOptions,
    required: boolean,
): GeneratedPickup[] | null {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be an array when provided.`,
            path,
            details: { value },
        })
        return null
    }
    const out: GeneratedPickup[] = []
    for (let i = 0; i < value.length; i += 1) {
        const item = value[i]
        const itemPath = `${path}[${i}]`
        if (!isRecord(item)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${itemPath} must be an object.`,
                path: itemPath,
                details: { value: item },
            })
            continue
        }
        const pickup = readGeneratedPickup(ctx, item as ContentEntrySpec, itemPath, opts, required)
        if (pickup) out.push(pickup)
    }
    return out
}

function readQuestRequiredItems(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): QuestRequiredItem[] | null {
    if (value === undefined) return null
    if (!Array.isArray(value)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be an array when provided.`,
            path,
            details: { value },
        })
        return null
    }
    const out: QuestRequiredItem[] = []
    for (let i = 0; i < value.length; i += 1) {
        const item = value[i]
        const itemPath = `${path}[${i}]`
        if (!isRecord(item)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${itemPath} must be an object.`,
                path: itemPath,
                details: { value: item },
            })
            continue
        }
        const id = readRequiredString(ctx, item.id ?? item.itemId ?? item.item_id ?? item.kind, `${itemPath}.id`, required)
        const quantity = readPositiveInteger(ctx, item.quantity ?? item.amount, `${itemPath}.quantity`, required, 1)
        if (id && quantity !== null) out.push({ id, quantity })
    }
    return out
}

function readQuestReward(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): QuestReward | null {
    if (value === undefined) return {}
    if (!isRecord(value)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be an object when provided.`,
            path,
            details: { value },
        })
        return null
    }
    const reward: QuestReward = {}
    const gold = readOptionalNonNegativeInteger(ctx, value.gold, `${path}.gold`, required)
    const arrows = readOptionalNonNegativeInteger(ctx, value.arrows, `${path}.arrows`, required)
    const mana = readOptionalNonNegativeInteger(ctx, value.mana, `${path}.mana`, required)
    if (gold === null || arrows === null || mana === null) return null
    if (gold !== undefined) reward.gold = gold
    if (arrows !== undefined) reward.arrows = arrows
    if (mana !== undefined) reward.mana = mana
    const items = readRewardItems(ctx, value.items, `${path}.items`, required)
    if (items === null) return null
    if (items.length > 0) reward.items = items
    return reward
}

function readRewardItems(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): QuestRewardItem[] | null {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be an array when provided.`,
            path,
            details: { value },
        })
        return null
    }
    const out: QuestRewardItem[] = []
    for (let i = 0; i < value.length; i += 1) {
        const item = value[i]
        const itemPath = `${path}[${i}]`
        if (!isRecord(item)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${itemPath} must be an object.`,
                path: itemPath,
                details: { value: item },
            })
            continue
        }
        const id = readRequiredString(ctx, item.id ?? item.itemId ?? item.item_id, `${itemPath}.id`, required)
        const quantity = readPositiveInteger(ctx, item.quantity ?? item.amount, `${itemPath}.quantity`, required, 1)
        if (!id || quantity === null) continue
        out.push({
            id,
            quantity,
            ...(isRecord(item.options) ? { options: { ...item.options } as PickupSpawnOptions['inventoryItem'] } : {}),
        })
    }
    return out
}

function readQuestDialogue(spec: ContentEntrySpec): QuestDialogue {
    const dialogue = isRecord(spec.dialogue) ? spec.dialogue : {}
    return {
        start: readDialogueLines(dialogue.start ?? spec.start, 'I need your help. Bring me the requested supplies.'),
        active: readDialogueLines(dialogue.active, 'The supplies are still out there.'),
        ready: readDialogueLines(dialogue.ready, 'You found them. Hand them over?'),
        complete: readDialogueLines(dialogue.complete ?? spec.complete, 'Thank you. Take this for the road.'),
        done: readDialogueLines(dialogue.done, 'Safe travels.'),
    }
}

function readDialogueLines(value: unknown, fallback: string): DialogueLineSpec[] {
    if (typeof value === 'string' && value.trim().length > 0) return [{ speaker: 'npc', text: value.trim() }]
    if (Array.isArray(value)) {
        const out: DialogueLineSpec[] = []
        for (const entry of value) {
            if (typeof entry === 'string' && entry.trim().length > 0) {
                out.push({ speaker: 'npc', text: entry.trim() })
            } else if (isRecord(entry) && typeof entry.text === 'string' && entry.text.trim().length > 0) {
                out.push({
                    ...(typeof entry.speaker === 'string' ? { speaker: entry.speaker } : { speaker: 'npc' }),
                    text: entry.text.trim(),
                    ...(Array.isArray(entry.choices) ? { choices: entry.choices as DialogueLineSpec['choices'] } : {}),
                })
            }
        }
        if (out.length > 0) return out
    }
    return [{ speaker: 'npc', text: fallback }]
}

function questScriptSource(spec: {
    id: string
    title: string
    npcBound: boolean
    targetId: string
    stateFlag: string
    rewardFlag: string
    pickups: readonly GeneratedPickup[]
    requiredItems: readonly QuestRequiredItem[]
    consumeItems: boolean
    reward: QuestReward
    dialogue: QuestDialogue
    speaker: Record<string, unknown> | null
}): string {
    const suffix = scriptIdent(spec.id)
    const targetExpr = spec.npcBound ? 'NPC_INTERACTION' : scriptLiteral(spec.targetId)
    const staticSpeaker = spec.speaker ? scriptLiteral(spec.speaker) : 'null'
    const npcSpeakerExpr = spec.npcBound
        ? `(QUEST_${suffix}.speaker ?? { id: NPC_ID, name: NPC_NAME, avatar: 'npc', voice: NPC_VOICE })`
        : `(QUEST_${suffix}.speaker ?? { id: 'npc', name: QUEST_${suffix}.title, avatar: 'npc' })`
    return [
        `const QUEST_${suffix} = ${scriptLiteral({ ...spec, speaker: spec.speaker })}`,
        `QUEST_${suffix}.speaker = ${staticSpeaker}`,
        ``,
        `on('level-start', () => {`,
        `  ensureQuestPickups_${suffix}()`,
        `})`,
        ``,
        `on('pickup-taken', {}, (event) => {`,
        `  const pickup = QUEST_${suffix}.pickups.find((entry) => entry.id === event.pickupId)`,
        `  if (!pickup) return`,
        `  flags.set(pickup.flag, true)`,
        `  if (questItemsReady_${suffix}() && questState_${suffix}() !== 'done') flags.set(QUEST_${suffix}.stateFlag, 'ready')`,
        `})`,
        ``,
        `on('input', { action: 'interact', targetId: ${targetExpr} }, async () => {`,
        `  await handleQuest_${suffix}()`,
        `})`,
        ``,
        `async function handleQuest_${suffix}() {`,
        `  const state = questState_${suffix}()`,
        `  if (state === 'done') {`,
        `    await questDialogue_${suffix}(QUEST_${suffix}.dialogue.done)`,
        `    return`,
        `  }`,
        `  if (questItemsReady_${suffix}()) {`,
        `    if (QUEST_${suffix}.consumeItems) {`,
        `      for (const item of QUEST_${suffix}.requiredItems) player.removeInventoryItem(item.id, item.quantity)`,
        `    }`,
        `    flags.set(QUEST_${suffix}.stateFlag, 'done')`,
        `    grantQuestReward_${suffix}()`,
        `    await questDialogue_${suffix}(QUEST_${suffix}.dialogue.complete)`,
        `    return`,
        `  }`,
        `  if (state === 'ready') {`,
        `    await questDialogue_${suffix}(QUEST_${suffix}.dialogue.ready)`,
        `    return`,
        `  }`,
        `  if (state !== 'active') flags.set(QUEST_${suffix}.stateFlag, 'active')`,
        `  await questDialogue_${suffix}(state === 'active' ? QUEST_${suffix}.dialogue.active : QUEST_${suffix}.dialogue.start)`,
        `  ensureQuestPickups_${suffix}()`,
        `}`,
        ``,
        `function ensureQuestPickups_${suffix}() {`,
        `  if (questState_${suffix}() === 'done') return`,
        `  for (const pickup of QUEST_${suffix}.pickups) {`,
        `    if (flags.get(pickup.flag) === true) continue`,
        `    const inventoryId = pickup.inventoryItem?.id ?? pickup.kind`,
        `    const amount = pickup.amount ?? 1`,
        `    if (pickup.skipIfInInventory && player.inventory.has(inventoryId, amount)) {`,
        `      flags.set(pickup.flag, true)`,
        `      continue`,
        `    }`,
        `    if (!pickups.exists(pickup.id)) pickups.spawn(pickup.kind, pickup.position, { id: pickup.id, amount: pickup.amount, label: pickup.label, inventoryItem: pickup.inventoryItem })`,
        `  }`,
        `}`,
        ``,
        `function questItemsReady_${suffix}() {`,
        `  return QUEST_${suffix}.requiredItems.every((item) => player.inventory.has(item.id, item.quantity))`,
        `}`,
        ``,
        `function grantQuestReward_${suffix}() {`,
        `  if (flags.get(QUEST_${suffix}.rewardFlag) === true) return`,
        `  flags.set(QUEST_${suffix}.rewardFlag, true)`,
        `  const reward = QUEST_${suffix}.reward`,
        `  if (reward.gold) player.setGold(player.inventory.gold + reward.gold)`,
        `  if (reward.arrows) player.setArrows(player.inventory.arrows + reward.arrows)`,
        `  if (reward.mana) player.restoreMana(reward.mana)`,
        `  for (const item of reward.items ?? []) player.addInventoryItem(item.id, item.quantity, item.options ?? {})`,
        `  audio.play('sfx.quest.fanfare')`,
        `}`,
        ``,
        `function questState_${suffix}() {`,
        `  return flags.get(QUEST_${suffix}.stateFlag) ?? 'unknown'`,
        `}`,
        ``,
        `function questDialogue_${suffix}(lines) {`,
        `  return ui.dialogue({`,
        `    title: QUEST_${suffix}.title,`,
        `    npc: ${npcSpeakerExpr},`,
        `    player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },`,
        `    lines,`,
        `  })`,
        `}`,
    ].join('\n')
}

function readPositiveInteger(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean, fallback: number): number | null {
    if (value === undefined) return fallback
    const amount = finiteNumber(value, Number.NaN)
    if (Number.isInteger(amount) && amount > 0) return amount
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a positive integer.`,
        path,
        details: { value },
    })
    return null
}

function readOptionalNonNegativeInteger(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): number | undefined | null {
    if (value === undefined) return undefined
    const amount = finiteNumber(value, Number.NaN)
    if (Number.isInteger(amount) && amount >= 0) return amount
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a non-negative integer.`,
        path,
        details: { value },
    })
    return null
}

function scriptIdent(id: string): string {
    const cleaned = id.replace(/[^A-Za-z0-9_$]/g, '_')
    return /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`
}

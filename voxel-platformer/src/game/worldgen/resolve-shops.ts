import type { TradeItem, TradeResource, TradeRequest } from '../../engine/script/types'
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
    scriptIdent,
    scriptLiteral,
} from './content-common'

const TRADE_RESOURCES = new Set<TradeResource>([
    'arrows',
    'heal-potion',
    'mana-potion',
    'food-apple',
    'food-fish',
    'food-meat',
    'food-pie',
    'dynamite',
    'high-jump-boots',
    'high-speed-boots',
    'hat-arcane',
    'hat-ranger',
    'hat-sniper',
    'hat-sun',
    'metal-helmet',
    'spear',
])

export function resolveContentShops(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    shops: readonly ContentEntrySpec[],
): void {
    for (let i = 0; i < shops.length; i += 1) resolveContentShop(ctx, draft, shops[i]!, `$.content.shops[${i}]`)
}

function resolveContentShop(ctx: WorldgenCompileContext, draft: WorldgenLevelDraft, spec: ContentEntrySpec, path: string): void {
    const required = contentEntryRequired(spec)
    const id = contentId(ctx, spec, path, required)
    if (!id) return
    const targetValue = spec.target ?? spec.targetId ?? spec.target_id ?? spec.npc_id ?? spec.zone_id ?? (typeof spec.npc === 'string' ? spec.npc : undefined)
    const target = resolveContentTarget(ctx, draft, targetValue, `${path}.target`, required)
    if (!target) return
    const items = readTradeItems(ctx, spec.items, `${path}.items`, required)
    if (!items) return
    const request: TradeRequest = {
        id,
        title: readString(spec.title, readString(spec.name, 'Shop')),
        ...(isRecord(spec.npc) ? { npc: spec.npc as unknown as TradeRequest['npc'] } : {}),
        ...(spec.currency === 'gold' ? { currency: 'gold' as const } : {}),
        items,
    }
    const source = shopScriptSource(id, target.id, request, target.kind === 'npc')

    if (target.kind === 'npc') {
        if (!appendNpcScript(ctx, draft, target.id, source, `${path}.target`, required, { replaceMarkedTemplateScript: true })) return
    } else if (!appendGeneratedScript(ctx, draft, {
        id: `worldgen:shop:${id}`,
        name: `worldgen-shop-${id}.js`,
        source,
    }, path, required)) {
        return
    }

    ctx.report.placements.push({ id, kind: 'content_shop', target: target.id, targetKind: target.kind, itemCount: items.length })
}

function readTradeItems(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): TradeItem[] | null {
    if (!Array.isArray(value) || value.length === 0) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be a non-empty array of trade items.`,
            path,
            details: { value },
        })
        return null
    }
    const out: TradeItem[] = []
    for (let i = 0; i < value.length; i += 1) {
        const itemPath = `${path}[${i}]`
        const item = value[i]
        if (!isRecord(item)) {
            contentDiagnostic(ctx, required, {
                code: 'invalid_feature',
                message: `${itemPath} must be an object.`,
                path: itemPath,
                details: { value: item },
            })
            continue
        }
        const id = readRequiredString(ctx, item.id, `${itemPath}.id`, required)
        const name = readRequiredString(ctx, item.name, `${itemPath}.name`, required)
        const resource = readTradeResource(ctx, item.resource, `${itemPath}.resource`, required)
        if (!id || !name || !resource) continue
        const tradeItem: TradeItem = {
            id,
            name,
            ...(typeof item.description === 'string' ? { description: item.description } : {}),
            resource,
            ...(readOptionalPositiveInteger(ctx, item.unitSize ?? item.unit_size, `${itemPath}.unitSize`, required) ?? {}),
            ...(readOptionalNonNegativeNumber(ctx, item.buyPrice ?? item.buy_price, `${itemPath}.buyPrice`, required, 'buyPrice') ?? {}),
            ...(readOptionalNonNegativeNumber(ctx, item.sellPrice ?? item.sell_price, `${itemPath}.sellPrice`, required, 'sellPrice') ?? {}),
            ...(readOptionalPositiveInteger(ctx, item.stock, `${itemPath}.stock`, required, 'stock') ?? {}),
            ...(typeof item.disabled === 'boolean' ? { disabled: item.disabled } : {}),
        }
        out.push(tradeItem)
    }
    return out.length > 0 ? out : null
}

function readTradeResource(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): TradeResource | null {
    if (typeof value === 'string' && TRADE_RESOURCES.has(value as TradeResource)) return value as TradeResource
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a known trade resource.`,
        path,
        details: { value },
    })
    return null
}

function readOptionalPositiveInteger(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
    key = 'unitSize',
): Pick<TradeItem, 'unitSize' | 'stock'> | null | undefined {
    if (value === undefined) return undefined
    const amount = finiteNumber(value, Number.NaN)
    if (Number.isInteger(amount) && amount > 0) return { [key]: amount } as Pick<TradeItem, 'unitSize' | 'stock'>
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a positive integer.`,
        path,
        details: { value },
    })
    return null
}

function readOptionalNonNegativeNumber(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
    key: 'buyPrice' | 'sellPrice',
): Pick<TradeItem, 'buyPrice' | 'sellPrice'> | null | undefined {
    if (value === undefined) return undefined
    const price = finiteNumber(value, Number.NaN)
    if (Number.isFinite(price) && price >= 0) return { [key]: price }
    contentDiagnostic(ctx, required, {
        code: 'invalid_feature',
        message: `${path} must be a non-negative number.`,
        path,
        details: { value },
    })
    return null
}

function shopScriptSource(id: string, targetId: string, request: TradeRequest, npcBound: boolean): string {
    const suffix = scriptIdent(id)
    const targetExpr = npcBound ? 'NPC_INTERACTION' : scriptLiteral(targetId)
    const requestExpr = npcBound
        ? `{ ...SHOP_${suffix}, npc: SHOP_${suffix}.npc ?? { id: NPC_ID, name: NPC_NAME, avatar: 'npc', voice: NPC_VOICE } }`
        : `SHOP_${suffix}`
    return [
        `const SHOP_${suffix} = ${scriptLiteral(request)}`,
        ``,
        `on('input', { action: 'interact', targetId: ${targetExpr} }, async () => {`,
        `  const result = await trade.open(${requestExpr})`,
        `  if (result.status === 'bought') {`,
        `    ui.say(${targetExpr}, \`Bought \${result.itemName}.\`, { seconds: 2.5 })`,
        `  } else if (result.status === 'sold') {`,
        `    ui.say(${targetExpr}, \`Sold \${result.itemName}.\`, { seconds: 2.5 })`,
        `  } else if (result.status === 'unavailable') {`,
        `    ui.say(${targetExpr}, result.reason ?? 'That trade is unavailable.', { seconds: 2.5 })`,
        `  }`,
        `})`,
    ].join('\n')
}

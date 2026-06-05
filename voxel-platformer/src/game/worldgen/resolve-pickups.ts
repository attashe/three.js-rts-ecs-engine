import type { PickupSpawnOptions } from '../../engine/script/types'
import type { ContentEntrySpec, VoxelCoord } from './spec-types'
import { WorldgenCompileContext } from './compile-context'
import type { WorldgenLevelDraft } from './level-draft'
import {
    appendGeneratedScript,
    contentDiagnostic,
    contentEntryRequired,
    contentId,
    finiteNumber,
    isRecord,
    readRequiredString,
    readString,
    resolveContentPosition,
    scriptConst,
    scriptLines,
    type WorldgenContentResolveOptions,
} from './content-common'

export interface GeneratedPickup {
    id: string
    kind: string
    position: VoxelCoord
    amount?: number
    label?: string
    inventoryItem?: PickupSpawnOptions['inventoryItem']
    flag: string
    skipIfInInventory: boolean
}

export function resolveContentPickups(
    ctx: WorldgenCompileContext,
    draft: WorldgenLevelDraft,
    pickups: readonly ContentEntrySpec[],
    opts: WorldgenContentResolveOptions,
): void {
    const resolved: GeneratedPickup[] = []
    for (let i = 0; i < pickups.length; i += 1) {
        const pickup = readGeneratedPickup(ctx, pickups[i]!, `$.content.pickups[${i}]`, opts)
        if (pickup) resolved.push(pickup)
    }
    if (resolved.length === 0) return

    appendGeneratedScript(ctx, draft, {
        id: 'worldgen:content:pickups',
        name: 'worldgen-content-pickups.js',
        source: generatedPickupsScript(resolved),
    }, '$.content.pickups', true)
}

export function readGeneratedPickup(
    ctx: WorldgenCompileContext,
    spec: ContentEntrySpec,
    path: string,
    opts: WorldgenContentResolveOptions,
    requiredOverride?: boolean,
): GeneratedPickup | null {
    const required = requiredOverride ?? contentEntryRequired(spec)
    const id = contentId(ctx, spec, path, required)
    if (!id) return null
    const kind = readRequiredString(ctx, spec.kind ?? spec.itemId ?? spec.item_id ?? spec.resource ?? id, `${path}.kind`, required)
    if (!kind) return null
    const position = resolveContentPosition(ctx, spec, path, required, opts)
    if (!position) return null
    const amount = readPickupAmount(ctx, spec.amount ?? spec.quantity, `${path}.amount`, required)
    if (amount === null) return null
    const inventoryItem = readInventoryItem(ctx, spec.inventoryItem ?? spec.inventory_item, `${path}.inventoryItem`, required)
    const label = readString(spec.label ?? spec.name, '')
    const flag = readString(spec.flag, `worldgen.pickup.${id}.taken`)
    const skipIfInInventory = typeof spec.skipIfInInventory === 'boolean'
        ? spec.skipIfInInventory
        : typeof spec.skip_if_in_inventory === 'boolean'
            ? spec.skip_if_in_inventory
            : false

    ctx.resolveObject(id, position)
    ctx.report.placements.push({ id, kind: 'content_pickup', pickupKind: kind, x: position.x, y: position.y, z: position.z })
    return {
        id,
        kind,
        position,
        ...(amount !== undefined ? { amount } : {}),
        ...(label ? { label } : {}),
        ...(inventoryItem ? { inventoryItem } : {}),
        flag,
        skipIfInInventory,
    }
}

export function generatedPickupsScript(pickups: readonly GeneratedPickup[]): string {
    return scriptLines([
        scriptConst('PICKUPS', pickups),
        ``,
        `on('level-start', () => {`,
        `  ensureWorldgenPickups()`,
        `})`,
        ``,
        `on('pickup-taken', {}, (event) => {`,
        `  const pickup = PICKUPS.find((entry) => entry.id === event.pickupId)`,
        `  if (pickup) flags.set(pickup.flag, true)`,
        `})`,
        ``,
        `function ensureWorldgenPickups() {`,
        `  for (const pickup of PICKUPS) {`,
        `    if (flags.get(pickup.flag) === true) continue`,
        `    const inventoryId = pickup.inventoryItem?.id ?? pickup.kind`,
        `    const amount = pickup.amount ?? 1`,
        `    if (pickup.skipIfInInventory && player.inventory.has(inventoryId, amount)) {`,
        `      continue`,
        `    }`,
        `    if (!pickups.exists(pickup.id)) {`,
        `      pickups.spawn(pickup.kind, pickup.position, {`,
        `        id: pickup.id,`,
        `        amount: pickup.amount,`,
        `        label: pickup.label,`,
        `        inventoryItem: pickup.inventoryItem,`,
        `      })`,
        `    }`,
        `  }`,
        `}`,
    ])
}

function readPickupAmount(ctx: WorldgenCompileContext, value: unknown, path: string, required: boolean): number | undefined | null {
    if (value === undefined) return undefined
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

function readInventoryItem(
    ctx: WorldgenCompileContext,
    value: unknown,
    path: string,
    required: boolean,
): PickupSpawnOptions['inventoryItem'] | undefined | null {
    if (value === undefined) return undefined
    if (!isRecord(value)) {
        contentDiagnostic(ctx, required, {
            code: 'invalid_feature',
            message: `${path} must be an object when provided.`,
            path,
            details: { value },
        })
        return null
    }
    return { ...value } as PickupSpawnOptions['inventoryItem']
}

import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import type { GameWorld, VoxelCoord } from '../engine/ecs/world'
import { pushLog, pushPopupMessage } from '../engine/ecs/world'
import type { InteractionProviderTarget } from './interaction-system'
import {
    addInventoryItem,
    copyInventoryItems,
    defaultInventoryItemName,
    normalizeInventoryItemId,
    type InventoryItemOptions,
} from './inventory'

export interface LootChestItem extends InventoryItemOptions {
    id: string
    quantity?: number
}

export interface LootChestConfig {
    id: string
    cell: VoxelCoord
    loot: LootChestItem[]
    prompt?: string
    interactionRadius?: number
}

export function copyLootChestConfig(chest: LootChestConfig): LootChestConfig {
    return {
        id: chest.id,
        cell: { ...chest.cell },
        loot: chest.loot.map((item) => ({ ...item })),
        prompt: chest.prompt,
        interactionRadius: chest.interactionRadius,
    }
}

export function nearestChestInteractionTarget(
    world: GameWorld,
    player: { eid: number; x: number; y: number; z: number },
    chunks: ChunkManager,
    chests: readonly LootChestConfig[],
    /** Fired with the chest's world anchor when a chest is actually opened
     *  (returns true). Lets the caller play an open cue without coupling this
     *  module to the audio engine. */
    onOpen?: (anchor: VoxelCoord) => void,
): InteractionProviderTarget | null {
    let best: InteractionProviderTarget | null = null
    for (const chest of chests) {
        if (chunks.getVoxel(chest.cell.x, chest.cell.y, chest.cell.z) !== BLOCK.chest) continue
        const anchor = chestAnchor(chest.cell)
        const radius = safePositive(chest.interactionRadius, 1.85)
        const dx = player.x - anchor.x
        const dy = player.y - anchor.y
        const dz = player.z - anchor.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 > radius * radius) continue
        if (best && d2 >= best.distanceSq) continue
        best = {
            id: `chest:${chest.id}`,
            prompt: chest.prompt || 'Open chest',
            anchor,
            distanceSq: d2,
            interact: () => {
                if (openLootChest(world, chunks, chest)) onOpen?.(chestAnchor(chest.cell))
            },
        }
    }
    return best
}

export function openLootChest(world: GameWorld, chunks: ChunkManager, chest: LootChestConfig): boolean {
    if (chunks.getVoxel(chest.cell.x, chest.cell.y, chest.cell.z) !== BLOCK.chest) return false
    chunks.setVoxel(chest.cell.x, chest.cell.y, chest.cell.z, BLOCK.openChest)
    if (chest.loot.length === 0) {
        pushLog(world, 'Opened an empty chest.')
        pushChestLootBubble(world, chest, 'Chest is empty.')
        return true
    }
    const granted: string[] = []
    for (const item of chest.loot) {
        const label = grantChestItem(world, item)
        if (label) granted.push(label)
    }
    // Mirror the granted inventory into playerSettings once, after the whole
    // loot list — copying the items map per item is O(items × loot).
    world.playerSettings.inventory.gold = world.inventory.gold
    world.playerSettings.inventory.arrows = world.inventory.arrows
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)
    if (granted.length > 0) {
        const loot = granted.join(', ')
        pushLog(world, `Chest loot: ${loot}.`)
        pushChestLootBubble(world, chest, `Looted: ${loot}.`)
    } else {
        pushLog(world, 'Opened an empty chest.')
        pushChestLootBubble(world, chest, 'Chest is empty.')
    }
    return true
}

function pushChestLootBubble(world: GameWorld, chest: LootChestConfig, message: string): void {
    pushPopupMessage(world, {
        targetId: `chest:${chest.id}`,
        anchor: chestAnchor(chest.cell),
        message,
        seconds: 3,
    })
}

function grantChestItem(world: GameWorld, item: LootChestItem): string | null {
    const id = normalizeInventoryItemId(item.id)
    const quantity = safeQuantity(item.quantity)
    if (!id || quantity <= 0) return null
    if (id === 'gold' || id === 'coin') {
        world.inventory.gold += quantity
        return `${quantity} gold`
    }
    if (id === 'arrow' || id === 'arrows') {
        world.inventory.arrows += quantity
        return `${quantity} ${quantity === 1 ? 'arrow' : 'arrows'}`
    }
    const options: InventoryItemOptions = {
        name: item.name,
        description: item.description,
        category: item.category,
        icon: item.icon,
    }
    addInventoryItem(world.inventory.items, id, quantity, options)
    return `${quantity} ${item.name || defaultInventoryItemName(id)}`
}

function chestAnchor(cell: VoxelCoord): VoxelCoord {
    return { x: cell.x + 0.5, y: cell.y + 1.1, z: cell.z + 0.5 }
}

function safePositive(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback
}

function safeQuantity(value: number | undefined): number {
    if (!Number.isFinite(value)) return 1
    return Math.max(1, Math.floor(value!))
}

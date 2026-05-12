import { hasComponent, query } from 'bitecs'
import { Health, PlayerControlled, PlayerResources, Position, Rotation, Shield } from '../engine/ecs/components'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { ActionMap } from '../engine/input/actions'
import type { GameHud, HudInventoryRequest } from '../ui'
import { addItemToBackpack, loadoutSlot, type GameWorld, type PlayerInventoryItem } from '../engine/ecs/world'
import { GameAction } from './actions'
import { aggregateInventoryCounts, recomputePlayerStats } from './items'
import { spawnDroppedInventoryItem } from './props'

export function createGameHudSystem(hud: GameHud, actions?: ActionMap): System {
    return {
        order: RenderOrder.debug - 20,
        update(world) {
            if (actions?.consumePressed(GameAction.ToggleInventory, 'hud')) {
                hud.setInventoryOpen(!hud.isInventoryOpen())
            }

            const players = query(world, [PlayerControlled, Health, Position])
            if (players.length === 0) return

            const player = players[0]
            const requests = hud.consumeInventoryRequests()
            let armoryTouched = false
            for (const request of requests) {
                if (applyInventoryRequest(world, player, request)) armoryTouched = true
            }
            if (armoryTouched) recomputePlayerStats(world)
            hud.setVitals({
                health: Health.current[player],
                maxHealth: Health.max[player],
                mana: hasComponent(world, player, PlayerResources) ? PlayerResources.mana[player] : 0,
                maxMana: hasComponent(world, player, PlayerResources) ? PlayerResources.maxMana[player] : 1,
                stamina: hasComponent(world, player, PlayerResources) ? PlayerResources.stamina[player] : 0,
                maxStamina: hasComponent(world, player, PlayerResources) ? PlayerResources.maxStamina[player] : 1,
            })
            hud.setInventory(aggregateInventoryCounts(world))
            hud.setLoadout(world.playerLoadout)
            hud.setPlayerStats(world.playerStats)
            hud.setShieldRaised(hasComponent(world, player, Shield) && Shield.raised[player] === 1)
        },
    }
}

/**
 * Apply a single HUD inventory request. Returns true when the change
 * touched the armory slots, so the caller can recompute aggregated player
 * stats (defense / weight). Weapon slot swaps don't yet feed back into
 * stats — that's the C-track combat hookup which reads the active item
 * directly at attack time.
 */
function applyInventoryRequest(world: GameWorld, player: number, request: HudInventoryRequest): boolean {
    const loadout = world.playerLoadout
    if (request.type === 'equipBackpack') {
        const item = loadout.backpackSlots[request.index]
        if (!item) return false
        if (request.target === 'weapon') {
            if (!isWeaponCompatible(item)) return false
            const existing = loadout.weaponSlots[request.slotIndex]?.item ?? null
            loadout.weaponSlots[request.slotIndex] = loadoutSlot(item)
            loadout.backpackSlots[request.index] = existing
            return false
        }

        const slot = loadout.armorySlots[request.slotIndex]
        if (!slot || item.equipSlot !== slot.slot) return false
        const existing = slot.item
        slot.item = item
        loadout.backpackSlots[request.index] = existing
        return true
    }

    if (request.type === 'equipSpell') {
        const item = loadout.spellSlots[request.index]
        if (!item?.loadoutKind) return false
        const existing = loadout.weaponSlots[request.slotIndex]?.item ?? null
        if (existing && existing.category !== 'spell') addItemToBackpack(world, existing)
        loadout.weaponSlots[request.slotIndex] = loadoutSlot(item)
        return false
    }

    if (request.type === 'clearWeapon') {
        const existing = loadout.weaponSlots[request.slotIndex]?.item ?? null
        if (existing && existing.category !== 'spell') addItemToBackpack(world, existing)
        loadout.weaponSlots[request.slotIndex] = loadoutSlot(null)
        return false
    }

    if (request.type === 'clearArmor') {
        const slot = loadout.armorySlots[request.slotIndex]
        if (!slot?.item) return false
        addItemToBackpack(world, slot.item)
        slot.item = null
        return true
    }

    const item = loadout.backpackSlots[request.index]
    if (!item) return false
    loadout.backpackSlots[request.index] = null
    // No separate counter to decrement — backpackSlots is the single source
    // of truth for stack counts now; the HUD reads aggregated counts via
    // aggregateInventoryCounts each frame.
    spawnDroppedInventoryItem(world, item, {
        position: dropPosition(player),
        yaw: hasComponent(world, player, Rotation) ? Rotation.y[player] : 0,
    })
    return false
}

function dropPosition(player: number): { x: number; y: number; z: number } {
    const yaw = Rotation.y[player] ?? 0
    return {
        x: Position.x[player] + Math.sin(yaw) * 1.1,
        y: Position.y[player],
        z: Position.z[player] + Math.cos(yaw) * 1.1,
    }
}

function isWeaponCompatible(item: PlayerInventoryItem): boolean {
    return item.equipSlot === 'weapon' || item.category === 'spell' || !!item.loadoutKind
}

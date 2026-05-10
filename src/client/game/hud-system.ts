import { hasComponent, query } from 'bitecs'
import { Health, PlayerControlled, PlayerResources, Position, Rotation, Shield } from '../engine/ecs/components'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { ActionMap } from '../engine/input/actions'
import type { GameHud, HudInventoryRequest } from '../ui'
import { addItemToBackpack, loadoutSlot, type GameWorld, type PlayerInventoryItem } from '../engine/ecs/world'
import { GameAction } from './actions'
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
            for (const request of hud.consumeInventoryRequests()) {
                applyInventoryRequest(world, player, request)
            }
            hud.setVitals({
                health: Health.current[player],
                maxHealth: Health.max[player],
                mana: hasComponent(world, player, PlayerResources) ? PlayerResources.mana[player] : 0,
                maxMana: hasComponent(world, player, PlayerResources) ? PlayerResources.maxMana[player] : 1,
                stamina: hasComponent(world, player, PlayerResources) ? PlayerResources.stamina[player] : 0,
                maxStamina: hasComponent(world, player, PlayerResources) ? PlayerResources.maxStamina[player] : 1,
            })
            hud.setInventory(world.playerInventory)
            hud.setLoadout(world.playerLoadout)
            hud.setShieldRaised(hasComponent(world, player, Shield) && Shield.raised[player] === 1)
        },
    }
}

function applyInventoryRequest(world: GameWorld, player: number, request: HudInventoryRequest): void {
    const loadout = world.playerLoadout
    if (request.type === 'equipBackpack') {
        const item = loadout.backpackSlots[request.index]
        if (!item) return
        if (request.target === 'weapon') {
            if (!isWeaponCompatible(item)) return
            const existing = loadout.weaponSlots[request.slotIndex]?.item ?? null
            loadout.weaponSlots[request.slotIndex] = loadoutSlot(item)
            loadout.backpackSlots[request.index] = existing
            return
        }

        const slot = loadout.armorySlots[request.slotIndex]
        if (!slot || item.equipSlot !== slot.slot) return
        const existing = slot.item
        slot.item = item
        loadout.backpackSlots[request.index] = existing
        return
    }

    if (request.type === 'equipSpell') {
        const item = loadout.spellSlots[request.index]
        if (!item?.loadoutKind) return
        const existing = loadout.weaponSlots[request.slotIndex]?.item ?? null
        if (existing && existing.category !== 'spell') addItemToBackpack(world, existing)
        loadout.weaponSlots[request.slotIndex] = loadoutSlot(item)
        return
    }

    if (request.type === 'clearWeapon') {
        const existing = loadout.weaponSlots[request.slotIndex]?.item ?? null
        if (existing && existing.category !== 'spell') addItemToBackpack(world, existing)
        loadout.weaponSlots[request.slotIndex] = loadoutSlot(null)
        return
    }

    if (request.type === 'clearArmor') {
        const slot = loadout.armorySlots[request.slotIndex]
        if (!slot?.item) return
        addItemToBackpack(world, slot.item)
        slot.item = null
        return
    }

    const item = loadout.backpackSlots[request.index]
    if (!item) return
    loadout.backpackSlots[request.index] = null
    decrementInventoryCount(world, item)
    spawnDroppedInventoryItem(world, item, {
        position: dropPosition(player),
        yaw: hasComponent(world, player, Rotation) ? Rotation.y[player] : 0,
    })
}

function dropPosition(player: number): { x: number; y: number; z: number } {
    const yaw = Rotation.y[player] ?? 0
    return {
        x: Position.x[player] + Math.sin(yaw) * 1.1,
        y: Position.y[player],
        z: Position.z[player] + Math.cos(yaw) * 1.1,
    }
}

function decrementInventoryCount(world: GameWorld, item: PlayerInventoryItem): void {
    const count = Math.max(1, item.count ?? 1)
    if (item.id === 'gold') world.playerInventory.gold = Math.max(0, world.playerInventory.gold - count)
    else if (item.id === 'health-potion') world.playerInventory.potions = Math.max(0, world.playerInventory.potions - count)
    else if (item.id === 'arrows') world.playerInventory.arrows = Math.max(0, world.playerInventory.arrows - count)
}

function isWeaponCompatible(item: PlayerInventoryItem): boolean {
    return item.equipSlot === 'weapon' || item.category === 'spell' || !!item.loadoutKind
}

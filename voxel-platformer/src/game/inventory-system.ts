import { query } from 'bitecs'
import { Health, PlayerControlled } from '../engine/ecs/components'
import { HP_PER_HEART } from '../engine/ecs/combat'
import type { GameWorld, WeaponStance } from '../engine/ecs/world'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { ActionMap } from '../engine/input/actions'
import type { Input } from '../engine/input/input'
import { PLAYER_ABILITY_KEYS, PLAYER_ABILITY_LABELS } from './player-settings'
import { GameAction } from './actions'
import { setWeaponStance } from './weapon-stance-system'
import { syncPlayerHeldTorchVisibility, syncPlayerVisuals } from './player'
import {
    EQUIPMENT_LABELS,
    HEAD_EQUIPMENT_KINDS,
    describeHandLoadout,
} from './anim/equipment-types'
import { SPELLS } from './spells'
import {
    INVENTORY_CATEGORIES,
    INVENTORY_CATEGORY_LABELS,
    copyInventoryItems,
    inventoryItemCount,
    listInventoryItems,
    removeInventoryItem,
    type InventoryCategoryId,
    type InventoryIconId,
    type InventorySnapshotItem,
} from './inventory'

interface InventoryDom {
    root: HTMLDivElement
    panel: HTMLDivElement
    loadout: HTMLDivElement
    spell: HTMLDivElement
    categories: HTMLDivElement
    stats: HTMLDivElement
    closeButton: HTMLButtonElement
    keyHint: HTMLSpanElement
}

interface LoadoutOption {
    stance: WeaponStance
    label: string
    hint: string
}

const LOADOUT_OPTIONS: readonly LoadoutOption[] = [
    { stance: 'melee', label: 'Melee', hint: 'Sword & shield — F swings, T blocks.' },
    { stance: 'ranged', label: 'Ranged', hint: 'Bow — F looses an arrow.' },
    { stance: 'magic', label: 'Magician', hint: 'Staff — F bonks, C casts the selected spell.' },
]

const HEAL_POTION_ITEM_ID = 'heal-potion'
const HEAL_POTION_RESTORE_HP = HP_PER_HEART

export function consumeHealPotion(world: GameWorld): boolean {
    const players = query(world, [PlayerControlled, Health])
    if (players.length === 0) return false
    const player = players[0]!
    const max = Health.max[player]!
    const current = Health.current[player]!
    if (!(max > 0) || current >= max) return false
    if (inventoryItemCount(world.inventory.items, HEAL_POTION_ITEM_ID) <= 0) return false
    if (!removeInventoryItem(world.inventory.items, HEAL_POTION_ITEM_ID, 1)) return false
    Health.current[player] = Math.min(max, current + HEAL_POTION_RESTORE_HP)
    world.playerSettings.inventory.items = copyInventoryItems(world.inventory.items)
    return true
}

export function createInventorySystem(input: Input, actions: ActionMap): System {
    let dom: InventoryDom | null = null
    let open = false
    let lastWorld: GameWorld | null = null

    const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.repeat) return
        if (open && (ev.code === 'Escape' || isInventoryKey(ev.code, actions))) {
            ev.preventDefault()
            ev.stopPropagation()
            ev.stopImmediatePropagation()
            setOpen(false)
            return
        }
        if (!open && isInventoryKey(ev.code, actions) && !hasBlockingOverlay()) {
            ev.preventDefault()
            ev.stopPropagation()
            ev.stopImmediatePropagation()
            setOpen(true)
        }
    }

    function setOpen(next: boolean): void {
        if (open === next) return
        open = next
        input.setEnabled(!open)
        input.clear()
        if (!dom) return
        dom.root.style.display = open ? 'grid' : 'none'
        dom.root.style.pointerEvents = open ? 'auto' : 'none'
        dom.root.setAttribute('aria-hidden', open ? 'false' : 'true')
        if (open) {
            if (lastWorld) renderInventory(dom, lastWorld)
            setTimeout(() => dom?.closeButton.focus(), 0)
        }
    }

    return {
        name: 'inventory',
        order: RenderOrder.debug + 8,
        init(world) {
            lastWorld = world
            dom = buildInventoryDom(actions.bindingDisplayKeysFor(GameAction.Inventory))
            dom.closeButton.addEventListener('click', () => setOpen(false))
            document.body.appendChild(dom.root)
            window.addEventListener('keydown', onKeyDown, { capture: true })
            setOpen(false)
        },
        update(world) {
            lastWorld = world
            if (!open || !dom) return
            // Don't re-render here: the game is paused while the menu is open,
            // so the contents are static, and rebuilding the DOM every frame
            // would destroy the loadout/spell buttons between mousedown and
            // mouseup — clicks would never land. Rendering happens on open and
            // after each selection instead.
            input.clear()
        },
        dispose() {
            window.removeEventListener('keydown', onKeyDown, true)
            input.setEnabled(true)
            dom?.root.remove()
            dom = null
            lastWorld = null
            open = false
        },
    }
}

function buildInventoryDom(keys: readonly string[]): InventoryDom {
    const root = document.createElement('div')
    root.id = 'voxel-platformer-inventory'
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1600',
        display: 'none',
        placeItems: 'center',
        padding: '18px',
        background: 'rgba(5, 8, 10, 0.45)',
        color: '#eef6f2',
        font: '14px ui-sans-serif, system-ui, sans-serif',
        pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>)

    const panel = document.createElement('div')
    Object.assign(panel.style, {
        width: 'min(980px, calc(100vw - 28px))',
        maxHeight: 'min(680px, calc(100vh - 28px))',
        overflow: 'auto',
        display: 'grid',
        gridTemplateRows: 'auto auto auto minmax(0, 1fr)',
        gap: '14px',
        padding: '18px',
        borderRadius: '8px',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        background: 'rgba(11, 16, 17, 0.96)',
        boxShadow: '0 26px 86px rgba(0, 0, 0, 0.52)',
    } satisfies Partial<CSSStyleDeclaration>)
    root.appendChild(panel)

    const header = document.createElement('div')
    Object.assign(header.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(header)

    const title = document.createElement('div')
    title.textContent = 'Inventory'
    Object.assign(title.style, {
        flex: '1',
        font: '700 22px ui-serif, Georgia, serif',
        color: '#f4f0dc',
    } satisfies Partial<CSSStyleDeclaration>)
    header.appendChild(title)

    const keyHint = document.createElement('span')
    keyHint.textContent = keys.length > 0 ? keys.join(' / ') : 'Tab'
    Object.assign(keyHint.style, {
        color: 'rgba(238, 246, 242, 0.62)',
        font: '700 11px ui-sans-serif, system-ui, sans-serif',
        textTransform: 'uppercase',
    } satisfies Partial<CSSStyleDeclaration>)
    header.appendChild(keyHint)

    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.textContent = 'Close'
    Object.assign(closeButton.style, buttonStyle())
    header.appendChild(closeButton)

    const loadout = document.createElement('div')
    Object.assign(loadout.style, {
        display: 'grid',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(loadout)

    const spell = document.createElement('div')
    Object.assign(spell.style, {
        display: 'grid',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(spell)

    const body = document.createElement('div')
    Object.assign(body.style, {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
        gap: '18px',
        minHeight: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(body)

    const categories = document.createElement('div')
    Object.assign(categories.style, {
        display: 'grid',
        gap: '14px',
        alignContent: 'start',
    } satisfies Partial<CSSStyleDeclaration>)
    body.appendChild(categories)

    const stats = document.createElement('div')
    Object.assign(stats.style, {
        alignSelf: 'start',
        border: '1px solid rgba(238, 246, 242, 0.14)',
        background: 'rgba(238, 246, 242, 0.055)',
        borderRadius: '8px',
        padding: '14px',
        minWidth: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    body.appendChild(stats)

    root.addEventListener('pointerdown', (ev) => {
        if (ev.target === root) closeButton.click()
    })

    return { root, panel, loadout, spell, categories, stats, closeButton, keyHint }
}

function renderInventory(dom: InventoryDom, world: GameWorld): void {
    dom.loadout.replaceChildren(...loadoutSection(dom, world))
    dom.spell.replaceChildren(...spellSection(dom, world))
    const grouped = groupInventoryItems(world)
    dom.categories.replaceChildren(...INVENTORY_CATEGORIES.map((category) =>
        categorySection(category, categoryCards(category, grouped.get(category) ?? [], dom, world)),
    ))
    dom.stats.replaceChildren(...statsSection(world))
}

function loadoutSection(dom: InventoryDom, world: GameWorld): HTMLElement[] {
    const title = document.createElement('div')
    title.textContent = 'Loadout'
    Object.assign(title.style, {
        color: 'rgba(244, 240, 220, 0.84)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        textTransform: 'uppercase',
    } satisfies Partial<CSSStyleDeclaration>)

    const row = document.createElement('div')
    Object.assign(row.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)

    for (const option of LOADOUT_OPTIONS) {
        row.appendChild(loadoutButton(dom, world, option))
    }
    return [title, row]
}

function loadoutButton(dom: InventoryDom, world: GameWorld, option: LoadoutOption): HTMLElement {
    const active = world.weaponStance === option.stance
    const button = document.createElement('button')
    button.type = 'button'
    button.title = option.hint
    Object.assign(button.style, {
        display: 'grid',
        gap: '3px',
        minWidth: '150px',
        padding: '9px 12px',
        textAlign: 'left',
        borderRadius: '6px',
        border: active ? '1px solid #9bdca9' : '1px solid rgba(238, 246, 242, 0.18)',
        background: active ? 'rgba(155, 220, 169, 0.16)' : 'rgba(238, 246, 242, 0.06)',
        color: '#eef6f2',
        cursor: 'pointer',
        font: '700 13px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)

    const label = document.createElement('div')
    label.textContent = active ? `${option.label} ✓` : option.label
    button.appendChild(label)

    const sub = document.createElement('div')
    sub.textContent = describeHandLoadout(world.playerSettings.equipment[option.stance])
    Object.assign(sub.style, {
        color: 'rgba(238, 246, 242, 0.58)',
        font: '600 11px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)
    button.appendChild(sub)

    button.addEventListener('click', () => {
        const players = query(world, [PlayerControlled])
        if (players.length === 0) return
        setWeaponStance(world, players[0]!, option.stance)
        renderInventory(dom, world)
    })
    return button
}

function spellSection(dom: InventoryDom, world: GameWorld): HTMLElement[] {
    const title = document.createElement('div')
    title.textContent = 'Spell (cast with C)'
    Object.assign(title.style, {
        color: 'rgba(244, 240, 220, 0.84)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        textTransform: 'uppercase',
    } satisfies Partial<CSSStyleDeclaration>)

    const row = document.createElement('div')
    Object.assign(row.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)

    for (const spell of SPELLS) {
        const active = world.selectedSpell === spell.id
        const button = document.createElement('button')
        button.type = 'button'
        button.title = spell.hint
        Object.assign(button.style, {
            display: 'grid',
            gap: '3px',
            minWidth: '150px',
            padding: '9px 12px',
            textAlign: 'left',
            borderRadius: '6px',
            border: active ? '1px solid #7fb8ff' : '1px solid rgba(238, 246, 242, 0.18)',
            background: active ? 'rgba(127, 184, 255, 0.16)' : 'rgba(238, 246, 242, 0.06)',
            color: '#eef6f2',
            cursor: 'pointer',
            font: '700 13px ui-sans-serif, system-ui, sans-serif',
        } satisfies Partial<CSSStyleDeclaration>)

        const label = document.createElement('div')
        label.textContent = active ? `${spell.label} ✓` : spell.label
        button.appendChild(label)

        const sub = document.createElement('div')
        sub.textContent = spell.hint
        Object.assign(sub.style, {
            color: 'rgba(238, 246, 242, 0.58)',
            font: '600 11px ui-sans-serif, system-ui, sans-serif',
        } satisfies Partial<CSSStyleDeclaration>)
        button.appendChild(sub)

        button.addEventListener('click', () => {
            world.selectedSpell = spell.id
            renderInventory(dom, world)
        })
        row.appendChild(button)
    }
    return [title, row]
}

function groupInventoryItems(world: GameWorld): Map<InventoryCategoryId, InventorySnapshotItem[]> {
    const grouped = new Map<InventoryCategoryId, InventorySnapshotItem[]>()
    for (const category of INVENTORY_CATEGORIES) grouped.set(category, [])
    grouped.get('resources')!.push(
        {
            id: 'gold',
            quantity: world.inventory.gold,
            name: 'Gold',
            category: 'resources',
            icon: 'gold',
        },
        {
            id: 'arrows',
            quantity: world.inventory.arrows,
            name: 'Arrows',
            category: 'resources',
            icon: 'arrows',
        },
    )
    for (const item of listInventoryItems(world.inventory.items)) {
        if (item.id === HEAL_POTION_ITEM_ID) continue
        grouped.get(item.category)?.push(item)
    }
    grouped.get('consumables')!.unshift(healPotionItem(world))
    return grouped
}

function healPotionItem(world: GameWorld): InventorySnapshotItem {
    return {
        id: HEAL_POTION_ITEM_ID,
        quantity: inventoryItemCount(world.inventory.items, HEAL_POTION_ITEM_ID),
        name: 'Heal Potion',
        description: 'Restores one heart.',
        category: 'consumables',
        icon: 'heal-potion',
    }
}

function categoryCards(
    category: InventoryCategoryId,
    items: readonly InventorySnapshotItem[],
    dom: InventoryDom,
    world: GameWorld,
): HTMLElement[] {
    const cards = items.map((item) => itemCard(item, dom, world))
    if (category === 'accessories') cards.unshift(...hatSelectorCards(dom, world))
    if (category === 'tools') cards.unshift(torchToggleCard(dom, world))
    return cards
}

function hatSelectorCards(dom: InventoryDom, world: GameWorld): HTMLElement[] {
    return HEAD_EQUIPMENT_KINDS.map((kind) => {
        const active = world.playerSettings.equipment.head === kind
        return menuCard({
            icon: kind,
            name: EQUIPMENT_LABELS[kind],
            detail: active ? 'Equipped' : 'Select',
            active,
            title: `Equip ${EQUIPMENT_LABELS[kind]}`,
            onClick: () => {
                world.playerSettings.equipment.head = kind
                syncPlayerVisuals(world)
                renderInventory(dom, world)
            },
        })
    })
}

function torchToggleCard(dom: InventoryDom, world: GameWorld): HTMLElement {
    const active = world.playerSettings.abilities.torch
    return menuCard({
        icon: 'torch',
        name: 'Torch',
        detail: active ? 'On' : 'Off',
        active,
        title: active ? 'Put the hand torch away.' : 'Carry the hand torch.',
        onClick: () => {
            world.playerSettings.abilities.torch = !world.playerSettings.abilities.torch
            syncPlayerHeldTorchVisibility(world)
            renderInventory(dom, world)
        },
    })
}

function categorySection(category: InventoryCategoryId, cards: readonly HTMLElement[]): HTMLElement {
    const section = document.createElement('section')
    Object.assign(section.style, {
        display: 'grid',
        gap: '8px',
        minWidth: '0',
    } satisfies Partial<CSSStyleDeclaration>)

    const title = document.createElement('div')
    title.textContent = INVENTORY_CATEGORY_LABELS[category]
    Object.assign(title.style, {
        color: 'rgba(244, 240, 220, 0.84)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        textTransform: 'uppercase',
    } satisfies Partial<CSSStyleDeclaration>)
    section.appendChild(title)

    const row = document.createElement('div')
    Object.assign(row.style, {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        minWidth: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    section.appendChild(row)

    if (cards.length === 0) {
        const empty = document.createElement('div')
        empty.textContent = 'Empty'
        Object.assign(empty.style, {
            color: 'rgba(238, 246, 242, 0.42)',
            font: '13px ui-sans-serif, system-ui, sans-serif',
            padding: '10px 0',
        } satisfies Partial<CSSStyleDeclaration>)
        row.appendChild(empty)
        return section
    }

    for (const card of cards) row.appendChild(card)
    return section
}

function itemCard(item: InventorySnapshotItem, dom: InventoryDom, world: GameWorld): HTMLElement {
    if (item.id === HEAL_POTION_ITEM_ID) {
        return menuCard({
            icon: item.icon,
            name: item.name,
            detail: `x${item.quantity}`,
            title: item.quantity > 0
                ? `${item.name}\nDouble-click to drink. Restores one heart.`
                : item.name,
            disabled: item.quantity <= 0,
            onDoubleClick: () => {
                if (consumeHealPotion(world)) renderInventory(dom, world)
            },
        })
    }
    return menuCard({
        icon: item.icon,
        name: item.name,
        detail: `x${item.quantity}`,
        title: item.description ? `${item.name}\n${item.description}` : item.name,
        disabled: item.quantity <= 0,
    })
}

interface MenuCardOptions {
    icon: InventoryIconId
    name: string
    detail: string
    title?: string
    active?: boolean
    disabled?: boolean
    onClick?: () => void
    onDoubleClick?: () => void
}

function menuCard(opts: MenuCardOptions): HTMLElement {
    const interactive = opts.onClick !== undefined || opts.onDoubleClick !== undefined
    const card = interactive ? document.createElement('button') : document.createElement('div')
    if (interactive && opts.disabled) {
        ;(card as HTMLButtonElement).disabled = true
    }
    if (opts.onClick) {
        ;(card as HTMLButtonElement).type = 'button'
        card.addEventListener('click', opts.onClick)
    } else if (interactive) {
        ;(card as HTMLButtonElement).type = 'button'
    }
    if (opts.onDoubleClick) {
        card.addEventListener('dblclick', (ev) => {
            ev.preventDefault()
            opts.onDoubleClick?.()
        })
    }
    Object.assign(card.style, {
        width: '138px',
        minHeight: '58px',
        display: 'grid',
        gridTemplateColumns: '34px minmax(0, 1fr)',
        gap: '9px',
        alignItems: 'center',
        padding: '9px',
        border: opts.active ? '1px solid #e7b563' : '1px solid rgba(238, 246, 242, 0.13)',
        background: opts.active ? 'rgba(231, 181, 99, 0.15)' : 'rgba(238, 246, 242, 0.065)',
        borderRadius: '6px',
        boxSizing: 'border-box',
        color: '#eef6f2',
        cursor: interactive ? 'pointer' : 'default',
        opacity: opts.disabled ? '0.55' : '1',
        textAlign: 'left',
        font: 'inherit',
    } satisfies Partial<CSSStyleDeclaration>)
    card.title = opts.title ?? opts.name

    card.appendChild(itemIcon(opts.icon))

    const text = document.createElement('div')
    Object.assign(text.style, {
        minWidth: '0',
        display: 'grid',
        gap: '2px',
    } satisfies Partial<CSSStyleDeclaration>)
    card.appendChild(text)

    const name = document.createElement('div')
    name.textContent = opts.name
    Object.assign(name.style, {
        color: '#eef6f2',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        font: '700 13px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)
    text.appendChild(name)

    const qty = document.createElement('div')
    qty.textContent = opts.detail
    Object.assign(qty.style, {
        color: opts.active ? '#e7b563' : 'rgba(238, 246, 242, 0.58)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)
    text.appendChild(qty)

    return card
}

function statsSection(world: GameWorld): HTMLElement[] {
    const nodes: HTMLElement[] = []
    const title = document.createElement('div')
    title.textContent = 'Player'
    Object.assign(title.style, {
        marginBottom: '12px',
        color: '#f4f0dc',
        font: '700 18px ui-serif, Georgia, serif',
    } satisfies Partial<CSSStyleDeclaration>)
    nodes.push(title)

    const stats = [
        ['Move speed', world.playerSettings.moveSpeed.toFixed(1)],
        ['Jump', world.playerSettings.jumpVelocity.toFixed(1)],
        ['High jump', world.playerSettings.highJumpVelocity.toFixed(1)],
        ['Arrow speed', world.playerSettings.arrowSpeed.toFixed(1)],
        ['Torch range', world.playerSettings.torch.distance.toFixed(1)],
    ] as const
    for (const [label, value] of stats) nodes.push(statRow(label, value))

    const abilityTitle = document.createElement('div')
    abilityTitle.textContent = 'Abilities'
    Object.assign(abilityTitle.style, {
        margin: '14px 0 8px',
        color: 'rgba(244, 240, 220, 0.78)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        textTransform: 'uppercase',
    } satisfies Partial<CSSStyleDeclaration>)
    nodes.push(abilityTitle)

    for (const key of PLAYER_ABILITY_KEYS) {
        const enabled = world.playerSettings.abilities[key]
        nodes.push(statRow(PLAYER_ABILITY_LABELS[key], enabled ? 'On' : 'Off', enabled))
    }
    return nodes
}

function statRow(label: string, value: string, positive?: boolean): HTMLElement {
    const row = document.createElement('div')
    Object.assign(row.style, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '6px 0',
        borderTop: '1px solid rgba(238, 246, 242, 0.075)',
        color: 'rgba(238, 246, 242, 0.72)',
        font: '13px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)
    const left = document.createElement('span')
    left.textContent = label
    const right = document.createElement('span')
    right.textContent = value
    Object.assign(right.style, {
        color: positive === undefined ? '#eef6f2' : positive ? '#9bdca9' : '#e2a18f',
        fontWeight: '700',
    } satisfies Partial<CSSStyleDeclaration>)
    row.append(left, right)
    return row
}

function itemIcon(icon: InventoryIconId): HTMLElement {
    const root = document.createElement('div')
    Object.assign(root.style, {
        width: '34px',
        height: '34px',
        borderRadius: '6px',
        display: 'grid',
        placeItems: 'center',
        background: iconBackground(icon),
        border: '1px solid rgba(255, 255, 255, 0.16)',
        boxShadow: 'inset 0 0 16px rgba(255,255,255,0.08)',
    } satisfies Partial<CSSStyleDeclaration>)

    const glyph = document.createElement('div')
    Object.assign(glyph.style, glyphStyle(icon))
    root.appendChild(glyph)
    return root
}

function iconBackground(icon: InventoryIconId): string {
    switch (icon) {
        case 'gold': return 'linear-gradient(145deg, #6c5220, #d7ae45)'
        case 'arrows': return 'linear-gradient(145deg, #39444d, #7aa3aa)'
        case 'quest-shard': return 'linear-gradient(145deg, #2f4d5f, #77d0c9)'
        case 'heal-potion': return 'linear-gradient(145deg, #472333, #c95772)'
        case 'torch': return 'linear-gradient(145deg, #4a2b18, #d28b37)'
        case 'hat': return 'linear-gradient(145deg, #20372f, #7ac7a2)'
        case 'hat-arcane': return 'linear-gradient(145deg, #18234f, #5f7dff)'
        case 'hat-ranger': return 'linear-gradient(145deg, #203d24, #9fd179)'
        case 'hat-guard': return 'linear-gradient(145deg, #3f4b52, #b7c3ca)'
        case 'hat-sun': return 'linear-gradient(145deg, #6d4215, #ffd166)'
        case 'consumable': return 'linear-gradient(145deg, #3e4b2e, #9bbd5c)'
        case 'accessory': return 'linear-gradient(145deg, #4b3656, #b181bd)'
        case 'tool': return 'linear-gradient(145deg, #4d4439, #c0a26f)'
        default: return 'linear-gradient(145deg, #33424a, #8ea0a6)'
    }
}

function glyphStyle(icon: InventoryIconId): Partial<CSSStyleDeclaration> {
    if (icon === 'arrows') {
        return {
            width: '20px',
            height: '3px',
            background: '#eef6f2',
            transform: 'rotate(-34deg)',
            boxShadow: '9px 0 0 -1px #c9a85d',
        }
    }
    if (icon === 'quest-shard') {
        return {
            width: '15px',
            height: '19px',
            background: '#dbfff7',
            clipPath: 'polygon(50% 0, 100% 38%, 68% 100%, 18% 80%, 0 28%)',
            boxShadow: '0 0 10px rgba(219,255,247,0.65)',
        }
    }
    if (icon === 'gold') {
        return {
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: '#ffe28a',
            boxShadow: 'inset -3px -3px 0 rgba(126, 82, 21, 0.38)',
        }
    }
    if (icon === 'heal-potion') {
        return {
            width: '16px',
            height: '22px',
            borderRadius: '5px 5px 7px 7px',
            background: 'linear-gradient(180deg, #ffd7de 0 22%, #e34c64 23% 100%)',
            boxShadow: '0 -6px 0 -2px #d9edf0, inset -3px -4px 0 rgba(85, 10, 22, 0.25)',
        }
    }
    if (icon === 'torch') {
        return {
            width: '6px',
            height: '24px',
            borderRadius: '4px',
            background: '#4a2715',
            transform: 'rotate(18deg)',
            boxShadow: '0 -10px 0 4px #ffb05f, 0 -14px 0 1px #fff0a8',
        }
    }
    if (icon === 'hat') {
        return hatGlyph('#243d36', '0 -7px 0 -2px #315a4d')
    }
    if (icon === 'hat-arcane') {
        return {
            width: '22px',
            height: '25px',
            clipPath: 'polygon(50% 0, 78% 72%, 100% 74%, 100% 88%, 0 88%, 0 74%, 24% 72%)',
            background: 'linear-gradient(180deg, #5f7dff, #253a7a)',
            boxShadow: 'inset 0 -5px 0 #18234f',
        }
    }
    if (icon === 'hat-ranger') {
        return hatGlyph('#315a2f', '9px -7px 0 -5px #d7b35a')
    }
    if (icon === 'hat-guard') {
        return hatGlyph('#9aa7ad', '0 -8px 0 -4px #b6342d')
    }
    if (icon === 'hat-sun') {
        return {
            width: '24px',
            height: '20px',
            clipPath: 'polygon(0 100%, 0 48%, 18% 70%, 32% 18%, 50% 64%, 68% 18%, 82% 70%, 100% 48%, 100% 100%)',
            background: '#ffd166',
            boxShadow: 'inset 0 -5px 0 #d9a62a',
        }
    }
    return {
        width: '18px',
        height: '18px',
        borderRadius: icon === 'tool' ? '2px' : '50%',
        background: '#eef6f2',
        opacity: '0.9',
    }
}

function hatGlyph(color: string, boxShadow: string): Partial<CSSStyleDeclaration> {
    return {
        width: '24px',
        height: '10px',
        borderRadius: '8px 8px 4px 4px',
        background: color,
        boxShadow,
    }
}

function buttonStyle(): Partial<CSSStyleDeclaration> {
    return {
        padding: '7px 11px',
        borderRadius: '6px',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        background: 'rgba(238, 246, 242, 0.08)',
        color: '#eef6f2',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        cursor: 'pointer',
    }
}

function isInventoryKey(code: string, actions: ActionMap): boolean {
    return actions.bindingsFor(GameAction.Inventory).some((binding) => binding.keys.includes(code))
}

function hasBlockingOverlay(): boolean {
    return [
        'voxel-platformer-menu',
        'voxel-platformer-dialogue',
        'voxel-platformer-trade',
    ].some((id) => {
        const el = document.getElementById(id)
        return !!el && el.getAttribute('aria-hidden') !== 'true' && el.style.display !== 'none'
    })
}

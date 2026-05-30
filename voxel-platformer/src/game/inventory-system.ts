import type { GameWorld } from '../engine/ecs/world'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { System } from '../engine/ecs/systems/system'
import type { ActionMap } from '../engine/input/actions'
import type { Input } from '../engine/input/input'
import { PLAYER_ABILITY_KEYS, PLAYER_ABILITY_LABELS } from './player-settings'
import { GameAction } from './actions'
import {
    INVENTORY_CATEGORIES,
    INVENTORY_CATEGORY_LABELS,
    listInventoryItems,
    type InventoryCategoryId,
    type InventoryIconId,
    type InventorySnapshotItem,
} from './inventory'

interface InventoryDom {
    root: HTMLDivElement
    panel: HTMLDivElement
    categories: HTMLDivElement
    stats: HTMLDivElement
    closeButton: HTMLButtonElement
    keyHint: HTMLSpanElement
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
            renderInventory(dom, world)
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
        gridTemplateRows: 'auto minmax(0, 1fr)',
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

    return { root, panel, categories, stats, closeButton, keyHint }
}

function renderInventory(dom: InventoryDom, world: GameWorld): void {
    const grouped = groupInventoryItems(world)
    dom.categories.replaceChildren(...INVENTORY_CATEGORIES.map((category) =>
        categorySection(category, grouped.get(category) ?? []),
    ))
    dom.stats.replaceChildren(...statsSection(world))
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
        grouped.get(item.category)?.push(item)
    }
    return grouped
}

function categorySection(category: InventoryCategoryId, items: readonly InventorySnapshotItem[]): HTMLElement {
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

    if (items.length === 0) {
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

    for (const item of items) row.appendChild(itemCard(item))
    return section
}

function itemCard(item: InventorySnapshotItem): HTMLElement {
    const card = document.createElement('div')
    Object.assign(card.style, {
        width: '138px',
        minHeight: '58px',
        display: 'grid',
        gridTemplateColumns: '34px minmax(0, 1fr)',
        gap: '9px',
        alignItems: 'center',
        padding: '9px',
        border: '1px solid rgba(238, 246, 242, 0.13)',
        background: 'rgba(238, 246, 242, 0.065)',
        borderRadius: '6px',
        boxSizing: 'border-box',
    } satisfies Partial<CSSStyleDeclaration>)
    card.title = item.description ? `${item.name}\n${item.description}` : item.name

    card.appendChild(itemIcon(item.icon))

    const text = document.createElement('div')
    Object.assign(text.style, {
        minWidth: '0',
        display: 'grid',
        gap: '2px',
    } satisfies Partial<CSSStyleDeclaration>)
    card.appendChild(text)

    const name = document.createElement('div')
    name.textContent = item.name
    Object.assign(name.style, {
        color: '#eef6f2',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        font: '700 13px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)
    text.appendChild(name)

    const qty = document.createElement('div')
    qty.textContent = `x${item.quantity}`
    Object.assign(qty.style, {
        color: 'rgba(238, 246, 242, 0.58)',
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
    return {
        width: '18px',
        height: '18px',
        borderRadius: icon === 'tool' ? '2px' : '50%',
        background: '#eef6f2',
        opacity: '0.9',
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

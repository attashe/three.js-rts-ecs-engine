import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { Input } from '../engine/input/input'
import type { DialogueSpeaker, TradeInventorySnapshot, TradeMode, TradeResource } from '../engine/script/types'
import { dialogueAvatarImageUrl } from './dialogue-system'
import {
    resourceLabel,
    tradeAvailability,
    type NormalizedTradeItem,
    type NormalizedTradeRequest,
    type TradeSelection,
} from './trade'
import { HIGH_JUMP_BOOTS_ITEM_ID } from './high-jump-boots'

interface TradeControllerOptions {
    input: Input
}

export interface TradeMenuFacade {
    open(request: NormalizedTradeRequest, inventory: TradeInventorySnapshot): Promise<TradeSelection>
}

export interface TradeController {
    readonly facade: TradeMenuFacade
    readonly system: System
}

interface TradeQueueItem {
    request: NormalizedTradeRequest
    inventory: TradeInventorySnapshot
    resolve: (selection: TradeSelection) => void
    key: string | null
}

interface ActiveTrade extends TradeQueueItem {
    selectedIndex: number
    mode: TradeMode
    quantity: number
}

interface TradeDom {
    root: HTMLDivElement
    title: HTMLDivElement
    npcName: HTMLDivElement
    avatar: HTMLDivElement
    avatarImage: HTMLImageElement
    avatarInitial: HTMLDivElement
    inventory: HTMLDivElement
    itemList: HTMLDivElement
    buyMode: HTMLButtonElement
    sellMode: HTMLButtonElement
    itemIcon: HTMLDivElement
    itemName: HTMLDivElement
    itemDescription: HTMLDivElement
    itemMeta: HTMLDivElement
    quantity: HTMLDivElement
    decrement: HTMLButtonElement
    increment: HTMLButtonElement
    total: HTMLDivElement
    feedback: HTMLDivElement
    confirm: HTMLButtonElement
    cancel: HTMLButtonElement
}

export function createTradeController(opts: TradeControllerOptions): TradeController {
    let dom: TradeDom | null = null
    let active: ActiveTrade | null = null
    const queue: TradeQueueItem[] = []
    const activeKeys = new Set<string>()

    function open(request: NormalizedTradeRequest, inventory: TradeInventorySnapshot): Promise<TradeSelection> {
        const key = tradeRequestKey(request)
        if (key !== null && activeKeys.has(key)) return Promise.resolve({ action: 'cancel' })
        if (key !== null) activeKeys.add(key)
        return new Promise<TradeSelection>((resolve) => {
            queue.push({ request, inventory, resolve, key })
            pumpQueue()
        })
    }

    function pumpQueue(): void {
        if (active || queue.length === 0) return
        const next = queue.shift()!
        active = {
            ...next,
            selectedIndex: 0,
            mode: defaultMode(next.request.items[0]),
            quantity: 1,
        }
        ensureDom()
        opts.input.setEnabled(false)
        showRoot(true)
        render()
        if (next.request.items.length === 0) finish({ action: 'cancel' })
    }

    const system: System = {
        name: 'trade',
        order: RenderOrder.debug + 11,
        init() {
            ensureDom()
            showRoot(false)
            window.addEventListener('keydown', onKeyDown, { capture: true })
        },
        update() {
            if (active) opts.input.clear()
        },
        dispose() {
            window.removeEventListener('keydown', onKeyDown, true)
            dom?.root.remove()
            dom = null
            active = null
            queue.length = 0
            activeKeys.clear()
            opts.input.setEnabled(true)
        },
    }

    return {
        facade: { open },
        system,
    }

    function ensureDom(): TradeDom {
        if (dom) return dom
        dom = buildTradeDom()
        document.body.appendChild(dom.root)
        dom.root.addEventListener('pointerdown', onPointerDown)
        return dom
    }

    function onPointerDown(ev: PointerEvent): void {
        if (!active || ev.button !== 0) return
        const target = ev.target as HTMLElement | null
        const button = target?.closest<HTMLButtonElement>('button[data-trade-action]')
        ev.preventDefault()
        ev.stopPropagation()
        if (!button || button.disabled) return

        const action = button.dataset.tradeAction
        if (action === 'select') selectItem(Number(button.dataset.tradeIndex))
        else if (action === 'buy' || action === 'sell') setMode(action)
        else if (action === 'dec') changeQuantity(-1)
        else if (action === 'inc') changeQuantity(1)
        else if (action === 'confirm') confirmTrade()
        else if (action === 'cancel') finish({ action: 'cancel' })
    }

    function onKeyDown(ev: KeyboardEvent): void {
        if (!active) return
        if (ev.altKey || ev.ctrlKey || ev.metaKey) return
        const handled = handleTradeKey(ev.code)
        if (!handled) return
        ev.preventDefault()
        ev.stopPropagation()
        ev.stopImmediatePropagation()
    }

    function handleTradeKey(code: string): boolean {
        if (!active) return false
        if (code === 'Escape') {
            finish({ action: 'cancel' })
            return true
        }
        if (code === 'ArrowUp' || code === 'KeyW') {
            moveItem(-1)
            return true
        }
        if (code === 'ArrowDown' || code === 'KeyS') {
            moveItem(1)
            return true
        }
        if (code === 'ArrowLeft' || code === 'KeyA') {
            changeQuantity(-1)
            return true
        }
        if (code === 'ArrowRight' || code === 'KeyD') {
            changeQuantity(1)
            return true
        }
        if (code === 'Enter' || code === 'Space') {
            confirmTrade()
            return true
        }
        return false
    }

    function moveItem(delta: number): void {
        if (!active || active.request.items.length === 0) return
        active.selectedIndex = (active.selectedIndex + delta + active.request.items.length) % active.request.items.length
        active.mode = defaultMode(currentItem() ?? undefined)
        active.quantity = 1
        render()
    }

    function selectItem(index: number): void {
        if (!active || !Number.isInteger(index)) return
        if (index < 0 || index >= active.request.items.length) return
        active.selectedIndex = index
        active.mode = defaultMode(currentItem() ?? undefined)
        active.quantity = 1
        render()
    }

    function setMode(mode: TradeMode): void {
        if (!active) return
        const item = currentItem()
        if (!item || !modeSupported(item, mode)) return
        active.mode = mode
        active.quantity = 1
        render()
    }

    function changeQuantity(delta: number): void {
        if (!active) return
        const item = currentItem()
        if (!item) return
        const availability = tradeAvailability(item, active.mode, active.inventory)
        const max = Math.max(1, availability.maxQuantity)
        active.quantity = Math.max(1, Math.min(max, active.quantity + delta))
        render()
    }

    function confirmTrade(): void {
        if (!active) return
        const item = currentItem()
        if (!item) return
        const availability = tradeAvailability(item, active.mode, active.inventory)
        if (!availability.enabled || active.quantity > availability.maxQuantity) return
        finish({ action: active.mode, itemId: item.id, quantity: active.quantity })
    }

    function finish(selection: TradeSelection): void {
        const done = active
        if (!done) return
        active = null
        if (done.key) activeKeys.delete(done.key)
        showRoot(false)
        opts.input.setEnabled(true)
        opts.input.clear()
        done.resolve(selection)
        pumpQueue()
    }

    function render(): void {
        if (!active || !dom) return
        if (active.selectedIndex >= active.request.items.length) active.selectedIndex = 0
        const item = currentItem()
        const d = dom
        const speaker = active.request.npc ?? { name: 'Merchant', avatar: 'npc' }
        d.title.textContent = active.request.title ?? 'Trade'
        d.npcName.textContent = speaker.name
        const potions = active.inventory.items?.['heal-potion']?.quantity ?? 0
        const boots = active.inventory.items?.[HIGH_JUMP_BOOTS_ITEM_ID]?.quantity ?? 0
        d.inventory.textContent = `Gold ${active.inventory.gold}  |  Arrows ${active.inventory.arrows}  |  Potions ${potions}  |  Boots ${boots}`
        paintAvatar(d.avatar, d.avatarImage, d.avatarInitial, speaker)

        d.itemList.innerHTML = ''
        active.request.items.forEach((candidate, index) => {
            d.itemList.appendChild(itemButton(candidate, index, index === active!.selectedIndex))
        })

        if (!item) {
            paintModeButton(d.buyMode, false, false)
            paintModeButton(d.sellMode, false, false)
            d.itemName.textContent = 'No items'
            paintResourceIcon(d.itemIcon, null)
            d.itemDescription.textContent = ''
            d.itemMeta.textContent = ''
            d.quantity.textContent = '0'
            d.total.textContent = ''
            d.feedback.textContent = 'This shop has no tradeable items.'
            d.confirm.disabled = true
            return
        }

        if (!modeSupported(item, active.mode)) active.mode = defaultMode(item)
        const availability = tradeAvailability(item, active.mode, active.inventory)
        active.quantity = Math.max(1, Math.min(Math.max(1, availability.maxQuantity), active.quantity))

        paintModeButton(d.buyMode, active.mode === 'buy', modeSupported(item, 'buy'))
        paintModeButton(d.sellMode, active.mode === 'sell', modeSupported(item, 'sell'))

        paintResourceIcon(d.itemIcon, item.resource)
        d.itemName.textContent = item.name
        d.itemDescription.textContent = item.description ?? ''
        d.itemMeta.textContent = `${item.unitSize} ${resourceLabel(item.resource)} per trade`
        d.quantity.textContent = String(active.quantity)
        d.decrement.disabled = active.quantity <= 1 || availability.maxQuantity <= 0
        d.increment.disabled = active.quantity >= availability.maxQuantity || availability.maxQuantity <= 0

        const unitPrice = availability.unitPrice ?? 0
        const total = unitPrice * active.quantity
        d.total.textContent = active.mode === 'buy'
            ? `Cost: ${total} gold`
            : `Receive: ${total} gold`
        d.feedback.textContent = availability.enabled
            ? ''
            : availability.reason ?? 'Trade is unavailable.'
        d.confirm.textContent = active.mode === 'buy' ? 'Buy' : 'Sell'
        d.confirm.disabled = !availability.enabled || active.quantity > availability.maxQuantity
    }

    function currentItem(): NormalizedTradeItem | null {
        if (!active) return null
        return active.request.items[active.selectedIndex] ?? null
    }

    function showRoot(visible: boolean): void {
        if (!dom) return
        dom.root.style.display = visible ? 'grid' : 'none'
        dom.root.style.pointerEvents = visible ? 'auto' : 'none'
        dom.root.setAttribute('aria-hidden', visible ? 'false' : 'true')
    }
}

function buildTradeDom(): TradeDom {
    const root = document.createElement('div')
    root.id = 'voxel-platformer-trade'
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '1710',
        display: 'none',
        placeItems: 'center',
        padding: '18px',
        background: 'rgba(4, 8, 10, 0.38)',
        color: '#eef6f2',
        font: '14px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)

    const panel = document.createElement('div')
    Object.assign(panel.style, {
        width: 'min(820px, calc(100vw - 28px))',
        maxHeight: 'min(600px, calc(100vh - 28px))',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 260px) minmax(0, 1fr)',
        gridTemplateRows: 'auto minmax(0, 1fr)',
        gap: '14px',
        padding: '18px',
        borderRadius: '8px',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        background: 'rgba(10, 15, 17, 0.95)',
        boxShadow: '0 26px 90px rgba(0, 0, 0, 0.54)',
    } satisfies Partial<CSSStyleDeclaration>)
    root.appendChild(panel)

    const header = document.createElement('div')
    Object.assign(header.style, {
        gridColumn: '1 / -1',
        display: 'grid',
        gridTemplateColumns: '72px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: '12px',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(header)

    const avatar = document.createElement('div')
    Object.assign(avatar.style, {
        width: '64px',
        height: '72px',
        borderRadius: '8px',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #313b3c 0%, #151a1b 100%)',
    } satisfies Partial<CSSStyleDeclaration>)
    const avatarImage = document.createElement('img')
    avatarImage.alt = ''
    avatarImage.decoding = 'async'
    avatarImage.loading = 'eager'
    Object.assign(avatarImage.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'none',
    } satisfies Partial<CSSStyleDeclaration>)
    const avatarInitial = document.createElement('div')
    Object.assign(avatarInitial.style, {
        width: '42px',
        height: '42px',
        borderRadius: '999px',
        display: 'grid',
        placeItems: 'center',
        border: '1px solid rgba(255, 255, 255, 0.24)',
        background: 'rgba(255, 255, 255, 0.08)',
        color: '#fff5d6',
        font: '800 15px ui-sans-serif, system-ui, sans-serif',
        position: 'relative',
        zIndex: '1',
    } satisfies Partial<CSSStyleDeclaration>)
    avatar.append(avatarImage, avatarInitial)
    header.appendChild(avatar)

    const heading = document.createElement('div')
    Object.assign(heading.style, {
        minWidth: '0',
        display: 'grid',
        gap: '3px',
    } satisfies Partial<CSSStyleDeclaration>)
    const title = document.createElement('div')
    Object.assign(title.style, {
        font: '800 18px ui-sans-serif, system-ui, sans-serif',
        color: '#ffe083',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>)
    const npcName = document.createElement('div')
    Object.assign(npcName.style, {
        color: 'rgba(238, 246, 242, 0.68)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        textTransform: 'uppercase',
        letterSpacing: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    heading.append(title, npcName)
    header.appendChild(heading)

    const inventory = document.createElement('div')
    Object.assign(inventory.style, {
        justifySelf: 'end',
        textAlign: 'right',
        color: 'rgba(238, 246, 242, 0.78)',
        font: '700 12px ui-monospace, monospace',
        overflowWrap: 'anywhere',
    } satisfies Partial<CSSStyleDeclaration>)
    header.appendChild(inventory)

    const itemList = document.createElement('div')
    Object.assign(itemList.style, {
        minHeight: '220px',
        maxHeight: '390px',
        overflowY: 'auto',
        display: 'grid',
        alignContent: 'start',
        gap: '7px',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(itemList)

    const detail = document.createElement('div')
    Object.assign(detail.style, {
        minWidth: '0',
        display: 'grid',
        gridTemplateRows: 'auto auto minmax(54px, auto) auto auto auto',
        alignContent: 'start',
        gap: '12px',
        paddingLeft: '2px',
    } satisfies Partial<CSSStyleDeclaration>)
    panel.appendChild(detail)

    const modes = document.createElement('div')
    Object.assign(modes.style, {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)
    const buyMode = modeButton('Buy', 'buy')
    const sellMode = modeButton('Sell', 'sell')
    modes.append(buyMode, sellMode)
    detail.appendChild(modes)

    const itemHeader = document.createElement('div')
    Object.assign(itemHeader.style, {
        display: 'grid',
        gridTemplateColumns: '54px minmax(0, 1fr)',
        alignItems: 'center',
        gap: '12px',
        minWidth: '0',
    } satisfies Partial<CSSStyleDeclaration>)

    const itemIcon = document.createElement('div')
    Object.assign(itemIcon.style, {
        width: '54px',
        height: '54px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '8px',
        border: '1px solid rgba(255, 224, 131, 0.24)',
        background: 'rgba(71, 54, 25, 0.40)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    } satisfies Partial<CSSStyleDeclaration>)

    const itemName = document.createElement('div')
    Object.assign(itemName.style, {
        font: '800 20px ui-sans-serif, system-ui, sans-serif',
        color: '#eef6f2',
        minWidth: '0',
        overflowWrap: 'anywhere',
    } satisfies Partial<CSSStyleDeclaration>)
    itemHeader.append(itemIcon, itemName)
    detail.appendChild(itemHeader)

    const itemDescription = document.createElement('div')
    Object.assign(itemDescription.style, {
        minHeight: '36px',
        color: 'rgba(238, 246, 242, 0.70)',
        lineHeight: '1.35',
        overflowWrap: 'anywhere',
    } satisfies Partial<CSSStyleDeclaration>)
    detail.appendChild(itemDescription)

    const itemMeta = document.createElement('div')
    Object.assign(itemMeta.style, {
        color: 'rgba(238, 246, 242, 0.58)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)
    detail.appendChild(itemMeta)

    const quantityRow = document.createElement('div')
    Object.assign(quantityRow.style, {
        display: 'grid',
        gridTemplateColumns: '42px minmax(52px, 80px) 42px minmax(0, 1fr)',
        alignItems: 'center',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)
    const decrement = stepButton('-', 'dec')
    const quantity = document.createElement('div')
    Object.assign(quantity.style, {
        height: '38px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '6px',
        border: '1px solid rgba(238, 246, 242, 0.16)',
        background: 'rgba(19, 27, 31, 0.86)',
        color: '#eef6f2',
        font: '800 15px ui-monospace, monospace',
    } satisfies Partial<CSSStyleDeclaration>)
    const increment = stepButton('+', 'inc')
    const total = document.createElement('div')
    Object.assign(total.style, {
        color: '#ffe083',
        font: '800 14px ui-sans-serif, system-ui, sans-serif',
        overflowWrap: 'anywhere',
    } satisfies Partial<CSSStyleDeclaration>)
    quantityRow.append(decrement, quantity, increment, total)
    detail.appendChild(quantityRow)

    const feedback = document.createElement('div')
    Object.assign(feedback.style, {
        minHeight: '20px',
        color: 'rgba(255, 184, 135, 0.90)',
        font: '700 12px ui-sans-serif, system-ui, sans-serif',
        overflowWrap: 'anywhere',
    } satisfies Partial<CSSStyleDeclaration>)
    detail.appendChild(feedback)

    const actions = document.createElement('div')
    Object.assign(actions.style, {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px',
    } satisfies Partial<CSSStyleDeclaration>)
    const confirm = actionButton('Buy', 'confirm', true)
    const cancel = actionButton('Cancel', 'cancel', false)
    actions.append(confirm, cancel)
    detail.appendChild(actions)

    return {
        root,
        title,
        npcName,
        avatar,
        avatarImage,
        avatarInitial,
        inventory,
        itemList,
        buyMode,
        sellMode,
        itemIcon,
        itemName,
        itemDescription,
        itemMeta,
        quantity,
        decrement,
        increment,
        total,
        feedback,
        confirm,
        cancel,
    }
}

export function tradeRequestKey(request: NormalizedTradeRequest): string | null {
    const id = request.id?.trim()
    if (id) return `id:${id}`
    const npcId = request.npc?.id?.trim()
    if (npcId) return `npc:${npcId}`
    return null
}

function itemButton(item: NormalizedTradeItem, index: number, selected: boolean): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.tradeAction = 'select'
    button.dataset.tradeIndex = String(index)
    const buy = item.buyPrice !== undefined ? `${item.buyPrice}g` : '--'
    const sell = item.sellPrice !== undefined ? `${item.sellPrice}g` : '--'
    button.innerHTML = ''

    const icon = resourceIcon(item.resource, 'small')
    icon.style.opacity = item.disabled ? '0.36' : '1'

    const name = document.createElement('span')
    name.textContent = item.name
    name.style.minWidth = '0'
    name.style.overflowWrap = 'anywhere'

    const prices = document.createElement('span')
    prices.textContent = `B ${buy} / S ${sell}`
    Object.assign(prices.style, {
        color: 'rgba(238, 246, 242, 0.56)',
        font: '700 11px ui-monospace, monospace',
        whiteSpace: 'nowrap',
    } satisfies Partial<CSSStyleDeclaration>)

    button.append(icon, name, prices)
    Object.assign(button.style, {
        display: 'grid',
        gridTemplateColumns: '28px minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: '8px',
        minHeight: '40px',
        padding: '8px 10px',
        borderRadius: '6px',
        border: selected ? '1px solid rgba(255, 224, 131, 0.62)' : '1px solid rgba(238, 246, 242, 0.14)',
        background: selected ? 'rgba(71, 54, 25, 0.92)' : 'rgba(19, 27, 31, 0.86)',
        color: item.disabled ? 'rgba(238, 246, 242, 0.36)' : '#eef6f2',
        font: '700 13px ui-sans-serif, system-ui, sans-serif',
        textAlign: 'left',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)
    return button
}

function paintResourceIcon(root: HTMLElement, resource: TradeResource | null): void {
    root.innerHTML = ''
    root.style.visibility = resource ? 'visible' : 'hidden'
    if (!resource) return
    root.appendChild(resourceIcon(resource, 'large'))
}

function resourceIcon(resource: TradeResource, size: 'small' | 'large'): HTMLElement {
    switch (resource) {
        case 'arrows':
            return arrowBundleIcon(size)
        case 'heal-potion':
            return healPotionIcon(size)
        case HIGH_JUMP_BOOTS_ITEM_ID:
            return bootsIcon(size)
    }
}

function arrowBundleIcon(size: 'small' | 'large'): HTMLElement {
    const root = document.createElement('span')
    root.setAttribute('aria-hidden', 'true')
    const isLarge = size === 'large'
    Object.assign(root.style, {
        width: isLarge ? '34px' : '22px',
        height: isLarge ? '28px' : '18px',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
    } satisfies Partial<CSSStyleDeclaration>)

    const offsets = isLarge ? [-8, 0, 8] : [-5, 0, 5]
    for (let i = 0; i < offsets.length; i++) {
        const arrow = document.createElement('span')
        Object.assign(arrow.style, {
            position: 'absolute',
            left: isLarge ? '3px' : '2px',
            top: `calc(50% + ${offsets[i]}px)`,
            width: isLarge ? '25px' : '16px',
            height: isLarge ? '2px' : '1.5px',
            borderRadius: '999px',
            background: '#f5d891',
            transform: 'translateY(-50%) rotate(-16deg)',
            boxShadow: '0 0 6px rgba(255, 224, 131, 0.20)',
        } satisfies Partial<CSSStyleDeclaration>)

        const head = document.createElement('span')
        Object.assign(head.style, {
            position: 'absolute',
            right: '-1px',
            top: '50%',
            width: '0',
            height: '0',
            borderTop: isLarge ? '4px solid transparent' : '3px solid transparent',
            borderBottom: isLarge ? '4px solid transparent' : '3px solid transparent',
            borderLeft: isLarge ? '8px solid #f5d891' : '6px solid #f5d891',
            transform: 'translateY(-50%)',
        } satisfies Partial<CSSStyleDeclaration>)

        const fletching = document.createElement('span')
        Object.assign(fletching.style, {
            position: 'absolute',
            left: '-1px',
            top: '50%',
            width: isLarge ? '7px' : '5px',
            height: isLarge ? '7px' : '5px',
            borderLeft: '2px solid #87c6d8',
            borderTop: '2px solid #87c6d8',
            transform: 'translateY(-50%) rotate(-45deg)',
        } satisfies Partial<CSSStyleDeclaration>)

        arrow.append(head, fletching)
        root.appendChild(arrow)
    }
    return root
}

function healPotionIcon(size: 'small' | 'large'): HTMLElement {
    const root = document.createElement('span')
    root.setAttribute('aria-hidden', 'true')
    const isLarge = size === 'large'
    Object.assign(root.style, {
        width: isLarge ? '26px' : '18px',
        height: isLarge ? '34px' : '24px',
        display: 'block',
        borderRadius: isLarge ? '7px 7px 10px 10px' : '5px 5px 7px 7px',
        background: 'linear-gradient(180deg, #ffd7de 0 22%, #e34c64 23% 100%)',
        boxShadow: '0 -7px 0 -2px #d9edf0, inset -4px -5px 0 rgba(85, 10, 22, 0.25), 0 0 8px rgba(227, 76, 100, 0.22)',
    } satisfies Partial<CSSStyleDeclaration>)
    return root
}

function bootsIcon(size: 'small' | 'large'): HTMLElement {
    const root = document.createElement('span')
    root.setAttribute('aria-hidden', 'true')
    const isLarge = size === 'large'
    Object.assign(root.style, {
        width: isLarge ? '34px' : '22px',
        height: isLarge ? '26px' : '17px',
        display: 'block',
        borderRadius: isLarge ? '4px 4px 9px 9px' : '3px 3px 6px 6px',
        background: '#dff7ff',
        clipPath: 'polygon(4% 0, 42% 0, 44% 48%, 62% 48%, 64% 0, 96% 0, 96% 58%, 76% 58%, 76% 100%, 52% 100%, 52% 62%, 48% 62%, 48% 100%, 24% 100%, 24% 58%, 4% 58%)',
        boxShadow: '0 0 10px rgba(101, 215, 255, 0.45)',
    } satisfies Partial<CSSStyleDeclaration>)
    return root
}

function modeButton(label: string, mode: TradeMode): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.dataset.tradeAction = mode
    Object.assign(button.style, {
        minHeight: '38px',
        borderRadius: '6px',
        font: '800 13px ui-sans-serif, system-ui, sans-serif',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)
    return button
}

function stepButton(label: string, action: 'dec' | 'inc'): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.dataset.tradeAction = action
    Object.assign(button.style, {
        height: '38px',
        borderRadius: '6px',
        border: '1px solid rgba(238, 246, 242, 0.16)',
        background: 'rgba(19, 27, 31, 0.86)',
        color: '#eef6f2',
        font: '900 18px ui-sans-serif, system-ui, sans-serif',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)
    return button
}

function actionButton(label: string, action: 'confirm' | 'cancel', primary: boolean): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.dataset.tradeAction = action
    Object.assign(button.style, {
        minHeight: '40px',
        borderRadius: '6px',
        border: primary ? '1px solid rgba(255, 224, 131, 0.60)' : '1px solid rgba(238, 246, 242, 0.16)',
        background: primary ? 'rgba(71, 54, 25, 0.94)' : 'rgba(19, 27, 31, 0.86)',
        color: primary ? '#ffe083' : '#eef6f2',
        font: '800 13px ui-sans-serif, system-ui, sans-serif',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)
    return button
}

function paintModeButton(button: HTMLButtonElement, selected: boolean, enabled: boolean): void {
    button.disabled = !enabled
    button.style.border = selected ? '1px solid rgba(255, 224, 131, 0.62)' : '1px solid rgba(238, 246, 242, 0.16)'
    button.style.background = selected ? 'rgba(71, 54, 25, 0.92)' : 'rgba(19, 27, 31, 0.86)'
    button.style.color = enabled ? (selected ? '#ffe083' : '#eef6f2') : 'rgba(238, 246, 242, 0.34)'
    button.style.cursor = enabled ? 'pointer' : 'default'
}

function defaultMode(item: NormalizedTradeItem | undefined): TradeMode {
    if (item?.buyPrice !== undefined) return 'buy'
    return 'sell'
}

function modeSupported(item: NormalizedTradeItem, mode: TradeMode): boolean {
    return mode === 'buy' ? item.buyPrice !== undefined : item.sellPrice !== undefined
}

function paintAvatar(el: HTMLElement, img: HTMLImageElement, initial: HTMLElement, speaker: DialogueSpeaker): void {
    const avatar = speaker.avatar ?? speaker.id ?? 'npc'
    el.style.background = avatarTheme(avatar)
    img.alt = `${speaker.name} portrait`
    initial.textContent = avatarInitials(speaker.name)

    const url = dialogueAvatarImageUrl(avatar)
    if (!url) {
        img.removeAttribute('src')
        img.dataset.avatarSrc = ''
        img.style.display = 'none'
        initial.style.display = 'grid'
        return
    }

    if (img.dataset.avatarSrc !== url) {
        img.dataset.avatarSrc = url
        img.style.display = 'none'
        initial.style.display = 'grid'
        img.onload = () => {
            if (img.dataset.avatarSrc !== url) return
            img.style.display = 'block'
            initial.style.display = 'none'
        }
        img.onerror = () => {
            if (img.dataset.avatarSrc !== url) return
            img.style.display = 'none'
            initial.style.display = 'grid'
        }
        img.src = url
        return
    }

    if (img.complete && img.naturalWidth > 0) {
        img.style.display = 'block'
        initial.style.display = 'none'
    }
}

function avatarTheme(avatar: string): string {
    switch (avatar.trim().toLowerCase()) {
        case 'keeper':
            return 'linear-gradient(180deg, #374b63 0%, #1a222d 100%)'
        case 'player':
            return 'linear-gradient(180deg, #243947 0%, #11191f 100%)'
        default:
            return 'linear-gradient(180deg, #313b3c 0%, #151a1b 100%)'
    }
}

function avatarInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('')
    return initials || '?'
}

import { CommandHintBar, type CommandHint } from './command-hint-bar'
import { ToastStack } from './toast-stack'
import {
    UiMeter,
    UiSlot,
    button,
    el,
    fatalOverlay,
    panel,
    sectionTitle,
    type Disposable,
    type UiChild,
    type UiWidget,
} from './primitives'

export interface HudVitals {
    health: number
    maxHealth: number
    mana: number
    maxMana: number
    stamina: number
    maxStamina: number
}

export interface HudInventory {
    gold: number
    potions: number
    arrows: number
}

export interface HudLoadoutSlot {
    label: string
    icon: string
    kind?: string
    item?: HudInventoryItem
}

export interface HudArmorySlot {
    slot: string
    label: string
    icon: string
    item: HudInventoryItem | null
}

export interface HudInventoryItem {
    id: string
    category: string
    label: string
    icon: string
    count?: number
    equipSlot?: string
    loadoutKind?: string
}

export interface HudLoadout {
    activeSlot: number
    weaponSlots: HudLoadoutSlot[]
    armorySlots: HudArmorySlot[]
    backpackSlots: Array<HudInventoryItem | null>
    spellSlots: HudInventoryItem[]
}

export type HudInventoryRequest =
    { type: 'equipBackpack'; index: number; target: 'weapon'; slotIndex: number } |
    { type: 'equipBackpack'; index: number; target: 'armor'; slotIndex: number } |
    { type: 'equipSpell'; index: number; slotIndex: number } |
    { type: 'clearWeapon'; slotIndex: number } |
    { type: 'clearArmor'; slotIndex: number } |
    { type: 'dropBackpack'; index: number }

export type HudRegion =
    'top-left' |
    'top-center' |
    'top-right' |
    'bottom-left' |
    'bottom-center' |
    'bottom-right'

export class GameHud implements Disposable {
    readonly element: HTMLDivElement
    readonly toast: ToastStack
    private readonly regions = new Map<HudRegion, HTMLDivElement>()
    private readonly disposables: Disposable[] = []
    private readonly meters: Record<'health' | 'mana' | 'stamina', UiMeter>
    private readonly inventorySlots: Record<'gold' | 'potions' | 'arrows', UiSlot>
    private readonly weaponSlots: UiSlot[]
    private readonly inventoryWeaponSlots: UiSlot[]
    private readonly armorySlots: UiSlot[]
    private readonly backpackSlots: UiSlot[]
    private readonly spellSlots: UiSlot[]
    private readonly shieldSlot: UiSlot
    private readonly inventoryPanel: HTMLDivElement
    private readonly dropButton: HTMLButtonElement
    private readonly requests: HudInventoryRequest[] = []
    private currentLoadout: HudLoadout | null = null
    private selected: { source: 'backpack' | 'spell'; index: number } | null = null
    private inventoryOpen = false

    constructor(parent: HTMLElement = document.body) {
        this.element = el('div', { className: 'ui-root ui-hud' })
        for (const region of [
            'top-left',
            'top-center',
            'top-right',
            'bottom-left',
            'bottom-center',
            'bottom-right',
        ] as HudRegion[]) {
            const node = el('div', { className: `ui-hud__${region}` })
            this.regions.set(region, node)
            this.element.appendChild(node)
        }
        parent.appendChild(this.element)
        this.toast = new ToastStack(parent)

        const built = this.createDefaultLayout()
        this.meters = built.meters
        this.inventorySlots = built.inventorySlots
        this.weaponSlots = built.weaponSlots
        this.inventoryWeaponSlots = built.inventoryWeaponSlots
        this.armorySlots = built.armorySlots
        this.backpackSlots = built.backpackSlots
        this.spellSlots = built.spellSlots
        this.shieldSlot = built.shieldSlot
        this.inventoryPanel = built.inventoryPanel
        this.dropButton = built.dropButton
    }

    add(region: HudRegion, child: HTMLElement | UiWidget): void {
        const node = child instanceof HTMLElement ? child : child.element
        this.regions.get(region)?.appendChild(node)
        if (!(child instanceof HTMLElement)) this.disposables.push(child)
    }

    addStack(region: HudRegion, children: UiChild[]): HTMLDivElement {
        const stack = el('div', { className: 'ui-stack', children })
        this.add(region, stack)
        return stack
    }

    setCommandHints(hints: CommandHint[]): CommandHintBar {
        const bar = new CommandHintBar(hints)
        bar.element.classList.add('ui-command-bar--compact')
        this.add('top-right', bar)
        return bar
    }

    setVitals(vitals: HudVitals): void {
        this.meters.health.setValue(vitals.health, vitals.maxHealth)
        this.meters.mana.setValue(vitals.mana, vitals.maxMana)
        this.meters.stamina.setValue(vitals.stamina, vitals.maxStamina)
    }

    setInventory(inventory: HudInventory): void {
        this.inventorySlots.gold.setCount(inventory.gold)
        this.inventorySlots.potions.setCount(inventory.potions)
        this.inventorySlots.arrows.setCount(inventory.arrows)
    }

    setLoadout(loadout: HudLoadout): void {
        this.currentLoadout = loadout
        for (let i = 0; i < this.weaponSlots.length; i++) {
            const slot = loadout.weaponSlots[i]
            this.weaponSlots[i]?.setContent({
                icon: slot?.icon ?? '.',
                label: slot?.label ?? 'Empty',
                key: String(i + 1),
            })
            this.weaponSlots[i]?.setActive(loadout.activeSlot === i)
            this.weaponSlots[i]?.setMuted(!slot || slot.label === 'Empty')

            this.inventoryWeaponSlots[i]?.setContent({
                icon: slot?.icon ?? '.',
                label: slot?.label ?? 'Empty',
                key: String(i + 1),
            })
            this.inventoryWeaponSlots[i]?.setActive(loadout.activeSlot === i)
            this.inventoryWeaponSlots[i]?.setMuted(!slot || slot.label === 'Empty')
        }

        for (let i = 0; i < this.armorySlots.length; i++) {
            const slot = loadout.armorySlots[i]
            this.armorySlots[i]?.setContent({
                icon: slot?.icon ?? '.',
                label: slot?.item ? `${slot.label}: ${slot.item.label}` : slot?.label ?? 'Empty',
                count: slot?.item?.label ?? '',
            })
            this.armorySlots[i]?.setMuted(!slot?.item)
        }
        for (let i = 0; i < this.backpackSlots.length; i++) {
            const item = loadout.backpackSlots[i]
            this.backpackSlots[i]?.setContent({
                icon: item?.icon ?? '.',
                label: item?.label ?? 'Empty',
                count: item?.count ?? '',
            })
            this.backpackSlots[i]?.setMuted(!item)
        }
        for (let i = 0; i < this.spellSlots.length; i++) {
            const item = loadout.spellSlots[i]
            this.spellSlots[i]?.setContent({
                icon: item?.icon ?? '.',
                label: item?.label ?? 'Empty',
            })
            this.spellSlots[i]?.setMuted(!item)
        }
        this.refreshInventorySelection()
    }

    consumeInventoryRequests(): HudInventoryRequest[] {
        if (this.requests.length === 0) return []
        return this.requests.splice(0)
    }

    isInventoryOpen(): boolean {
        return this.inventoryOpen
    }

    setInventoryOpen(open: boolean): void {
        this.inventoryOpen = open
        this.inventoryPanel.hidden = !open
        this.inventoryPanel.setAttribute('aria-hidden', open ? 'false' : 'true')
    }

    setShieldRaised(raised: boolean): void {
        this.shieldSlot.setActive(raised)
    }

    notify(message: string): void {
        this.toast.show(message)
    }

    fatal(message: string): HTMLElement {
        return fatalOverlay(message)
    }

    dispose(): void {
        for (const disposable of this.disposables) disposable.dispose()
        this.disposables.length = 0
        this.toast.dispose()
        this.element.remove()
    }

    private createDefaultLayout(): {
        meters: Record<'health' | 'mana' | 'stamina', UiMeter>
        inventorySlots: Record<'gold' | 'potions' | 'arrows', UiSlot>
        weaponSlots: UiSlot[]
        inventoryWeaponSlots: UiSlot[]
        armorySlots: UiSlot[]
        backpackSlots: UiSlot[]
        spellSlots: UiSlot[]
        shieldSlot: UiSlot
        inventoryPanel: HTMLDivElement
        dropButton: HTMLButtonElement
    } {
        const meters = {
            health: new UiMeter({ label: 'Health', tone: 'health', current: 100, max: 100 }),
            mana: new UiMeter({ label: 'Mana', tone: 'mana', current: 60, max: 60 }),
            stamina: new UiMeter({ label: 'Stamina', tone: 'stamina', current: 100, max: 100 }),
        }
        const statusPanel = panel({
            className: 'ui-hud-panel ui-hud-status',
            children: [
                el('div', {
                    className: 'ui-hud-status__identity',
                    children: [
                        el('div', { className: 'ui-hud-status__mark', text: 'P' }),
                        el('div', {
                            className: 'ui-hud-status__nameplate',
                            children: [
                                el('span', { className: 'ui-hud-status__name', text: 'Adventurer' }),
                                el('span', { className: 'ui-hud-status__state', text: 'Ready' }),
                            ],
                        }),
                    ],
                }),
                el('div', {
                    className: 'ui-hud-status__meters',
                    children: [meters.health.element, meters.mana.element, meters.stamina.element],
                }),
            ],
        })

        const inventorySlots = {
            gold: new UiSlot({ icon: 'G', label: 'Gold', count: 0, onClick: () => this.selectBackpackSlot(0) }),
            potions: new UiSlot({ icon: '+', label: 'Potion', count: 0, onClick: () => this.selectBackpackSlot(1) }),
            arrows: new UiSlot({ icon: 'AR', label: 'Arrows', count: 0, onClick: () => this.selectBackpackSlot(2) }),
        }
        const armorySlots = Array.from({ length: 6 }, (_, i) =>
            new UiSlot({ icon: '.', label: 'Empty', muted: true, onClick: () => this.clickArmorSlot(i) }))
        const inventoryWeaponSlots = Array.from({ length: 4 }, (_, i) =>
            new UiSlot({ icon: '.', label: 'Empty', key: String(i + 1), muted: true, onClick: () => this.clickWeaponSlot(i) }))
        const backpackSlots = Array.from({ length: 24 }, (_, i) =>
            new UiSlot({ icon: '.', label: 'Empty', muted: true, onClick: () => this.selectBackpackSlot(i) }))
        const spellSlots = Array.from({ length: 6 }, (_, i) =>
            new UiSlot({ icon: '.', label: 'Empty', muted: true, onClick: () => this.selectSpellSlot(i) }))
        const dropButton = button({
            label: 'Drop',
            icon: 'v',
            disabled: true,
            onClick: () => this.dropSelectedItem(),
        })
        dropButton.classList.add('ui-inventory-drop-button')
        const inventoryWindow = panel({
            title: 'Inventory',
            className: 'ui-hud-panel ui-hud-inventory-window',
            children: [
                el('div', {
                    className: 'ui-hud-inventory-layout',
                    children: [
                        el('aside', {
                            className: 'ui-hud-equipment-column',
                            children: [
                                sectionTitle('Weapon Slots'),
                                el('div', {
                                    className: 'ui-slot-grid ui-slot-grid--weapon-panel',
                                    children: inventoryWeaponSlots.map((slot) => slot.element),
                                }),
                                sectionTitle('Armor'),
                                el('div', {
                                    className: 'ui-slot-grid ui-slot-grid--armory',
                                    children: armorySlots.map((slot) => slot.element),
                                }),
                            ],
                        }),
                        el('section', {
                            className: 'ui-hud-inventory-grid-panel',
                            children: [
                                sectionTitle('Backpack'),
                                el('div', {
                                    className: 'ui-slot-grid ui-slot-grid--inventory',
                                    children: backpackSlots.map((slot) => slot.element),
                                }),
                                el('div', {
                                    className: 'ui-hud-inventory-actions',
                                    children: [
                                        el('span', {
                                            className: 'ui-hud-inventory-hint',
                                            text: 'Select item, then choose a highlighted slot.',
                                        }),
                                        dropButton,
                                    ],
                                }),
                                sectionTitle('Spells'),
                                el('div', {
                                    className: 'ui-slot-grid ui-slot-grid--spells',
                                    children: spellSlots.map((slot) => slot.element),
                                }),
                            ],
                        }),
                    ],
                }),
            ],
        })
        const inventoryPanel = el('div', {
            className: 'ui-hud-inventory-overlay',
            children: [inventoryWindow],
        })
        inventoryPanel.hidden = true
        inventoryPanel.setAttribute('aria-hidden', 'true')

        const shieldSlot = new UiSlot({ icon: 'SH', label: 'Shield', key: 'Shift' })
        const weaponSlots = [
            new UiSlot({ icon: 'SW', label: 'Sword', key: '1', active: true }),
            new UiSlot({ icon: 'BW', label: 'Bow', key: '2' }),
            new UiSlot({ icon: 'AP', label: 'Air Push', key: '3' }),
            new UiSlot({ icon: '.', label: 'Empty', key: '4', muted: true }),
        ]
        const skillPanel = panel({
            className: 'ui-hud-panel ui-hud-skills',
            children: [
                el('div', {
                    className: 'ui-slot-grid ui-slot-grid--skills',
                    children: [
                        ...weaponSlots.map((slot) => slot.element),
                        shieldSlot.element,
                    ],
                }),
            ],
        })

        this.add('top-left', statusPanel)
        this.element.appendChild(inventoryPanel)
        this.add('bottom-center', skillPanel)

        return {
            meters,
            inventorySlots,
            weaponSlots,
            inventoryWeaponSlots,
            armorySlots,
            backpackSlots,
            spellSlots,
            shieldSlot,
            inventoryPanel,
            dropButton,
        }
    }

    private selectBackpackSlot(index: number): void {
        const item = this.currentLoadout?.backpackSlots[index]
        this.selected = item ? { source: 'backpack', index } : null
        this.refreshInventorySelection()
    }

    private selectSpellSlot(index: number): void {
        const item = this.currentLoadout?.spellSlots[index]
        this.selected = item ? { source: 'spell', index } : null
        this.refreshInventorySelection()
    }

    private clickWeaponSlot(slotIndex: number): void {
        if (this.selected) {
            const item = this.selectedItem()
            if (!item || !isWeaponCompatible(item)) return
            if (this.selected.source === 'backpack') {
                this.requests.push({ type: 'equipBackpack', index: this.selected.index, target: 'weapon', slotIndex })
            } else {
                this.requests.push({ type: 'equipSpell', index: this.selected.index, slotIndex })
            }
            this.selected = null
            this.refreshInventorySelection()
            return
        }
        const slot = this.currentLoadout?.weaponSlots[slotIndex]
        if (!slot || slot.label === 'Empty') return
        this.requests.push({ type: 'clearWeapon', slotIndex })
    }

    private clickArmorSlot(slotIndex: number): void {
        if (this.selected) {
            const item = this.selectedItem()
            const slot = this.currentLoadout?.armorySlots[slotIndex]
            if (!item || this.selected.source !== 'backpack' || item.equipSlot !== slot?.slot) return
            this.requests.push({ type: 'equipBackpack', index: this.selected.index, target: 'armor', slotIndex })
            this.selected = null
            this.refreshInventorySelection()
            return
        }
        const slot = this.currentLoadout?.armorySlots[slotIndex]
        if (!slot?.item) return
        this.requests.push({ type: 'clearArmor', slotIndex })
    }

    private dropSelectedItem(): void {
        if (this.selected?.source !== 'backpack') return
        this.requests.push({ type: 'dropBackpack', index: this.selected.index })
        this.selected = null
        this.refreshInventorySelection()
    }

    private selectedItem(): HudInventoryItem | null {
        if (!this.selected || !this.currentLoadout) return null
        return this.selected.source === 'backpack'
            ? this.currentLoadout.backpackSlots[this.selected.index] ?? null
            : this.currentLoadout.spellSlots[this.selected.index] ?? null
    }

    private refreshInventorySelection(): void {
        const item = this.selectedItem()
        for (let i = 0; i < this.backpackSlots.length; i++) {
            this.backpackSlots[i]?.setSelected(this.selected?.source === 'backpack' && this.selected.index === i)
            this.backpackSlots[i]?.setCompatible(false)
        }
        for (let i = 0; i < this.spellSlots.length; i++) {
            this.spellSlots[i]?.setSelected(this.selected?.source === 'spell' && this.selected.index === i)
            this.spellSlots[i]?.setCompatible(false)
        }
        for (let i = 0; i < this.inventoryWeaponSlots.length; i++) {
            this.inventoryWeaponSlots[i]?.setCompatible(!!item && isWeaponCompatible(item))
        }
        for (let i = 0; i < this.armorySlots.length; i++) {
            const slot = this.currentLoadout?.armorySlots[i]
            this.armorySlots[i]?.setCompatible(!!item && this.selected?.source === 'backpack' && item.equipSlot === slot?.slot)
        }
        this.dropButton.disabled = !(this.selected?.source === 'backpack' && item)
    }
}

function isWeaponCompatible(item: HudInventoryItem): boolean {
    return item.equipSlot === 'weapon' || item.category === 'spell' || !!item.loadoutKind
}

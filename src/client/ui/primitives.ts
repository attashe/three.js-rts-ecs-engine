export type UiChild = Node | string | number | null | undefined | false

export interface UiElementOptions<K extends keyof HTMLElementTagNameMap> {
    className?: string
    text?: string
    title?: string
    attrs?: Partial<Record<string, string>>
    children?: UiChild[]
    onClick?: (event: MouseEvent) => void
}

export interface Disposable {
    dispose(): void
}

export interface UiWidget extends Disposable {
    readonly element: HTMLElement
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options: UiElementOptions<K> = {},
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    if (options.className) node.className = options.className
    if (options.text !== undefined) node.textContent = options.text
    if (options.title) node.title = options.title
    if (options.attrs) {
        for (const [key, value] of Object.entries(options.attrs)) {
            if (value !== undefined) node.setAttribute(key, value)
        }
    }
    if (options.onClick) {
        node.addEventListener('click', (event) => options.onClick?.(event as MouseEvent))
    }
    appendChildren(node, options.children)
    return node
}

export function appendChildren(parent: HTMLElement, children: UiChild[] | undefined): void {
    if (!children) return
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue
        parent.append(child instanceof Node ? child : document.createTextNode(String(child)))
    }
}

export interface ButtonOptions {
    label?: string
    title?: string
    icon?: string
    primary?: boolean
    disabled?: boolean
    onClick?: (event: MouseEvent) => void
}

export function button(options: ButtonOptions): HTMLButtonElement {
    const className = options.primary ? 'ui-button ui-button--primary' : 'ui-button'
    const node = el('button', {
        className,
        title: options.title,
        onClick: options.onClick,
        children: [
            options.icon ? el('span', { text: options.icon, attrs: { 'aria-hidden': 'true' } }) : null,
            options.label ? el('span', { text: options.label }) : null,
        ],
    })
    node.type = 'button'
    node.disabled = options.disabled ?? false
    return node
}

export function iconButton(options: ButtonOptions & { icon: string }): HTMLButtonElement {
    const node = button({ ...options, label: undefined })
    node.classList.add('ui-icon-button')
    node.textContent = options.icon
    node.setAttribute('aria-label', options.label ?? options.title ?? options.icon)
    return node
}

export interface PanelOptions {
    title?: string
    className?: string
    flat?: boolean
    actions?: UiChild[]
    children?: UiChild[]
}

export function panel(options: PanelOptions = {}): HTMLDivElement {
    const root = el('div', {
        className: [
            'ui-panel',
            options.flat ? 'ui-panel--flat' : '',
            options.className ?? '',
        ].filter(Boolean).join(' '),
    })
    if (options.title || options.actions?.length) {
        root.append(el('div', {
            className: 'ui-panel__header',
            children: [
                options.title ? el('h2', { className: 'ui-panel__title', text: options.title }) : el('span'),
                options.actions?.length ? el('div', { className: 'ui-toolbar', children: options.actions }) : null,
            ],
        }))
    }
    root.append(el('div', { className: 'ui-panel__body', children: options.children }))
    return root
}

export function sectionTitle(text: string): HTMLSpanElement {
    return el('span', { className: 'ui-section-title', text })
}

export function toolbar(children: UiChild[], vertical = false): HTMLDivElement {
    return el('div', {
        className: vertical ? 'ui-toolbar ui-toolbar--vertical' : 'ui-toolbar',
        children,
    })
}

export function toolbarSeparator(): HTMLSpanElement {
    return el('span', { className: 'ui-toolbar__separator', attrs: { role: 'separator' } })
}

export function kbd(text: string): HTMLElement {
    return el('kbd', { className: 'ui-kbd', text })
}

export type MeterTone = 'health' | 'mana' | 'stamina' | 'neutral'

export interface MeterOptions {
    label: string
    tone?: MeterTone
    current?: number
    max?: number
}

export class UiMeter implements UiWidget {
    readonly element: HTMLDivElement
    private readonly fill: HTMLDivElement
    private readonly value: HTMLSpanElement
    private valueKey = ''

    constructor(options: MeterOptions) {
        this.fill = el('div', {
            className: `ui-meter__fill ui-meter__fill--${options.tone ?? 'neutral'}`,
        })
        this.value = el('span', { className: 'ui-meter__value' })
        this.element = el('div', {
            className: 'ui-meter',
            children: [
                el('div', {
                    className: 'ui-meter__header',
                    children: [
                        el('span', { className: 'ui-meter__label', text: options.label }),
                        this.value,
                    ],
                }),
                el('div', { className: 'ui-meter__track', children: [this.fill] }),
            ],
        })
        this.setValue(options.current ?? 0, options.max ?? 1)
    }

    setValue(current: number, max: number): void {
        const safeMax = Math.max(1, max)
        const safeCurrent = Math.max(0, Math.min(safeMax, current))
        const nextKey = `${safeCurrent.toFixed(3)}|${safeMax.toFixed(3)}`
        if (nextKey === this.valueKey) return
        this.valueKey = nextKey
        const pct = safeCurrent / safeMax
        this.fill.style.transform = `scaleX(${pct.toFixed(4)})`
        this.value.textContent = `${Math.ceil(safeCurrent)} / ${Math.ceil(safeMax)}`
        this.element.setAttribute('aria-valuenow', safeCurrent.toFixed(0))
        this.element.setAttribute('aria-valuemax', safeMax.toFixed(0))
    }

    dispose(): void {
        this.element.remove()
    }
}

export interface SlotOptions {
    icon: string
    label: string
    key?: string
    count?: number | string
    active?: boolean
    muted?: boolean
    onClick?: (event: MouseEvent) => void
}

export class UiSlot implements UiWidget {
    readonly element: HTMLDivElement
    private readonly icon: HTMLSpanElement
    private readonly keycap: HTMLElement | null
    private readonly count: HTMLSpanElement
    private readonly label: HTMLSpanElement
    private iconText: string
    private labelText: string
    private keyText: string
    private countText = '\0'
    private active: boolean
    private muted: boolean
    private selected = false
    private compatible = false

    constructor(options: SlotOptions) {
        this.iconText = options.icon
        this.labelText = options.label
        this.keyText = options.key ?? ''
        this.active = !!options.active
        this.muted = !!options.muted
        this.icon = el('span', { className: 'ui-slot__icon', text: options.icon })
        this.keycap = options.key ? kbd(options.key) : null
        this.count = el('span', { className: 'ui-slot__count' })
        this.label = el('span', { className: 'ui-slot__label', text: options.label })
        this.element = el('div', {
            className: [
                'ui-slot',
                options.active ? 'ui-slot--active' : '',
                options.muted ? 'ui-slot--muted' : '',
            ].filter(Boolean).join(' '),
            title: options.label,
            onClick: options.onClick,
            children: [
                this.icon,
                this.keycap,
                this.count,
                this.label,
            ],
        })
        this.setCount(options.count ?? '')
    }

    setContent(options: Partial<SlotOptions>): void {
        if (options.icon !== undefined && options.icon !== this.iconText) {
            this.iconText = options.icon
            this.icon.textContent = options.icon
        }
        if (options.label !== undefined && options.label !== this.labelText) {
            this.labelText = options.label
            this.label.textContent = options.label
            this.element.title = options.label
        }
        if (options.key !== undefined && this.keycap && options.key !== this.keyText) {
            this.keyText = options.key
            this.keycap.textContent = options.key
        }
        if (options.count !== undefined) this.setCount(options.count)
    }

    setCount(value: number | string): void {
        const text = typeof value === 'number' ? String(value) : value
        if (text === this.countText) return
        this.countText = text
        this.count.textContent = text
        this.count.hidden = text.length === 0
    }

    setActive(active: boolean): void {
        if (active === this.active) return
        this.active = active
        this.element.classList.toggle('ui-slot--active', active)
    }

    setMuted(muted: boolean): void {
        if (muted === this.muted) return
        this.muted = muted
        this.element.classList.toggle('ui-slot--muted', muted)
    }

    setSelected(selected: boolean): void {
        if (selected === this.selected) return
        this.selected = selected
        this.element.classList.toggle('ui-slot--selected', selected)
    }

    setCompatible(compatible: boolean): void {
        if (compatible === this.compatible) return
        this.compatible = compatible
        this.element.classList.toggle('ui-slot--compatible', compatible)
    }

    dispose(): void {
        this.element.remove()
    }
}

export function fatalOverlay(message: string): HTMLDivElement {
    const node = el('div', { className: 'ui-fatal', text: message })
    document.body.appendChild(node)
    return node
}

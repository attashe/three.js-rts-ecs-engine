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

export function fatalOverlay(message: string): HTMLDivElement {
    const node = el('div', { className: 'ui-fatal', text: message })
    document.body.appendChild(node)
    return node
}

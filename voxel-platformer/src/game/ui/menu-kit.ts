// Shared DOM widgets + styling for the game's full-screen menus (pause menu,
// title screen, level select, help, controls rebind, endgame credits). Keeps
// one consistent look and avoids duplicating the overlay/button/slider CSS.

/** A dimmed full-viewport overlay host. Hidden by default; toggle with
 *  `setOverlayVisible`. Centres its content via grid. */
export function createOverlayRoot(zIndex: number): HTMLDivElement {
    const root = document.createElement('div')
    Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        zIndex: String(zIndex),
        display: 'none',
        placeItems: 'center',
        background: 'rgba(3, 7, 10, 0.54)',
        color: '#eef6f2',
        font: '14px ui-sans-serif, system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>)
    return root
}

/** The centred card the menu content lives in. */
export function createShell(width = 460): HTMLDivElement {
    const shell = document.createElement('div')
    Object.assign(shell.style, {
        width: `min(${width}px, calc(100vw - 32px))`,
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        background: 'rgba(13, 18, 21, 0.94)',
        border: '1px solid rgba(238, 246, 242, 0.18)',
        boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
        borderRadius: '8px',
        padding: '18px',
    } satisfies Partial<CSSStyleDeclaration>)
    return shell
}

export function setOverlayVisible(root: HTMLElement, visible: boolean): void {
    root.style.display = visible ? 'grid' : 'none'
    root.style.pointerEvents = visible ? 'auto' : 'none'
    root.setAttribute('aria-hidden', visible ? 'false' : 'true')
}

export function setPanelVisible(panel: HTMLElement, visible: boolean): void {
    panel.style.display = visible ? 'block' : 'none'
    panel.setAttribute('aria-hidden', visible ? 'false' : 'true')
}

export function panelTitle(text: string, size = 18): HTMLHeadingElement {
    const title = document.createElement('h1')
    title.textContent = text
    Object.assign(title.style, {
        margin: '0 0 14px',
        fontSize: `${size}px`,
        lineHeight: '1.2',
        letterSpacing: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    return title
}

export function menuButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.onclick = onClick
    Object.assign(button.style, {
        display: 'block',
        width: '100%',
        minHeight: '40px',
        margin: '8px 0',
        padding: '9px 12px',
        borderRadius: '6px',
        border: '1px solid rgba(238, 246, 242, 0.24)',
        background: 'rgba(33, 44, 48, 0.92)',
        color: '#eef6f2',
        font: '600 13px ui-sans-serif, system-ui, sans-serif',
        textAlign: 'left',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)
    button.onmouseenter = () => { button.style.background = 'rgba(48, 64, 69, 0.96)' }
    button.onmouseleave = () => { button.style.background = 'rgba(33, 44, 48, 0.92)' }
    return button
}

export function checkboxRow(
    labelText: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
): { row: HTMLLabelElement; input: HTMLInputElement } {
    const label = document.createElement('label')
    Object.assign(label.style, {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        gap: '10px',
        margin: '12px 0',
        color: 'rgba(238, 246, 242, 0.78)',
        cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>)

    const text = document.createElement('span')
    text.textContent = labelText

    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = checked
    input.onchange = () => onChange(input.checked)

    label.append(text, input)
    return { row: label, input }
}

export function sliderRow(
    labelText: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): HTMLLabelElement {
    const label = document.createElement('label')
    Object.assign(label.style, {
        display: 'grid',
        gridTemplateColumns: '92px minmax(0, 1fr) 42px',
        alignItems: 'center',
        gap: '10px',
        margin: '12px 0',
    } satisfies Partial<CSSStyleDeclaration>)

    const text = document.createElement('span')
    text.textContent = labelText
    text.style.color = 'rgba(238, 246, 242, 0.78)'

    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.style.width = '100%'

    const output = document.createElement('span')
    output.textContent = `${Math.round(value * 100)}%`
    output.style.textAlign = 'right'
    output.style.fontVariantNumeric = 'tabular-nums'

    input.oninput = () => {
        const next = Number(input.value)
        output.textContent = `${Math.round(next * 100)}%`
        onChange(next)
    }

    label.append(text, input, output)
    return label
}

export function keyBadge(key: string): HTMLSpanElement {
    const badge = document.createElement('span')
    badge.textContent = key
    Object.assign(badge.style, {
        minWidth: '24px',
        padding: '3px 7px',
        borderRadius: '4px',
        border: '1px solid rgba(238, 246, 242, 0.22)',
        background: 'rgba(238, 246, 242, 0.08)',
        color: '#eef6f2',
        font: '600 11px ui-monospace, monospace',
        textAlign: 'center',
    } satisfies Partial<CSSStyleDeclaration>)
    return badge
}

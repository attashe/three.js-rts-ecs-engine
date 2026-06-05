/**
 * Tiny DOM input builders used by the FX demo's palette and
 * constructor panels. Each returns an element that emits `input`
 * events when its value changes — callers wire up listeners via
 * standard `addEventListener`.
 *
 * Keep this file UI-only — no FX system or Three imports.
 */

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
}

export interface SliderField {
    row: HTMLElement
    input: HTMLInputElement
    value: HTMLElement
    setValue(v: number): void
}

/** Number slider with a label on the left and a numeric readout on the right. */
export function sliderField(opts: {
    label: string
    min: number
    max: number
    step: number
    initial: number
    decimals?: number
    suffix?: string
}): SliderField {
    const row = el('div', 'field')
    const label = el('label', undefined, opts.label)
    const input = el('input')
    input.type = 'range'
    input.min = String(opts.min)
    input.max = String(opts.max)
    input.step = String(opts.step)
    input.value = String(opts.initial)
    const value = el('span', 'value')
    const decimals = opts.decimals ?? (opts.step >= 1 ? 0 : opts.step >= 0.1 ? 1 : 2)
    const fmt = (v: number) => `${v.toFixed(decimals)}${opts.suffix ?? ''}`
    value.textContent = fmt(opts.initial)
    input.addEventListener('input', () => { value.textContent = fmt(parseFloat(input.value)) })
    row.append(label, input, value)
    return {
        row,
        input,
        value,
        setValue(v) {
            const clamped = Math.max(opts.min, Math.min(opts.max, v))
            input.value = String(clamped)
            value.textContent = fmt(clamped)
        },
    }
}

export interface NumberField {
    row: HTMLElement
    input: HTMLInputElement
    setValue(v: number): void
}

/** Compact number input with a label on the left. */
export function numberField(opts: {
    label: string
    min?: number
    max?: number
    step?: number
    initial: number
}): NumberField {
    const row = el('div', 'field')
    const label = el('label', undefined, opts.label)
    const input = el('input')
    input.type = 'number'
    if (opts.min !== undefined) input.min = String(opts.min)
    if (opts.max !== undefined) input.max = String(opts.max)
    input.step = String(opts.step ?? 0.1)
    input.value = String(opts.initial)
    input.style.flex = '1'
    row.append(label, input)
    return {
        row,
        input,
        setValue(v) { input.value = String(v) },
    }
}

export interface ColorField {
    row: HTMLElement
    input: HTMLInputElement
    setValue(hex: string): void
}

export function colorField(opts: { label: string; initial: string }): ColorField {
    const row = el('div', 'field')
    const label = el('label', undefined, opts.label)
    const input = el('input')
    input.type = 'color'
    input.value = normalizeHex(opts.initial)
    const text = el('span', 'value')
    text.textContent = input.value
    input.addEventListener('input', () => { text.textContent = input.value })
    row.append(label, input, text)
    return {
        row,
        input,
        setValue(hex) {
            input.value = normalizeHex(hex)
            text.textContent = input.value
        },
    }
}

export interface CheckboxField {
    row: HTMLElement
    input: HTMLInputElement
    setValue(b: boolean): void
}

export function checkboxField(opts: { label: string; initial: boolean }): CheckboxField {
    const row = el('label', 'field')
    row.style.cursor = 'pointer'
    const input = el('input')
    input.type = 'checkbox'
    input.checked = opts.initial
    const span = el('span')
    span.textContent = opts.label
    row.append(input, span)
    return {
        row,
        input,
        setValue(b) { input.checked = b },
    }
}

export interface TextField {
    row: HTMLElement
    input: HTMLInputElement
    setValue(v: string): void
}

export function textField(opts: { label: string; initial: string; placeholder?: string }): TextField {
    const row = el('div', 'field')
    const label = el('label', undefined, opts.label)
    const input = el('input')
    input.type = 'text'
    input.value = opts.initial
    if (opts.placeholder) input.placeholder = opts.placeholder
    input.style.flex = '1'
    row.append(label, input)
    return {
        row,
        input,
        setValue(v) { input.value = v },
    }
}

/** Collapsible <details>-style section with a title. */
export function collapsible(title: string, defaultOpen = false): { root: HTMLDetailsElement; body: HTMLElement } {
    const root = el('details')
    if (defaultOpen) root.open = true
    const summary = document.createElement('summary')
    summary.textContent = title
    summary.style.cursor = 'pointer'
    summary.style.fontSize = '11px'
    summary.style.fontWeight = '600'
    summary.style.letterSpacing = '0.08em'
    summary.style.textTransform = 'uppercase'
    summary.style.color = 'rgba(217, 247, 255, 0.8)'
    summary.style.padding = '4px 0'
    summary.style.userSelect = 'none'
    const body = el('div')
    body.style.paddingLeft = '4px'
    root.append(summary, body)
    return { root, body }
}

/** Three-up grid for XYZ inputs. Returns the three inputs in order. */
export function vec3Field(opts: {
    label: string
    initial: { x: number; y: number; z: number }
    min?: number
    step?: number
}): { row: HTMLElement; inputs: [HTMLInputElement, HTMLInputElement, HTMLInputElement]; setValue(v: { x: number; y: number; z: number }): void } {
    const wrap = el('div')
    const lab = el('div', 'field')
    const label = el('label', undefined, opts.label)
    lab.appendChild(label)
    wrap.appendChild(lab)
    const grid = el('div', 'compact-grid')
    const mk = (v: number): HTMLInputElement => {
        const i = el('input')
        i.type = 'number'
        if (opts.min !== undefined) i.min = String(opts.min)
        i.step = String(opts.step ?? 0.1)
        i.value = String(v)
        return i
    }
    const xi = mk(opts.initial.x)
    const yi = mk(opts.initial.y)
    const zi = mk(opts.initial.z)
    grid.append(xi, yi, zi)
    wrap.appendChild(grid)
    return {
        row: wrap,
        inputs: [xi, yi, zi],
        setValue(v) { xi.value = String(v.x); yi.value = String(v.y); zi.value = String(v.z) },
    }
}

function normalizeHex(s: string): string {
    let v = s.trim()
    if (!v.startsWith('#')) v = '#' + v
    if (v.length === 4) v = '#' + v.slice(1).split('').map((c) => c + c).join('')
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#ffffff'
}

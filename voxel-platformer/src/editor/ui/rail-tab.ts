import { railBlockIndex } from '../../engine/voxel/palette'
import type { RailCartFacing } from '../../engine/ecs/world'
import type { MountEditorPanelOptions } from './index'
import { formatCoord, sectionEl, type RefreshableElement } from './common'

const FACINGS: readonly RailCartFacing[] = ['north', 'east', 'south', 'west']

export function buildRailTab(opts: MountEditorPanelOptions): RefreshableElement {
    const state = opts.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const paintSection = sectionEl('Rail Blocks')
    const paintBtn = document.createElement('button')
    paintBtn.className = 'vpe-button'
    paintBtn.textContent = 'Paint rail'
    paintBtn.title = 'Select the adaptive Rail block and switch to Paint mode.'
    paintBtn.onclick = () => {
        state.activeBlock = railBlockIndex(opts.chunks.palette)
        state.mode = 'paint'
    }
    paintSection.appendChild(paintBtn)

    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Rails adapt into straights, corners, T-junctions, crosses, and one-block slopes from neighboring rail cells.'
    paintSection.appendChild(hint)
    root.appendChild(paintSection)

    const cartSection = sectionEl('Cart Placement')
    const placeBtn = document.createElement('button')
    placeBtn.className = 'vpe-button'
    placeBtn.textContent = 'Place cart'
    placeBtn.title = 'LMB places a cart on a rail block. RMB removes nearest cart.'
    placeBtn.onclick = () => {
        state.mode = 'place-rail-cart'
    }
    cartSection.appendChild(placeBtn)

    const facingRow = document.createElement('div')
    facingRow.className = 'vpe-field'
    const facingLabel = document.createElement('span')
    facingLabel.className = 'vpe-field-label'
    facingLabel.textContent = 'Front:'
    const facingSelect = document.createElement('select')
    facingSelect.className = 'vpe-input'
    for (const facing of FACINGS) {
        const option = document.createElement('option')
        option.value = facing
        option.textContent = facing
        facingSelect.appendChild(option)
    }
    facingSelect.value = state.railCartFacing
    facingSelect.onchange = () => {
        state.railCartFacing = facingSelect.value as RailCartFacing
        const selected = selectedCart()
        if (selected) selected.front = state.railCartFacing
    }
    facingRow.append(facingLabel, facingSelect)
    cartSection.appendChild(facingRow)

    const speed = numberField('Speed:', state.railCartSpeed, 0.1, 12, 0.1, (value) => {
        state.railCartSpeed = value
        const selected = selectedCart()
        if (selected) selected.speed = value
    })
    cartSection.appendChild(speed.row)

    const radius = numberField('Interact:', state.railCartInteractionRadius, 0.25, 6, 0.05, (value) => {
        state.railCartInteractionRadius = value
        const selected = selectedCart()
        if (selected) selected.interactionRadius = value
    })
    cartSection.appendChild(radius.row)

    const enabled = checkboxField('Enabled', state.railCartEnabled, (checked) => {
        state.railCartEnabled = checked
        const selected = selectedCart()
        if (selected) selected.enabled = checked
    })
    cartSection.appendChild(enabled.row)
    root.appendChild(cartSection)

    const listSection = sectionEl('Placed Carts')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    let fingerprint = ''

    function selectedCart() {
        return state.railCarts.find((cart) => cart.id === state.selectedRailCartId) ?? null
    }

    function refresh(): void {
        placeBtn.classList.toggle('active', state.mode === 'place-rail-cart')
        const selected = selectedCart()
        if (selected) {
            if (state.railCartFacing !== selected.front) state.railCartFacing = selected.front
            if (state.railCartSpeed !== selected.speed) state.railCartSpeed = selected.speed ?? 4
            if (state.railCartInteractionRadius !== selected.interactionRadius) state.railCartInteractionRadius = selected.interactionRadius ?? 1.65
            if (state.railCartEnabled !== (selected.enabled !== false)) state.railCartEnabled = selected.enabled !== false
        }
        if (facingSelect.value !== state.railCartFacing) facingSelect.value = state.railCartFacing
        syncNumber(speed.input, state.railCartSpeed)
        syncNumber(radius.input, state.railCartInteractionRadius)
        if (enabled.input.checked !== state.railCartEnabled) enabled.input.checked = state.railCartEnabled

        const fp = state.railCarts.map((cart) => `${cart.id}:${cart.railCell.x},${cart.railCell.y},${cart.railCell.z}:${cart.front}:${cart.speed}:${cart.interactionRadius}:${cart.enabled}:${cart.id === state.selectedRailCartId}`).join('|')
        if (fp === fingerprint) return
        fingerprint = fp
        renderList()
    }

    function renderList(): void {
        list.innerHTML = ''
        if (state.railCarts.length === 0) {
            const empty = document.createElement('span')
            empty.className = 'vpe-list-empty'
            empty.textContent = 'No carts placed yet.'
            list.appendChild(empty)
            return
        }
        for (const cart of state.railCarts) {
            const row = document.createElement('div')
            row.className = 'vpe-list-item'
            if (cart.id === state.selectedRailCartId) row.classList.add('active')
            const label = document.createElement('button')
            label.className = 'vpe-link-button'
            label.textContent = `${cart.id} @ ${formatCoord(cart.railCell)}`
            label.onclick = () => {
                state.selectedRailCartId = cart.id
                state.railCartFacing = cart.front
                state.railCartSpeed = cart.speed ?? 4
                state.railCartInteractionRadius = cart.interactionRadius ?? 1.65
                state.railCartEnabled = cart.enabled !== false
                fingerprint = ''
                refresh()
            }
            const remove = document.createElement('button')
            remove.textContent = 'remove'
            remove.onclick = () => {
                const idx = state.railCarts.indexOf(cart)
                if (idx >= 0) state.railCarts.splice(idx, 1)
                if (state.selectedRailCartId === cart.id) state.selectedRailCartId = null
                fingerprint = ''
                refresh()
            }
            row.append(label, remove)
            list.appendChild(row)
        }
    }

    refresh()
    return { element: root, refresh }
}

function numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.oninput = () => {
        const parsed = Number(input.value)
        if (!Number.isFinite(parsed)) return
        onChange(Math.max(min, Math.min(max, parsed)))
    }
    row.append(span, input)
    return { row, input }
}

function checkboxField(
    label: string,
    value: boolean,
    onChange: (value: boolean) => void,
): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.onchange = () => onChange(input.checked)
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    row.append(input, span)
    return { row, input }
}

function syncNumber(input: HTMLInputElement, value: number): void {
    if (document.activeElement === input) return
    const next = String(value)
    if (input.value !== next) input.value = next
}

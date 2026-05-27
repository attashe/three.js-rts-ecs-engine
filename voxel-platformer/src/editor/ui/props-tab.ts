import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorPropScatterItem, EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import { PROP_KINDS, PROP_LABELS, type EditorPropKind } from '../../game/props/prop-types'
import { sectionEl, trimForList, type RefreshableElement } from './common'

export interface PropsTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

/**
 * Editor → Props tab. Pick a kind, tune yaw / scale / grid-snap, then
 * left-click in the world to place. The placed-props list at the
 * bottom mirrors `editorState.props` and offers per-prop delete + a
 * "go to" jump that selects the prop (so the editor's selection
 * gizmo, if active, frames it).
 *
 * Placement itself is handled by `createPropPlaceSystem` — this tab
 * only exposes the authoring choices.
 */
export function buildPropsTab(opts: PropsTabOptions): RefreshableElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const state = opts.editorState

    // ── Mode toggle: single placement vs scatter brush.
    const modeSection = sectionEl('Mode')
    const modeRow = document.createElement('div')
    modeRow.className = 'vpe-row'
    const modeBtn = document.createElement('button')
    modeBtn.className = 'vpe-button'
    modeBtn.textContent = 'Place'
    modeBtn.title = 'Single prop placement. LMB places, RMB removes the nearest.'
    modeBtn.onclick = () => {
        state.mode = state.mode === 'place-prop' ? 'select' : 'place-prop'
        refresh()
    }
    const scatterModeBtn = document.createElement('button')
    scatterModeBtn.className = 'vpe-button'
    scatterModeBtn.textContent = 'Scatter'
    scatterModeBtn.title = 'Scatter the configured prop list over the brush footprint. LMB scatters, RMB clears props in the brush.'
    scatterModeBtn.onclick = () => {
        state.mode = state.mode === 'scatter-props' ? 'select' : 'scatter-props'
        refresh()
    }
    modeRow.append(modeBtn, scatterModeBtn)
    modeSection.appendChild(modeRow)
    root.appendChild(modeSection)

    // ── Kind picker. Grid of buttons; clicking changes
    //    state.propKind so subsequent placements use it.
    const kindSection = sectionEl('Kind')
    const kindGrid = document.createElement('div')
    kindGrid.style.display = 'grid'
    kindGrid.style.gridTemplateColumns = 'repeat(3, 1fr)'
    kindGrid.style.gap = '4px'
    const kindButtons = new Map<EditorPropKind, HTMLButtonElement>()
    for (const kind of PROP_KINDS) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = PROP_LABELS[kind]
        btn.title = `Place ${PROP_LABELS[kind]} on next click`
        btn.onclick = () => {
            state.propKind = kind
            refresh()
        }
        kindGrid.appendChild(btn)
        kindButtons.set(kind, btn)
    }
    kindSection.appendChild(kindGrid)
    root.appendChild(kindSection)

    // ── Placement settings: grid-align checkbox + yaw + scale.
    const settingsSection = sectionEl('Placement')

    const gridRow = document.createElement('label')
    gridRow.className = 'vpe-field'
    gridRow.style.cursor = 'pointer'
    const gridInput = document.createElement('input')
    gridInput.type = 'checkbox'
    gridInput.checked = state.propGridAlign
    gridInput.onchange = () => {
        state.propGridAlign = gridInput.checked
    }
    const gridSpan = document.createElement('span')
    gridSpan.textContent = 'Align to voxel grid'
    gridSpan.title = 'On: snap XZ to the centre of the hit cell. Off: place at the exact ray-hit point — useful for scattered foliage.'
    gridRow.append(gridSpan, gridInput)
    settingsSection.appendChild(gridRow)

    const yawRow = sliderField('Yaw', 0, Math.PI * 2, 0.05, state.propYaw, (v) => {
        state.propYaw = v
    }, (v) => `${((v * 180) / Math.PI).toFixed(0)}°`)
    settingsSection.appendChild(yawRow.element)

    const scaleRow = sliderField('Scale', 0.4, 2.5, 0.05, state.propScale, (v) => {
        state.propScale = v
    }, (v) => `${v.toFixed(2)}×`)
    settingsSection.appendChild(scaleRow.element)

    const placedHint = document.createElement('div')
    placedHint.className = 'vpe-hint'
    placedHint.textContent = 'LMB places. RMB removes the prop closest to the cursor.'
    settingsSection.appendChild(placedHint)

    root.appendChild(settingsSection)

    const scatterSection = sectionEl('Scatter Brush')
    const shapeRow = document.createElement('div')
    shapeRow.className = 'vpe-row'
    const squareBtn = document.createElement('button')
    squareBtn.className = 'vpe-button'
    squareBtn.textContent = 'Square'
    squareBtn.onclick = () => {
        state.propScatterShape = 'square'
        refresh()
    }
    const circleBtn = document.createElement('button')
    circleBtn.className = 'vpe-button'
    circleBtn.textContent = 'Circle'
    circleBtn.onclick = () => {
        state.propScatterShape = 'circle'
        refresh()
    }
    shapeRow.append(squareBtn, circleBtn)
    scatterSection.appendChild(shapeRow)

    const scatterSizeRow = sliderField('Size', 1, 15, 1, state.propScatterSize, (v) => {
        state.propScatterSize = Math.max(1, Math.floor(v))
    }, (v) => `${Math.floor(v)} cells`)
    scatterSection.appendChild(scatterSizeRow.element)

    const addScatterBtn = document.createElement('button')
    addScatterBtn.className = 'vpe-button'
    addScatterBtn.textContent = 'Add selected kind'
    addScatterBtn.title = 'Add the currently selected prop kind to the scatter recipe list.'
    addScatterBtn.onclick = () => {
        state.propScatterItems.push(defaultScatterItem(state, nextScatterItemId(state)))
        refresh()
    }
    scatterSection.appendChild(addScatterBtn)

    const scatterHint = document.createElement('div')
    scatterHint.className = 'vpe-hint'
    scatterHint.textContent = 'Density is expected props per brush cell. Scatter strokes create normal instanced props.'
    scatterSection.appendChild(scatterHint)

    const scatterListEl = document.createElement('div')
    scatterListEl.style.display = 'flex'
    scatterListEl.style.flexDirection = 'column'
    scatterListEl.style.gap = '6px'
    scatterListEl.style.maxHeight = '260px'
    scatterListEl.style.overflowY = 'auto'
    scatterSection.appendChild(scatterListEl)
    root.appendChild(scatterSection)

    // ── Placed list. Rebuilt on every refresh from
    //    `editorState.props` so external mutations (place / remove)
    //    show up.
    const listSection = sectionEl('Placed')
    const listEl = document.createElement('div')
    listEl.style.display = 'flex'
    listEl.style.flexDirection = 'column'
    listEl.style.gap = '4px'
    listEl.style.maxHeight = '180px'
    listEl.style.overflowY = 'auto'
    listSection.appendChild(listEl)
    root.appendChild(listSection)

    let lastListFingerprint = ''
    let lastScatterFingerprint = ''
    function rebuildList(): void {
        const fp = state.props.map((p) => `${p.id}:${p.kind}:${p.position.x.toFixed(1)}:${p.position.y.toFixed(1)}:${p.position.z.toFixed(1)}`).join('|')
        if (fp === lastListFingerprint) return
        lastListFingerprint = fp
        listEl.innerHTML = ''
        if (state.props.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'vpe-hint'
            empty.textContent = 'No props placed yet.'
            listEl.appendChild(empty)
            return
        }
        for (const prop of state.props) {
            const row = document.createElement('div')
            row.className = 'vpe-row'
            row.style.alignItems = 'center'
            const span = document.createElement('span')
            const coord = `${prop.position.x.toFixed(1)},${prop.position.y.toFixed(1)},${prop.position.z.toFixed(1)}`
            span.textContent = `${trimForList(PROP_LABELS[prop.kind] ?? prop.kind, 12)} · ${coord}`
            span.title = `${prop.id} (yaw ${((prop.yaw * 180) / Math.PI).toFixed(0)}°, scale ${prop.scale.toFixed(2)}×)`
            span.style.flex = '1'
            span.style.cursor = 'pointer'
            span.onclick = () => { state.selectedPropId = prop.id }
            const del = document.createElement('button')
            del.className = 'vpe-button'
            del.textContent = '✕'
            del.title = 'Remove this prop'
            del.style.padding = '2px 6px'
            del.onclick = () => {
                const idx = state.props.findIndex((p) => p.id === prop.id)
                if (idx >= 0) {
                    state.props.splice(idx, 1)
                    if (state.selectedPropId === prop.id) state.selectedPropId = null
                    refresh()
                }
            }
            row.append(span, del)
            listEl.appendChild(row)
        }
    }

    function rebuildScatterList(): void {
        const fp = [
            state.propScatterItems.map((item) => [
                item.id,
                item.kind,
                item.enabled,
                item.density,
                item.scale,
                item.scaleVariation,
                item.yaw,
                item.yawVariation,
            ].join(':')).join('|'),
        ].join('|')
        if (fp === lastScatterFingerprint) return
        lastScatterFingerprint = fp
        scatterListEl.innerHTML = ''
        if (state.propScatterItems.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'vpe-hint'
            empty.textContent = 'No scatter items yet.'
            scatterListEl.appendChild(empty)
            return
        }
        for (const item of state.propScatterItems) {
            scatterListEl.appendChild(buildScatterItemRow(state, item, refresh))
        }
    }

    function refresh(): void {
        modeBtn.classList.toggle('active', state.mode === 'place-prop')
        scatterModeBtn.classList.toggle('active', state.mode === 'scatter-props')
        squareBtn.classList.toggle('active', state.propScatterShape === 'square')
        circleBtn.classList.toggle('active', state.propScatterShape === 'circle')
        for (const [kind, btn] of kindButtons) {
            btn.classList.toggle('active', kind === state.propKind)
        }
        if (gridInput.checked !== state.propGridAlign) gridInput.checked = state.propGridAlign
        yawRow.sync(state.propYaw)
        scaleRow.sync(state.propScale)
        scatterSizeRow.sync(state.propScatterSize)
        rebuildList()
        rebuildScatterList()
    }

    refresh()
    return { element: root, refresh }
}

function defaultScatterItem(state: EditorState, id: string): EditorPropScatterItem {
    return {
        id,
        kind: state.propKind,
        enabled: true,
        density: 0.35,
        scale: Math.max(0.1, state.propScale),
        scaleVariation: 0.25,
        yaw: state.propYaw,
        yawVariation: Math.PI,
    }
}

function nextScatterItemId(state: EditorState): string {
    let n = state.propScatterItems.length + 1
    const taken = new Set(state.propScatterItems.map((item) => item.id))
    while (taken.has(`scatter-${n}`)) n++
    return `scatter-${n}`
}

function buildScatterItemRow(
    state: EditorState,
    item: EditorPropScatterItem,
    refresh: () => void,
): HTMLElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '4px'
    root.style.padding = '6px'
    root.style.border = '1px solid rgba(217, 247, 255, 0.14)'
    root.style.borderRadius = '4px'
    root.style.background = 'rgba(0, 0, 0, 0.18)'

    const header = document.createElement('div')
    header.className = 'vpe-row'
    header.style.alignItems = 'center'

    const enabled = document.createElement('input')
    enabled.type = 'checkbox'
    enabled.checked = item.enabled
    enabled.title = 'Include this item in scatter strokes'
    enabled.onchange = () => { item.enabled = enabled.checked }

    const kindSelect = document.createElement('select')
    kindSelect.className = 'vpe-input'
    kindSelect.style.flex = '1'
    for (const kind of PROP_KINDS) {
        const opt = document.createElement('option')
        opt.value = kind
        opt.textContent = PROP_LABELS[kind]
        kindSelect.appendChild(opt)
    }
    kindSelect.value = item.kind
    kindSelect.onchange = () => {
        if ((PROP_KINDS as readonly string[]).includes(kindSelect.value)) {
            item.kind = kindSelect.value as EditorPropKind
            refresh()
        }
    }

    const del = document.createElement('button')
    del.className = 'vpe-button'
    del.textContent = 'Remove'
    del.onclick = () => {
        const idx = state.propScatterItems.findIndex((candidate) => candidate.id === item.id)
        if (idx >= 0) state.propScatterItems.splice(idx, 1)
        refresh()
    }

    header.append(enabled, kindSelect, del)
    root.appendChild(header)

    const rowA = document.createElement('div')
    rowA.className = 'vpe-row'
    rowA.append(
        numberField('Density', item.density, 0, 5, 0.05, (v) => { item.density = clamp(v, 0, 5) }),
        numberField('Scale', item.scale, 0.1, 4, 0.05, (v) => { item.scale = clamp(v, 0.1, 4) }),
    )
    root.appendChild(rowA)

    const rowB = document.createElement('div')
    rowB.className = 'vpe-row'
    rowB.append(
        numberField('Scale var %', item.scaleVariation * 100, 0, 200, 1, (v) => {
            item.scaleVariation = clamp(v / 100, 0, 2)
        }),
        numberField('Yaw °', (item.yaw * 180) / Math.PI, 0, 360, 1, (v) => {
            item.yaw = degToRad(wrapDegrees(v))
        }),
    )
    root.appendChild(rowB)

    const rowC = document.createElement('div')
    rowC.className = 'vpe-row'
    rowC.append(numberField('Yaw var °', (item.yawVariation * 180) / Math.PI, 0, 360, 1, (v) => {
        item.yawVariation = degToRad(clamp(v, 0, 360))
    }))
    root.appendChild(rowC)

    return root
}

function numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    field.style.flex = '1 1 100px'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(roundForInput(value))
    input.style.width = '68px'
    input.onchange = () => {
        const next = parseFloat(input.value)
        if (!Number.isFinite(next)) {
            input.value = String(roundForInput(value))
            return
        }
        onChange(next)
    }
    field.append(labelEl, input)
    return field
}

interface SliderField {
    element: HTMLElement
    sync: (value: number) => void
}

function degToRad(degrees: number): number {
    return (degrees * Math.PI) / 180
}

function wrapDegrees(value: number): number {
    if (!Number.isFinite(value)) return 0
    return ((value % 360) + 360) % 360
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}

function roundForInput(value: number): number {
    return Math.round(value * 100) / 100
}

function sliderField(
    label: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    onChange: (value: number) => void,
    formatValue: (value: number) => string,
): SliderField {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = `${label}:`
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(initial)
    input.style.flex = '2'
    const valueLabel = document.createElement('span')
    valueLabel.className = 'vpe-hint'
    valueLabel.style.minWidth = '48px'
    valueLabel.style.textAlign = 'right'
    valueLabel.textContent = formatValue(initial)
    input.oninput = () => {
        const v = parseFloat(input.value)
        if (!Number.isFinite(v)) return
        valueLabel.textContent = formatValue(v)
        onChange(v)
    }
    row.append(labelEl, input, valueLabel)
    return {
        element: row,
        sync(value: number) {
            if (parseFloat(input.value) === value) return
            input.value = String(value)
            valueLabel.textContent = formatValue(value)
        },
    }
}

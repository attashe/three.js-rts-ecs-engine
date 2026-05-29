import { BLOCK } from '../../engine/voxel/palette'
import {
    findTerrainSurface,
    type TerrainBrushShape,
    type TerrainFalloff,
    type TerrainTool,
} from '../terrain-brush'
import type { MountEditorPanelOptions } from './index'
import { colorToSwatchCss, sectionEl, type RefreshableElement } from './common'

const TOOLS: Array<{ id: TerrainTool; label: string; title: string }> = [
    { id: 'sculpt', label: 'Sculpt', title: 'LMB raises terrain; RMB lowers terrain.' },
    { id: 'flatten', label: 'Flatten', title: 'Move terrain columns toward the target height.' },
    { id: 'smooth', label: 'Smooth', title: 'Average nearby column heights.' },
    { id: 'ramp', label: 'Ramp', title: 'Drag direction and length; the slope runs from the first-click surface to Target Y.' },
    { id: 'paint-surface', label: 'Paint', title: 'Paint only the top terrain material with the active palette block.' },
]

const SHAPES: Array<{ id: TerrainBrushShape; label: string }> = [
    { id: 'circle', label: 'Circle' },
    { id: 'square', label: 'Square' },
]

const FALLOFFS: Array<{ id: TerrainFalloff; label: string }> = [
    { id: 'smooth', label: 'Smooth' },
    { id: 'linear', label: 'Linear' },
    { id: 'hard', label: 'Hard' },
]

export function buildTerrainTab(opts: MountEditorPanelOptions): RefreshableElement {
    const { chunks, editorState: state } = opts
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const modeSection = sectionEl('Mode')
    const modeBtn = document.createElement('button')
    modeBtn.className = 'vpe-button'
    modeBtn.textContent = 'Use Terrain Tool'
    modeBtn.title = 'Switch the viewport to terrain brush editing.'
    modeBtn.onclick = () => {
        state.mode = state.mode === 'terrain' ? 'select' : 'terrain'
        refresh()
    }
    modeSection.appendChild(modeBtn)
    root.appendChild(modeSection)

    const toolSection = sectionEl('Tool')
    const toolRow = document.createElement('div')
    toolRow.className = 'vpe-row'
    const toolButtons = new Map<TerrainTool, HTMLButtonElement>()
    for (const tool of TOOLS) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = tool.label
        btn.title = tool.title
        btn.onclick = () => {
            state.terrainTool = tool.id
            if (tool.id === 'flatten' && state.cursor) {
                state.terrainTargetHeight = state.cursor.y
            } else if (tool.id === 'ramp' && state.cursor) {
                const surface = findTerrainSurface(chunks, chunks.palette, state.cursor.x, state.cursor.z, state.terrainMinY, state.terrainMaxY)
                const y = surface?.y ?? state.cursor.y
                if (state.terrainTargetHeight === y) {
                    state.terrainTargetHeight = y + Math.max(1, Math.round(state.terrainStrength || 1))
                }
            }
            refresh()
        }
        toolButtons.set(tool.id, btn)
        toolRow.appendChild(btn)
    }
    toolSection.appendChild(toolRow)
    root.appendChild(toolSection)

    const brushSection = sectionEl('Brush')
    const shapeRow = document.createElement('div')
    shapeRow.className = 'vpe-row'
    const shapeButtons = new Map<TerrainBrushShape, HTMLButtonElement>()
    for (const shape of SHAPES) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = shape.label
        btn.onclick = () => {
            state.terrainBrushShape = shape.id
            refresh()
        }
        shapeButtons.set(shape.id, btn)
        shapeRow.appendChild(btn)
    }
    brushSection.appendChild(shapeRow)
    const radius = numberField('Radius:', state.terrainRadius, 0, 32, 1, (value) => {
        state.terrainRadius = clamp(Math.floor(value), 0, 32)
    })
    const strength = numberField('Strength:', state.terrainStrength, 0, 8, 0.25, (value) => {
        state.terrainStrength = clamp(value, 0, 8)
    })
    const falloff = selectField('Falloff:', state.terrainFalloff, FALLOFFS, (value) => {
        state.terrainFalloff = value as TerrainFalloff
    })
    brushSection.append(radius.field, strength.field, falloff.field)
    root.appendChild(brushSection)

    const heightSection = sectionEl('Height')
    const target = numberField('Target Y:', state.terrainTargetHeight, -64, 256, 1, (value) => {
        state.terrainTargetHeight = Math.round(value)
    })
    const sampleBtn = document.createElement('button')
    sampleBtn.className = 'vpe-button'
    sampleBtn.textContent = 'Sample cursor'
    sampleBtn.title = 'Copy the current cursor terrain surface height into Target Y.'
    sampleBtn.onclick = () => {
        const cursor = state.cursor
        if (cursor) {
            const surface = findTerrainSurface(chunks, chunks.palette, cursor.x, cursor.z, state.terrainMinY, state.terrainMaxY)
            state.terrainTargetHeight = surface?.y ?? cursor.y
        } else {
            state.terrainTargetHeight = state.workingPlaneY
        }
        refresh()
    }
    heightSection.append(target.field, sampleBtn)
    root.appendChild(heightSection)

    const materialSection = sectionEl('Materials')
    const activeHint = document.createElement('div')
    activeHint.className = 'vpe-hint'
    const fillSelect = document.createElement('select')
    fillSelect.className = 'vpe-input'
    fillSelect.onchange = () => {
        const next = Number.parseInt(fillSelect.value, 10)
        if (Number.isFinite(next)) state.terrainFillBlock = next
    }
    materialSection.append(activeHint, labelWrap('Fill:', fillSelect), checkboxField('Repaint top with active block', state.terrainRepaintTop, (checked) => {
        state.terrainRepaintTop = checked
    }))
    root.appendChild(materialSection)

    const boundsSection = sectionEl('Bounds')
    const minY = numberField('Min Y:', state.terrainMinY, -128, 512, 1, (value) => {
        state.terrainMinY = Math.round(value)
    })
    const maxY = numberField('Max Y:', state.terrainMaxY, -128, 512, 1, (value) => {
        state.terrainMaxY = Math.round(value)
    })
    boundsSection.append(minY.field, maxY.field)
    root.appendChild(boundsSection)

    let paletteFingerprint = ''

    function rebuildFillOptions(): void {
        paletteFingerprint = chunks.palette.entries.map((entry, index) => `${index}:${entry.name}`).join('|')
        fillSelect.innerHTML = ''
        for (let i = 1; i < chunks.palette.entries.length; i++) {
            const entry = chunks.palette.entries[i]!
            const option = document.createElement('option')
            option.value = String(i)
            option.textContent = `${i}. ${entry.name}`
            fillSelect.appendChild(option)
        }
    }

    function refresh(): void {
        modeBtn.classList.toggle('active', state.mode === 'terrain')
        for (const [tool, btn] of toolButtons) btn.classList.toggle('active', state.terrainTool === tool)
        for (const [shape, btn] of shapeButtons) btn.classList.toggle('active', state.terrainBrushShape === shape)
        syncNumber(radius.input, state.terrainRadius)
        syncNumber(strength.input, state.terrainStrength)
        syncSelect(falloff.select, state.terrainFalloff)
        syncNumber(target.input, state.terrainTargetHeight)
        syncNumber(minY.input, state.terrainMinY)
        syncNumber(maxY.input, state.terrainMaxY)

        const fp = chunks.palette.entries.map((entry, index) => `${index}:${entry.name}`).join('|')
        if (fp !== paletteFingerprint) rebuildFillOptions()
        if (state.terrainFillBlock <= 0 || state.terrainFillBlock >= chunks.palette.entries.length) {
            state.terrainFillBlock = BLOCK.dirt
        }
        syncSelect(fillSelect, String(state.terrainFillBlock))

        const active = chunks.palette.entries[state.activeBlock]
        activeHint.textContent = active
            ? `Top material uses active palette: ${state.activeBlock}. ${active.name}`
            : 'Top material uses active palette.'
        if (active) {
            activeHint.style.borderLeft = `12px solid ${colorToSwatchCss(active)}`
            activeHint.style.paddingLeft = '6px'
        }
    }

    rebuildFillOptions()
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
): { field: HTMLElement; input: HTMLInputElement } {
    const field = document.createElement('label')
    field.className = 'vpe-field'
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
    input.onchange = () => {
        const parsed = Number.parseFloat(input.value)
        if (Number.isFinite(parsed)) onChange(parsed)
    }
    field.append(span, input)
    return { field, input }
}

function selectField<T extends string>(
    label: string,
    value: T,
    options: readonly { id: T; label: string }[],
    onChange: (value: T) => void,
): { field: HTMLElement; select: HTMLSelectElement } {
    const select = document.createElement('select')
    select.className = 'vpe-input'
    for (const option of options) {
        const el = document.createElement('option')
        el.value = option.id
        el.textContent = option.label
        select.appendChild(el)
    }
    select.value = value
    select.onchange = () => onChange(select.value as T)
    return { field: labelWrap(label, select), select }
}

function checkboxField(label: string, value: boolean, onChange: (checked: boolean) => void): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.onchange = () => onChange(input.checked)
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    field.append(input, span)
    return field
}

function labelWrap(label: string, control: HTMLElement): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    field.append(span, control)
    return field
}

function syncNumber(input: HTMLInputElement, value: number): void {
    if (document.activeElement === input) return
    const next = String(value)
    if (input.value !== next) input.value = next
}

function syncSelect(select: HTMLSelectElement, value: string): void {
    if (document.activeElement === select) return
    if (select.value !== value) select.value = value
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import { STRUCTURE_PREFABS } from '../../procedural-structures/prefabs'
import { rotatedSize, type StructureAnchor, type StructureRotation } from '../../procedural-structures/asset'
import type { StructureKind } from '../../procedural-structures/types'
import { resolveStructureAsset } from '../structure-asset-cache'
import { sectionEl, type RefreshableElement } from './common'

export interface StructuresTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

const PROCEDURAL_KINDS: StructureKind[] = ['house', 'tree', 'tower', 'mixed']
const ROTATIONS: StructureRotation[] = [0, 90, 180, 270]
const ANCHORS: { id: StructureAnchor; label: string }[] = [
    { id: 'bottom-center', label: 'Bottom centre' },
    { id: 'center', label: 'Centre' },
    { id: 'min-corner', label: 'Min corner' },
]

/**
 * Structures tab — configures and places multi-block structures. Two
 * source kinds share one placement flow:
 *  - **Prefab** — hand-authored set-pieces (portal gate, well, ...).
 *  - **Procedural** — seeded tree / house / tower / mixed generators.
 *
 * A live size readout shows the exact bounding box + voxel count for the
 * current configuration, and the 3D preview (structure-preview system)
 * mirrors it on the cursor. Placement bakes the voxels into the level as
 * one undoable edit.
 */
export function buildStructuresTab(opts: StructuresTabOptions): RefreshableElement {
    const state = opts.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // Mode toggle.
    const modeSection = sectionEl('Mode')
    const placeBtn = button('Place Structure', 'LMB stamps the structure at the cursor. RMB rerolls the seed (procedural).')
    placeBtn.onclick = () => {
        state.mode = state.mode === 'place-structure' ? 'select' : 'place-structure'
        refresh()
    }
    modeSection.appendChild(placeBtn)
    root.appendChild(modeSection)

    // Source kind.
    const sourceSection = sectionEl('Source')
    const sourceRow = document.createElement('div')
    sourceRow.className = 'vpe-row'
    const prefabBtn = button('Prefab', 'Hand-authored set-pieces.')
    const proceduralBtn = button('Procedural', 'Seeded generators.')
    prefabBtn.onclick = () => { state.structureSourceKind = 'prefab'; refresh() }
    proceduralBtn.onclick = () => { state.structureSourceKind = 'procedural'; refresh() }
    sourceRow.append(prefabBtn, proceduralBtn)
    sourceSection.appendChild(sourceRow)
    root.appendChild(sourceSection)

    // Prefab picker.
    const prefabSection = sectionEl('Prefab')
    const prefabSelect = selectField(
        'Structure',
        STRUCTURE_PREFABS.map((p) => ({ value: p.id, label: p.label })),
        state.structurePrefabId,
        (value) => { state.structurePrefabId = value; refresh() },
    )
    const prefabHint = hint('')
    prefabSection.append(prefabSelect.field, prefabHint)
    root.appendChild(prefabSection)

    // Procedural controls.
    const procSection = sectionEl('Procedural')
    const kindSelect = selectField(
        'Kind',
        PROCEDURAL_KINDS.map((k) => ({ value: k, label: capitalize(k) })),
        state.structureKind,
        (value) => { state.structureKind = value as StructureKind; refresh() },
    )
    const seedRow = document.createElement('div')
    seedRow.className = 'vpe-row'
    const seedInput = numberField('Seed', state.structureSeed, 0, 999999, 1, (v) => {
        state.structureSeed = Math.max(0, Math.floor(v))
        refresh()
    })
    const randomBtn = smallButton('Random', 'Pick a random seed.')
    randomBtn.onclick = () => {
        state.structureSeed = Math.floor(Math.random() * 999999)
        refresh()
    }
    seedRow.append(seedInput, randomBtn)
    const structuralOnly = checkboxField('Structural only', state.structureStructuralOnly, (value) => {
        state.structureStructuralOnly = value
        refresh()
    })
    procSection.append(kindSelect.field, seedRow, structuralOnly)
    root.appendChild(procSection)

    // Transform (shared by both source kinds).
    const xfSection = sectionEl('Transform')
    const rotationRow = document.createElement('div')
    rotationRow.className = 'vpe-row'
    const rotLabel = document.createElement('span')
    rotLabel.className = 'vpe-field-label'
    rotLabel.textContent = 'Rotate'
    rotationRow.appendChild(rotLabel)
    const rotButtons = ROTATIONS.map((r) => {
        const b = smallButton(`${r}°`, `Rotate ${r}° about Y.`)
        b.onclick = () => { state.structureRotation = r; refresh() }
        rotationRow.appendChild(b)
        return { r, b }
    })
    const anchorSelect = selectField(
        'Anchor',
        ANCHORS.map((a) => ({ value: a.id, label: a.label })),
        state.structureAnchor,
        (value) => { state.structureAnchor = value as StructureAnchor; refresh() },
    )
    xfSection.append(rotationRow, anchorSelect.field)
    root.appendChild(xfSection)

    // Live size readout.
    const sizeSection = sectionEl('Size')
    const sizeReadout = document.createElement('div')
    sizeReadout.className = 'vpe-hint'
    sizeReadout.style.lineHeight = '1.5'
    sizeSection.appendChild(sizeReadout)
    root.appendChild(sizeSection)

    root.appendChild(hint('LMB places · RMB rerolls seed · the cursor preview shows the bounding box.'))

    function refresh(): void {
        placeBtn.classList.toggle('active', state.mode === 'place-structure')
        prefabBtn.classList.toggle('active', state.structureSourceKind === 'prefab')
        proceduralBtn.classList.toggle('active', state.structureSourceKind === 'procedural')
        prefabSection.style.display = state.structureSourceKind === 'prefab' ? '' : 'none'
        procSection.style.display = state.structureSourceKind === 'procedural' ? '' : 'none'

        syncSelect(prefabSelect.select, state.structurePrefabId)
        syncSelect(kindSelect.select, state.structureKind)
        syncSelect(anchorSelect.select, state.structureAnchor)
        const seedField = seedInput.querySelector('input') as HTMLInputElement
        if (document.activeElement !== seedField) seedField.value = String(state.structureSeed)
        ;(structuralOnly.querySelector('input') as HTMLInputElement).checked = state.structureStructuralOnly
        for (const { r, b } of rotButtons) b.classList.toggle('active', state.structureRotation === r)

        const prefab = STRUCTURE_PREFABS.find((p) => p.id === state.structurePrefabId)
        prefabHint.textContent = prefab?.description ?? ''

        updateSizeReadout()
    }

    function updateSizeReadout(): void {
        try {
            const asset = resolveStructureAsset(state, opts.chunks.palette)
            const size = rotatedSize(asset, state.structureRotation)
            sizeReadout.innerHTML = [
                `Footprint <b>${size.width} × ${size.depth}</b>`,
                `Height <b>${size.height}</b>`,
                `<b>${asset.stats.voxelCount.toLocaleString()}</b> voxels`,
            ].join('<br>')
        } catch (err) {
            sizeReadout.textContent = err instanceof Error ? err.message : String(err)
        }
    }

    refresh()
    return { element: root, refresh }
}

function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1)
}

function selectField(
    label: string,
    options: { value: string; label: string }[],
    value: string,
    onChange: (value: string) => void,
): { field: HTMLLabelElement; select: HTMLSelectElement } {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const select = document.createElement('select')
    select.className = 'vpe-input'
    for (const opt of options) {
        const o = document.createElement('option')
        o.value = opt.value
        o.textContent = opt.label
        select.appendChild(o)
    }
    select.value = value
    select.onchange = () => onChange(select.value)
    field.append(labelEl, select)
    return { field, select }
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
    field.style.flex = '1 1 70px'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.onchange = () => {
        const next = Number(input.value)
        if (!Number.isFinite(next)) {
            input.value = String(value)
            return
        }
        onChange(Math.min(max, Math.max(min, next)))
    }
    field.append(labelEl, input)
    return field
}

function checkboxField(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    field.style.cursor = 'pointer'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.onchange = () => onChange(input.checked)
    field.append(labelEl, input)
    return field
}

function button(text: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'vpe-button'
    btn.textContent = text
    btn.title = title
    return btn
}

function smallButton(text: string, title: string): HTMLButtonElement {
    const btn = button(text, title)
    btn.style.padding = '2px 6px'
    btn.style.flex = '0 0 auto'
    return btn
}

function hint(text: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'vpe-hint'
    el.textContent = text
    return el
}

function syncSelect(select: HTMLSelectElement, value: string): void {
    if (select.value !== value) select.value = value
}

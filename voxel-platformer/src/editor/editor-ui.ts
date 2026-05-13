import { DEFAULT_PALETTE, type PaletteEntry } from '../engine/voxel/palette'
import { BRUSHES, type BrushKind } from './brush'
import type { EditorState, EditorMode } from './editor-state'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import type { GameWorld } from '../engine/ecs/world'
import { saveLevelDownload, loadLevelFromFile } from './save-load'

const PANEL_CSS = `
.vpe-panel {
    /* Dock top-right so it doesn't fight the debug overlay's metrics panel
     * (top-left) on the editor page. The debug log panel is pushed to the
     * bottom on the editor page via createDebugOverlaySystem options. */
    position: fixed; top: 8px; right: 8px; width: 240px;
    max-height: calc(100vh - 16px); overflow-y: auto;
    font: 12px ui-sans-serif, system-ui, sans-serif;
    background: rgba(8, 12, 16, 0.86); color: #d9f7ff;
    padding: 10px 12px; border-radius: 6px;
    pointer-events: auto; z-index: 1000;
    display: flex; flex-direction: column; gap: 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
}
.vpe-section { display: flex; flex-direction: column; gap: 4px; }
.vpe-section h3 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0 0 2px 0; color: rgba(217, 247, 255, 0.65);
}
.vpe-row { display: flex; gap: 4px; flex-wrap: wrap; }
.vpe-swatch {
    width: 24px; height: 24px; border-radius: 3px;
    border: 2px solid transparent; cursor: pointer;
    transition: transform 80ms ease, border-color 80ms ease;
}
.vpe-swatch:hover { transform: scale(1.08); }
.vpe-swatch.active { border-color: #ffd166; }
.vpe-button {
    background: rgba(217, 247, 255, 0.1); color: inherit;
    border: 1px solid rgba(217, 247, 255, 0.25);
    padding: 4px 8px; border-radius: 3px; cursor: pointer;
    font: inherit;
}
.vpe-button:hover { background: rgba(217, 247, 255, 0.2); }
.vpe-button.active {
    background: rgba(255, 209, 102, 0.35);
    border-color: #ffd166; color: #1c1402;
}
.vpe-pickup-list {
    max-height: 140px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 2px;
    font-size: 11px; color: rgba(217, 247, 255, 0.75);
    background: rgba(0,0,0,0.25); padding: 4px 6px; border-radius: 3px;
}
.vpe-pickup-item { display: flex; justify-content: space-between; gap: 6px; }
.vpe-pickup-item button {
    background: none; border: none; color: #ff8a5a; cursor: pointer;
    padding: 0 4px; font: inherit;
}
.vpe-pickup-item button:hover { text-decoration: underline; }
.vpe-input { font: inherit; background: rgba(0,0,0,0.3); color: inherit;
    border: 1px solid rgba(217, 247, 255, 0.25); padding: 2px 4px;
    border-radius: 3px; }
.vpe-hint { font-size: 10px; color: rgba(217, 247, 255, 0.5); }
`

export interface MountEditorPanelOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
}

export function mountEditorPanel(opts: MountEditorPanelOptions): { dispose: () => void } {
    injectCss()
    const root = document.createElement('div')
    root.className = 'vpe-panel'

    root.appendChild(buildPaletteSection(opts.editorState))
    root.appendChild(buildBrushSection(opts.editorState))
    root.appendChild(buildModeSection(opts.editorState))
    const pickupSection = buildPickupSection(opts.editorState)
    root.appendChild(pickupSection.element)
    root.appendChild(buildSaveLoadSection(opts))
    root.appendChild(buildHintSection())

    document.body.appendChild(root)

    // Repaint pickup list whenever the editor state changes meaningfully.
    // We poll cheaply on a fixed cadence — no observer overhead.
    const interval = window.setInterval(() => pickupSection.refresh(), 250)

    return {
        dispose() {
            window.clearInterval(interval)
            root.remove()
        },
    }
}

function buildPaletteSection(state: EditorState): HTMLElement {
    const section = sectionEl('Palette')
    const row = document.createElement('div')
    row.className = 'vpe-row'
    section.appendChild(row)
    const swatches: HTMLElement[] = []
    for (let i = 1; i < DEFAULT_PALETTE.entries.length; i++) {
        const entry = DEFAULT_PALETTE.entries[i]!
        const swatch = document.createElement('div')
        swatch.className = 'vpe-swatch'
        swatch.title = `${entry.name} (${i})`
        swatch.style.background = colorToCss(entry)
        swatch.onclick = () => {
            state.activeBlock = i
            for (const s of swatches) s.classList.remove('active')
            swatch.classList.add('active')
        }
        if (i === state.activeBlock) swatch.classList.add('active')
        swatches.push(swatch)
        row.appendChild(swatch)
    }
    return section
}

function buildBrushSection(state: EditorState): HTMLElement {
    const section = sectionEl('Brush')
    const row = document.createElement('div')
    row.className = 'vpe-row'
    section.appendChild(row)
    const buttons: { kind: BrushKind; btn: HTMLButtonElement }[] = []
    for (const brush of BRUSHES) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = brush.label
        btn.title = brush.hint
        btn.onclick = () => {
            state.brush = brush.kind
            for (const { btn: b } of buttons) b.classList.remove('active')
            btn.classList.add('active')
        }
        if (brush.kind === state.brush) btn.classList.add('active')
        buttons.push({ kind: brush.kind, btn })
        row.appendChild(btn)
    }
    return section
}

function buildModeSection(state: EditorState): HTMLElement {
    const section = sectionEl('Mode')
    const row = document.createElement('div')
    row.className = 'vpe-row'
    section.appendChild(row)
    const modes: { mode: EditorMode; label: string }[] = [
        { mode: 'paint', label: 'Paint' },
        { mode: 'erase', label: 'Erase' },
        { mode: 'spawn-pickup', label: 'Pickup' },
    ]
    const buttons: { mode: EditorMode; btn: HTMLButtonElement }[] = []
    for (const m of modes) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = m.label
        btn.onclick = () => {
            state.mode = m.mode
            for (const { btn: b } of buttons) b.classList.remove('active')
            btn.classList.add('active')
        }
        if (m.mode === state.mode) btn.classList.add('active')
        buttons.push({ mode: m.mode, btn })
        row.appendChild(btn)
    }
    return section
}

function buildPickupSection(state: EditorState): { element: HTMLElement; refresh: () => void } {
    const section = sectionEl('Pickups (gold)')

    const amountRow = document.createElement('div')
    amountRow.className = 'vpe-row'
    amountRow.style.alignItems = 'center'
    const amountLabel = document.createElement('span')
    amountLabel.textContent = 'Amount:'
    amountLabel.style.flex = '1'
    const amountInput = document.createElement('input')
    amountInput.className = 'vpe-input'
    amountInput.type = 'number'
    amountInput.min = '1'
    amountInput.value = String(state.pickupAmount)
    amountInput.style.width = '60px'
    amountInput.oninput = () => {
        const v = parseInt(amountInput.value, 10)
        if (Number.isFinite(v) && v >= 1) state.pickupAmount = v
    }
    amountRow.append(amountLabel, amountInput)
    section.appendChild(amountRow)

    const list = document.createElement('div')
    list.className = 'vpe-pickup-list'
    section.appendChild(list)

    function refresh(): void {
        list.innerHTML = ''
        if (state.pickups.length === 0) {
            const empty = document.createElement('span')
            empty.textContent = 'No pickups placed yet.'
            empty.style.color = 'rgba(217,247,255,0.45)'
            list.appendChild(empty)
            return
        }
        for (const pickup of state.pickups) {
            const row = document.createElement('div')
            row.className = 'vpe-pickup-item'
            const label = document.createElement('span')
            label.textContent = `gold ×${pickup.amount} @ (${Math.floor(pickup.position.x)}, ${Math.floor(pickup.position.y)}, ${Math.floor(pickup.position.z)})`
            const removeBtn = document.createElement('button')
            removeBtn.textContent = 'remove'
            removeBtn.onclick = () => {
                const i = state.pickups.indexOf(pickup)
                if (i >= 0) state.pickups.splice(i, 1)
                refresh()
            }
            row.append(label, removeBtn)
            list.appendChild(row)
        }
    }
    refresh()

    return { element: section, refresh }
}

function buildSaveLoadSection(opts: MountEditorPanelOptions): HTMLElement {
    const section = sectionEl('Level')
    const nameRow = document.createElement('div')
    nameRow.className = 'vpe-row'
    nameRow.style.alignItems = 'center'
    const nameLabel = document.createElement('span')
    nameLabel.textContent = 'Name:'
    nameLabel.style.flex = '1'
    const nameInput = document.createElement('input')
    nameInput.className = 'vpe-input'
    nameInput.type = 'text'
    nameInput.value = 'untitled-level'
    nameInput.style.flex = '2'
    nameRow.append(nameLabel, nameInput)
    section.appendChild(nameRow)

    const buttonRow = document.createElement('div')
    buttonRow.className = 'vpe-row'
    const saveBtn = document.createElement('button')
    saveBtn.className = 'vpe-button'
    saveBtn.textContent = 'Save'
    saveBtn.onclick = () => saveLevelDownload(opts.chunks, opts.editorState, nameInput.value || 'untitled-level')

    const loadBtn = document.createElement('button')
    loadBtn.className = 'vpe-button'
    loadBtn.textContent = 'Load'
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.vplevel,application/octet-stream'
    fileInput.style.display = 'none'
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0]
        if (!file) return
        try {
            const meta = await loadLevelFromFile(file, opts.world, opts.chunks, opts.editorState)
            nameInput.value = meta.name
        } catch (err) {
            console.error('Failed to load level:', err)
        } finally {
            fileInput.value = ''
        }
    }
    loadBtn.onclick = () => fileInput.click()

    buttonRow.append(saveBtn, loadBtn, fileInput)
    section.appendChild(buttonRow)
    return section
}

function buildHintSection(): HTMLElement {
    const section = sectionEl('Controls')
    const hints = [
        'WASD / arrows — pan camera',
        'Q / R — rotate camera',
        'Wheel — zoom',
        'LMB — paint',
        'RMB — erase (or remove pickup)',
        '` — toggle debug overlay',
    ]
    for (const line of hints) {
        const span = document.createElement('div')
        span.className = 'vpe-hint'
        span.textContent = line
        section.appendChild(span)
    }
    return section
}

function sectionEl(title: string): HTMLElement {
    const section = document.createElement('section')
    section.className = 'vpe-section'
    const h3 = document.createElement('h3')
    h3.textContent = title
    section.appendChild(h3)
    return section
}

function colorToCss(entry: PaletteEntry): string {
    const [r, g, b] = entry.color
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`
}

let cssInjected = false
function injectCss(): void {
    if (cssInjected) return
    cssInjected = true
    const style = document.createElement('style')
    style.textContent = PANEL_CSS
    document.head.appendChild(style)
}

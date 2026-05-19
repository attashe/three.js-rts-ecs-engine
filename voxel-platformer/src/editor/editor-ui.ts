import { DEFAULT_PALETTE, type PaletteEntry } from '../engine/voxel/palette'
import { BRUSHES, type BrushKind } from './brush'
import type { EditorState, EditorMode, EditorPiston, EditorViewMode } from './editor-state'
import { PISTON_DIRECTIONS, type PistonDirection } from './piston-direction'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import type { GameWorld } from '../engine/ecs/world'
import { saveLevelDownload, loadLevelFromFile } from './save-load'
import { launchPlaytest } from './playtest'

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
    root.appendChild(buildViewSection(opts.editorState))
    const planeSection = buildPlaneSection(opts.editorState)
    root.appendChild(planeSection.element)
    const pickupSection = buildPickupSection(opts.editorState)
    root.appendChild(pickupSection.element)
    const pistonSection = buildPistonSection(opts.editorState)
    root.appendChild(pistonSection.element)
    root.appendChild(buildSaveLoadSection(opts))
    root.appendChild(buildHintSection())

    document.body.appendChild(root)

    // Repaint the live lists + plane Y readout whenever editor state changes
    // (workingPlaneY mutates via PageUp/Down keyboard, not just UI buttons).
    const interval = window.setInterval(() => {
        pickupSection.refresh()
        pistonSection.refresh()
        planeSection.refresh()
    }, 250)

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
        { mode: 'place-piston', label: 'Piston' },
        { mode: 'place-spawn', label: 'Spawn' },
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

function buildViewSection(state: EditorState): HTMLElement {
    const section = sectionEl('View')
    const row = document.createElement('div')
    row.className = 'vpe-row'
    const modes: { mode: EditorViewMode; label: string; hint: string }[] = [
        { mode: 'iso', label: 'Iso', hint: 'Default isometric view' },
        { mode: 'top-down', label: 'Top', hint: 'Top-down — hides everything above the working plane' },
    ]
    const buttons: { mode: EditorViewMode; btn: HTMLButtonElement }[] = []
    for (const m of modes) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = m.label
        btn.title = m.hint
        btn.onclick = () => {
            state.viewMode = m.mode
            for (const { btn: b } of buttons) b.classList.remove('active')
            btn.classList.add('active')
        }
        if (m.mode === state.viewMode) btn.classList.add('active')
        buttons.push({ mode: m.mode, btn })
        row.appendChild(btn)
    }
    section.appendChild(row)
    return section
}

function buildPlaneSection(state: EditorState): { element: HTMLElement; refresh: () => void } {
    const section = sectionEl('Working plane Y')

    const row = document.createElement('div')
    row.className = 'vpe-row'
    row.style.alignItems = 'center'
    const minus = document.createElement('button')
    minus.className = 'vpe-button'
    minus.textContent = '−'
    minus.onclick = () => { state.workingPlaneY -= 1; readout.textContent = String(state.workingPlaneY); input.value = String(state.workingPlaneY) }
    const plus = document.createElement('button')
    plus.className = 'vpe-button'
    plus.textContent = '+'
    plus.onclick = () => { state.workingPlaneY += 1; readout.textContent = String(state.workingPlaneY); input.value = String(state.workingPlaneY) }
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.value = String(state.workingPlaneY)
    input.style.width = '60px'
    input.oninput = () => {
        const v = parseInt(input.value, 10)
        if (Number.isFinite(v)) {
            state.workingPlaneY = v
            readout.textContent = String(state.workingPlaneY)
        }
    }
    const readout = document.createElement('span')
    readout.textContent = String(state.workingPlaneY)
    readout.style.flex = '1'
    readout.style.textAlign = 'right'
    readout.style.color = 'rgba(255, 209, 102, 0.85)'
    row.append(minus, plus, input, readout)
    section.appendChild(row)

    const lockRow = document.createElement('div')
    lockRow.className = 'vpe-row'
    lockRow.style.alignItems = 'center'
    const lockLabel = document.createElement('label')
    lockLabel.style.display = 'flex'
    lockLabel.style.alignItems = 'center'
    lockLabel.style.gap = '6px'
    lockLabel.style.cursor = 'pointer'
    const lockBox = document.createElement('input')
    lockBox.type = 'checkbox'
    lockBox.checked = state.planeLock
    lockBox.onchange = () => { state.planeLock = lockBox.checked }
    const lockText = document.createElement('span')
    lockText.textContent = 'Lock cursor to plane'
    lockLabel.append(lockBox, lockText)
    lockRow.append(lockLabel)
    section.appendChild(lockRow)

    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'PgUp / PgDn = ±1   (hold Shift for ±4)'
    section.appendChild(hint)

    function refresh(): void {
        // Pick up keyboard-driven Y changes.
        if (input.value !== String(state.workingPlaneY)) {
            input.value = String(state.workingPlaneY)
            readout.textContent = String(state.workingPlaneY)
        }
        if (lockBox.checked !== state.planeLock) lockBox.checked = state.planeLock
    }

    return { element: section, refresh }
}

function buildPistonSection(state: EditorState): { element: HTMLElement; refresh: () => void } {
    const section = sectionEl('Piston (active in Piston mode)')

    const dirRow = document.createElement('div')
    dirRow.className = 'vpe-row'
    const dirButtons: { dir: PistonDirection; btn: HTMLButtonElement }[] = []
    for (const def of PISTON_DIRECTIONS) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = def.label
        btn.onclick = () => {
            state.pistonDirection = def.id
            for (const { btn: b } of dirButtons) b.classList.remove('active')
            btn.classList.add('active')
        }
        if (def.id === state.pistonDirection) btn.classList.add('active')
        dirButtons.push({ dir: def.id, btn })
        dirRow.appendChild(btn)
    }
    section.appendChild(dirRow)

    const distRow = document.createElement('div')
    distRow.className = 'vpe-row'
    distRow.style.alignItems = 'center'
    const distLabel = document.createElement('span')
    distLabel.textContent = 'Distance:'
    distLabel.style.flex = '1'
    const distInput = document.createElement('input')
    distInput.className = 'vpe-input'
    distInput.type = 'number'
    distInput.min = '1'
    distInput.max = '8'
    distInput.value = String(state.pistonDistance)
    distInput.style.width = '60px'
    distInput.oninput = () => {
        const v = parseInt(distInput.value, 10)
        if (Number.isFinite(v) && v >= 1) state.pistonDistance = v
    }
    distRow.append(distLabel, distInput)
    section.appendChild(distRow)

    const delayRow = document.createElement('div')
    delayRow.className = 'vpe-row'
    delayRow.style.alignItems = 'center'
    const delayLabel = document.createElement('span')
    delayLabel.textContent = 'Delay (s):'
    delayLabel.style.flex = '1'
    const delayInput = document.createElement('input')
    delayInput.className = 'vpe-input'
    delayInput.type = 'number'
    delayInput.min = '0'
    delayInput.step = '0.25'
    delayInput.value = String(state.pistonDelay)
    delayInput.style.width = '60px'
    delayInput.oninput = () => {
        const v = parseFloat(delayInput.value)
        if (Number.isFinite(v) && v >= 0) state.pistonDelay = v
    }
    delayRow.append(delayLabel, delayInput)
    section.appendChild(delayRow)

    const motionRow = document.createElement('div')
    motionRow.className = 'vpe-row'
    const motions: { id: EditorPiston['motion']; label: string }[] = [
        { id: 'teleport', label: 'Teleport' },
        { id: 'physical', label: 'Physical' },
    ]
    const motionButtons: { id: EditorPiston['motion']; btn: HTMLButtonElement }[] = []
    for (const m of motions) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = m.label
        btn.onclick = () => {
            state.pistonMotion = m.id
            for (const { btn: b } of motionButtons) b.classList.remove('active')
            btn.classList.add('active')
        }
        if (m.id === state.pistonMotion) btn.classList.add('active')
        motionButtons.push({ id: m.id, btn })
        motionRow.appendChild(btn)
    }
    section.appendChild(motionRow)

    const travelRow = document.createElement('div')
    travelRow.className = 'vpe-row'
    travelRow.style.alignItems = 'center'
    const travelLabel = document.createElement('span')
    travelLabel.textContent = 'Travel (s):'
    travelLabel.style.flex = '1'
    const travelInput = document.createElement('input')
    travelInput.className = 'vpe-input'
    travelInput.type = 'number'
    travelInput.min = '0.05'
    travelInput.step = '0.05'
    travelInput.value = String(state.pistonTravelTime)
    travelInput.style.width = '60px'
    travelInput.oninput = () => {
        const v = parseFloat(travelInput.value)
        if (Number.isFinite(v) && v > 0) state.pistonTravelTime = v
    }
    travelRow.append(travelLabel, travelInput)
    section.appendChild(travelRow)

    const policyRow = document.createElement('div')
    policyRow.className = 'vpe-row'
    const policies: { id: EditorPiston['characterPolicy']; label: string }[] = [
        { id: 'push', label: 'Push' },
        { id: 'block', label: 'Block' },
    ]
    const policyButtons: { id: EditorPiston['characterPolicy']; btn: HTMLButtonElement }[] = []
    for (const p of policies) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = p.label
        btn.onclick = () => {
            state.pistonPolicy = p.id
            for (const { btn: b } of policyButtons) b.classList.remove('active')
            btn.classList.add('active')
        }
        if (p.id === state.pistonPolicy) btn.classList.add('active')
        policyButtons.push({ id: p.id, btn })
        policyRow.appendChild(btn)
    }
    section.appendChild(policyRow)

    const list = document.createElement('div')
    list.className = 'vpe-pickup-list'
    section.appendChild(list)

    function refresh(): void {
        list.innerHTML = ''
        if (state.pistons.length === 0) {
            const empty = document.createElement('span')
            empty.textContent = 'No pistons placed yet.'
            empty.style.color = 'rgba(217,247,255,0.45)'
            list.appendChild(empty)
            return
        }
        for (const piston of state.pistons) {
            const row = document.createElement('div')
            row.className = 'vpe-pickup-item'
            const label = document.createElement('span')
            label.textContent = `(${piston.from.x},${piston.from.y},${piston.from.z}) → (${piston.to.x},${piston.to.y},${piston.to.z}) · ${piston.motion ?? 'teleport'} · delay ${piston.delay ?? piston.interval ?? 2}s · travel ${piston.travelTime ?? 1}s · ${piston.characterPolicy}`
            row.append(label)
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

    const playtestRow = document.createElement('div')
    playtestRow.className = 'vpe-row'
    const playtestBtn = document.createElement('button')
    playtestBtn.className = 'vpe-button'
    playtestBtn.textContent = 'Playtest'
    playtestBtn.title = 'Save the current level to session storage and open it in the game'
    playtestBtn.onclick = () => launchPlaytest(opts.chunks, opts.editorState, nameInput.value || 'playtest-level')
    playtestRow.append(playtestBtn)
    section.appendChild(playtestRow)
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

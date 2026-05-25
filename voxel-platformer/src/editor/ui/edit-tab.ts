import { isCollidable, isPathSurface, isRaycastTarget, occludesFaces, type Palette, type PaletteEntry } from '../../engine/voxel/palette'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { AudioAsset } from '../../engine/audio'
import { GAME_AUDIO_MANIFEST } from '../../game/audio'
import { BRUSHES, type BrushKind } from '../brush'
import { PISTON_DIRECTIONS, type PistonDirection } from '../piston-direction'
import { removePistonAt } from '../systems/piston-place-system'
import { appendMaterial, colorToHex, hexToColor, materialFingerprint } from '../palette-edit'
import { refreshPhysicalPistonVisuals } from '../../game/mechanisms'
import type { ZoneScriptAction } from '../../engine/ecs/zones'
import type {
    EditorMode,
    EditorPiston,
    EditorState,
    EditorViewMode,
    EditorZoneTriggerMode,
} from '../editor-state'
import { colorToCss, formatCoord, sectionEl, trimForList, type RefreshableElement } from './common'

export interface EditTabContext {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
}

interface ModeDef {
    mode: EditorMode
    label: string
    hint: string
}

const MODES: readonly ModeDef[] = [
    { mode: 'select', label: 'Select', hint: 'Pick movable editor objects and drag the snap-to-grid gizmo.' },
    { mode: 'paint', label: 'Paint', hint: 'LMB places the active block, RMB erases.' },
    { mode: 'erase', label: 'Erase', hint: 'LMB erases. (Same as RMB in Paint.)' },
    { mode: 'spawn-pickup', label: 'Pickup', hint: 'Drop gold piles on the working plane.' },
    { mode: 'place-piston', label: 'Piston', hint: 'Place a moving block — teleport or physical motion.' },
    { mode: 'place-spawn', label: 'Spawn', hint: 'Set the player start point.' },
    { mode: 'place-zone', label: 'Zone', hint: 'Region you can attach triggers / scripts to.' },
    { mode: 'place-sound', label: 'Sound', hint: 'Place the sound source configured in the Sound tab.' },
]

/** Edit tab. Top section is the always-visible camera + working-plane row
 *  (the user changes the plane Y constantly during editing, so it lives
 *  alongside the palette / mode toolbar rather than behind a separate
 *  tab). Below: palette, mode toolbar, and a contextual settings panel
 *  that rebuilds itself when the mode changes. */
export function buildEditTab(ctx: EditTabContext): RefreshableElement {
    const state = ctx.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const cameraPlane = buildCameraPlaneSection(state)
    root.appendChild(cameraPlane.element)

    const palette = buildPaletteSection(ctx)
    root.appendChild(palette.element)
    const modeSection = buildModeSection(state, () => switchMode())
    root.appendChild(modeSection.element)

    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.style.minHeight = '14px'
    root.appendChild(hint)

    const contextual = document.createElement('div')
    contextual.style.display = 'flex'
    contextual.style.flexDirection = 'column'
    contextual.style.gap = '10px'
    root.appendChild(contextual)

    let currentBuilder: RefreshableElement | null = null
    let shownMode: EditorMode | null = null

    function switchMode(): void {
        // Tear down whichever contextual builder was last shown so its
        // listeners (refreshes etc.) stop touching detached DOM.
        shownMode = state.mode
        contextual.innerHTML = ''
        currentBuilder = buildContextualForMode(ctx)
        if (currentBuilder) contextual.appendChild(currentBuilder.element)
        const def = MODES.find((m) => m.mode === state.mode)
        hint.textContent = def?.hint ?? ''
        modeSection.refresh()
    }
    switchMode()

    return {
        element: root,
        refresh: () => {
            cameraPlane.refresh()
            palette.refresh()
            if (shownMode !== state.mode) {
                switchMode()
                return
            }
            modeSection.refresh()
            currentBuilder?.refresh()
        },
    }
}

// ────────────────────────────────────────────────────────────────────────
// Camera + working-plane (always-visible row inside the Edit tab)
// ────────────────────────────────────────────────────────────────────────

function buildCameraPlaneSection(state: EditorState): RefreshableElement {
    const section = sectionEl('Camera / Plane')

    // View mode toggle (Iso / Top). Compact button pair.
    const viewRow = document.createElement('div')
    viewRow.className = 'vpe-row'
    const viewModes: { mode: EditorViewMode; label: string; hint: string }[] = [
        { mode: 'iso', label: 'Iso', hint: 'Default isometric view (V to toggle)' },
        { mode: 'top-down', label: 'Top', hint: 'Top-down — hides above the plane (V to toggle)' },
    ]
    const viewButtons: { mode: EditorViewMode; btn: HTMLButtonElement }[] = []
    for (const m of viewModes) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.style.flex = '1'
        btn.textContent = m.label
        btn.title = m.hint
        btn.onclick = () => { state.viewMode = m.mode; syncView() }
        if (m.mode === state.viewMode) btn.classList.add('active')
        viewButtons.push({ mode: m.mode, btn })
        viewRow.appendChild(btn)
    }
    section.appendChild(viewRow)

    // Working plane Y — − / + / number / readout in one row.
    const planeRow = document.createElement('div')
    planeRow.className = 'vpe-row'
    const yLabel = document.createElement('span')
    yLabel.className = 'vpe-field-label'
    yLabel.style.flex = '0 0 auto'
    yLabel.textContent = 'Plane Y:'
    const minus = document.createElement('button')
    minus.className = 'vpe-button'
    minus.textContent = '−'
    minus.title = 'Z'
    minus.onclick = () => { state.workingPlaneY -= 1; syncPlane() }
    const plus = document.createElement('button')
    plus.className = 'vpe-button'
    plus.textContent = '+'
    plus.title = 'X'
    plus.onclick = () => { state.workingPlaneY += 1; syncPlane() }
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.value = String(state.workingPlaneY)
    input.style.width = '54px'
    input.oninput = () => {
        const v = parseInt(input.value, 10)
        if (Number.isFinite(v)) state.workingPlaneY = v
    }
    planeRow.append(yLabel, minus, plus, input)
    section.appendChild(planeRow)

    // Plane lock toggle.
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
    lockText.textContent = 'Lock cursor to plane (L)'
    lockLabel.append(lockBox, lockText)
    section.appendChild(lockLabel)

    const shortcuts = document.createElement('div')
    shortcuts.className = 'vpe-hint'
    shortcuts.textContent = 'Z/X: plane ±1 (Shift = ±4) · V: view · L: lock'
    section.appendChild(shortcuts)

    function syncView(): void {
        for (const { mode, btn } of viewButtons) btn.classList.toggle('active', mode === state.viewMode)
    }
    function syncPlane(): void {
        if (input.value !== String(state.workingPlaneY)) input.value = String(state.workingPlaneY)
    }

    return {
        element: section,
        refresh() {
            // Hotkeys (Z/X, V, L) mutate the state outside the panel;
            // mirror back into the controls.
            syncView()
            syncPlane()
            if (lockBox.checked !== state.planeLock) lockBox.checked = state.planeLock
        },
    }
}

function buildContextualForMode(ctx: EditTabContext): RefreshableElement {
    const state = ctx.editorState
    switch (state.mode) {
        case 'select':
            return buildSelectPanel()
        case 'paint':
        case 'erase':
            return buildBrushPanel(state)
        case 'spawn-pickup':
            return buildPickupPanel(state)
        case 'place-piston':
            return buildPistonPanel(ctx)
        case 'place-spawn':
            return buildSpawnPanel()
        case 'place-zone':
            return buildZonePanel(ctx)
        case 'place-sound':
        case 'place-sound-zone':
            return buildSoundModePanel()
        case 'place-weather':
            return buildWeatherModePanel()
    }
}

// ────────────────────────────────────────────────────────────────────────
// Palette + mode toolbar
// ────────────────────────────────────────────────────────────────────────

function buildPaletteSection(ctx: EditTabContext): RefreshableElement {
    const { chunks, editorState: state } = ctx
    const section = sectionEl('Palette')
    const row = document.createElement('div')
    row.className = 'vpe-row tight'
    section.appendChild(row)
    const editor = document.createElement('div')
    editor.style.display = 'flex'
    editor.style.flexDirection = 'column'
    editor.style.gap = '4px'
    section.appendChild(editor)

    const swatches: { block: number; el: HTMLElement }[] = []
    let swatchFingerprint = ''
    let editorIndex = -1
    let editorFingerprint = ''

    function rebuildSwatches(): void {
        swatchFingerprint = paletteFingerprint()
        row.innerHTML = ''
        swatches.length = 0
        for (let i = 1; i < chunks.palette.entries.length; i++) {
            const entry = chunks.palette.entries[i]!
            const swatch = document.createElement('div')
            swatch.className = 'vpe-swatch'
            applySwatchMaterial(swatch, i, entry)
            swatch.onclick = () => {
                state.activeBlock = i
                sync()
            }
            swatches.push({ block: i, el: swatch })
            row.appendChild(swatch)
        }
        sync()
    }

    function applySwatchMaterial(swatch: HTMLElement, block: number, entry: PaletteEntry): void {
        const keyHint = block <= 9 ? ` · key ${block}` : ''
        swatch.title = `${entry.name} (${block})${keyHint}`
        swatch.style.background = colorToCss(entry)
    }

    function sync(): void {
        if (state.activeBlock <= 0 || !chunks.palette.entries[state.activeBlock]) {
            state.activeBlock = Math.min(1, chunks.palette.entries.length - 1)
        }
        for (const { block, el } of swatches) {
            el.classList.toggle('active', block === state.activeBlock)
        }
        syncEditor()
    }

    function syncEditor(): void {
        const entry = chunks.palette.entries[state.activeBlock]
        if (!entry) {
            editor.textContent = 'No material selected.'
            editorIndex = state.activeBlock
            editorFingerprint = ''
            return
        }
        const fp = materialFingerprint(entry)
        if (editorIndex === state.activeBlock && editorFingerprint === fp) return
        if (editor.contains(document.activeElement)) return
        editorIndex = state.activeBlock
        editorFingerprint = fp
        renderMaterialEditor(entry)
    }

    function renderMaterialEditor(entry: PaletteEntry): void {
        editor.innerHTML = ''
        const title = document.createElement('div')
        title.className = 'vpe-hint'
        title.style.color = 'rgba(217, 247, 255, 0.75)'
        title.textContent = `Material ${state.activeBlock}`
        editor.appendChild(title)

        editor.appendChild(textField('Name:', entry.name, 'material name', (value) => {
            entry.name = value.trim() || `material ${state.activeBlock}`
            materialChanged()
        }))

        const colorRow = document.createElement('div')
        colorRow.className = 'vpe-field'
        const colorLabel = document.createElement('span')
        colorLabel.className = 'vpe-field-label'
        colorLabel.textContent = 'Color:'
        const colorInput = document.createElement('input')
        colorInput.className = 'vpe-input'
        colorInput.type = 'color'
        colorInput.value = colorToHex(entry.color)
        colorInput.oninput = () => {
            entry.color = hexToColor(colorInput.value)
            materialChanged()
        }
        colorRow.append(colorLabel, colorInput)
        editor.appendChild(colorRow)

        editor.appendChild(numberField('Opacity:', entry.opacity ?? 1, 0, 1, 0.05, (value) => {
            const opacity = Math.max(0, Math.min(1, value))
            if (opacity >= 1) delete entry.opacity
            else {
                entry.opacity = opacity
                entry.occludesFaces = false
            }
            materialChanged()
        }))

        const toggles = document.createElement('div')
        toggles.className = 'vpe-row'
        toggles.append(
            checkboxField('Solid', entry.solid, (checked) => {
                entry.solid = checked
                entry.collidable = checked
                entry.occludesFaces = checked
                entry.raycastTarget = checked
                entry.pathSurface = checked
                materialChanged(true)
            }),
            checkboxField('Collide', isCollidable(chunks.palette, state.activeBlock), (checked) => {
                entry.collidable = checked
                materialChanged()
            }),
            checkboxField('Occlude', occludesFaces(chunks.palette, state.activeBlock), (checked) => {
                entry.occludesFaces = checked
                materialChanged()
            }),
            checkboxField('Raycast', isRaycastTarget(chunks.palette, state.activeBlock), (checked) => {
                entry.raycastTarget = checked
                materialChanged()
            }),
            checkboxField('Walk', isPathSurface(chunks.palette, state.activeBlock), (checked) => {
                entry.pathSurface = checked
                materialChanged()
            }),
        )
        editor.appendChild(toggles)

        const movementRow = document.createElement('div')
        movementRow.className = 'vpe-row'
        movementRow.append(
            numberField('Speed:', entry.movement?.speedMultiplier ?? 1, 0.05, 3, 0.05, (value) => {
                const speed = Math.max(0.05, Math.min(3, value))
                const disableJump = entry.movement?.disableJump ?? false
                entry.movement = speed === 1 && !disableJump ? undefined : { speedMultiplier: speed, disableJump }
                materialChanged()
            }),
            checkboxField('No jump', entry.movement?.disableJump ?? false, (checked) => {
                const speed = entry.movement?.speedMultiplier ?? 1
                entry.movement = speed === 1 && !checked ? undefined : { speedMultiplier: speed, disableJump: checked }
                materialChanged()
            }),
        )
        editor.appendChild(movementRow)

        const addBtn = document.createElement('button')
        addBtn.className = 'vpe-button'
        addBtn.textContent = '+ Material'
        addBtn.title = 'Create a new material from the selected material'
        addBtn.onclick = () => {
            const index = appendMaterial(chunks.palette, entry)
            if (index < 0) return
            state.activeBlock = index
            chunks.markAllDirty()
            editorIndex = -1
            rebuildSwatches()
        }
        editor.appendChild(addBtn)
    }

    function materialChanged(rerenderEditor = false): void {
        chunks.markAllDirty()
        refreshPhysicalPistonVisuals(ctx.world, chunks, state.activeBlock)
        const entry = chunks.palette.entries[state.activeBlock]
        if (entry) {
            for (const { block, el } of swatches) {
                if (block === state.activeBlock) applySwatchMaterial(el, block, entry)
            }
        }
        swatchFingerprint = paletteFingerprint()
        editorFingerprint = entry ? materialFingerprint(entry) : ''
        if (rerenderEditor && entry) {
            editorIndex = state.activeBlock
            renderMaterialEditor(entry)
        } else {
            sync()
        }
    }

    function paletteFingerprint(): string {
        return chunks.palette.entries.map((entry) => materialFingerprint(entry)).join('|')
    }

    function refresh(): void {
        const fp = paletteFingerprint()
        if (fp !== swatchFingerprint && !editor.contains(document.activeElement)) {
            rebuildSwatches()
            return
        }
        sync()
    }

    rebuildSwatches()
    return { element: section, refresh }
}

function buildModeSection(state: EditorState, onChange: () => void): RefreshableElement {
    const section = sectionEl('Mode')
    const row = document.createElement('div')
    row.className = 'vpe-row'
    section.appendChild(row)
    const buttons: { mode: EditorMode; btn: HTMLButtonElement }[] = []
    for (const m of MODES) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = m.label
        btn.title = m.hint
        btn.onclick = () => {
            state.mode = m.mode
            refresh()
            onChange()
        }
        if (m.mode === state.mode) btn.classList.add('active')
        buttons.push({ mode: m.mode, btn })
        row.appendChild(btn)
    }
    function refresh(): void {
        for (const { mode, btn } of buttons) btn.classList.toggle('active', mode === state.mode)
    }
    return { element: section, refresh }
}

// ────────────────────────────────────────────────────────────────────────
// Per-mode contextual panels
// ────────────────────────────────────────────────────────────────────────

function buildBrushPanel(state: EditorState): RefreshableElement {
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
    return { element: section, refresh: () => {} }
}

function buildSelectPanel(): RefreshableElement {
    const section = sectionEl('Selection')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.style.color = 'rgba(217, 247, 255, 0.75)'
    hint.textContent = 'LMB selects spawn, pickups, zones, sound zones, or sound sources. Drag the gizmo to move by whole grid cells.'
    section.appendChild(hint)
    return { element: section, refresh: () => {} }
}

function buildPickupPanel(state: EditorState): RefreshableElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const section = sectionEl('Gold pickup')

    const amountRow = document.createElement('div')
    amountRow.className = 'vpe-field'
    const amountLabel = document.createElement('span')
    amountLabel.className = 'vpe-field-label'
    amountLabel.textContent = 'Amount:'
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
    root.appendChild(section)

    const listSection = sectionEl('Placed pickups')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    let fingerprint = ''
    function refresh(): void {
        const fp = state.pickups.map((p) => `${p.amount}@${p.position.x},${p.position.y},${p.position.z}`).join('|')
        if (fp === fingerprint) return
        fingerprint = fp
        list.innerHTML = ''
        if (state.pickups.length === 0) {
            const empty = document.createElement('span')
            empty.className = 'vpe-list-empty'
            empty.textContent = 'No pickups placed yet.'
            list.appendChild(empty)
            return
        }
        for (const pickup of state.pickups) {
            const row = document.createElement('div')
            row.className = 'vpe-list-item'
            const label = document.createElement('span')
            label.textContent = `gold ×${pickup.amount} @ ${formatCoord({
                x: Math.floor(pickup.position.x),
                y: Math.floor(pickup.position.y),
                z: Math.floor(pickup.position.z),
            })}`
            const removeBtn = document.createElement('button')
            removeBtn.textContent = 'remove'
            removeBtn.onclick = () => {
                const i = state.pickups.indexOf(pickup)
                if (i >= 0) state.pickups.splice(i, 1)
                fingerprint = ''
                refresh()
            }
            row.append(label, removeBtn)
            list.appendChild(row)
        }
    }
    refresh()
    return { element: root, refresh }
}

function buildSpawnPanel(): RefreshableElement {
    const section = sectionEl('Spawn point')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.style.color = 'rgba(217, 247, 255, 0.75)'
    hint.textContent = 'LMB sets the player spawn at the cursor cell.'
    section.appendChild(hint)
    return { element: section, refresh: () => {} }
}

function buildSoundModePanel(): RefreshableElement {
    const section = sectionEl('Sound source')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.style.color = 'rgba(217, 247, 255, 0.75)'
    hint.textContent = 'Use the Sound tab to choose the source and edit placed emitters.'
    section.appendChild(hint)
    return { element: section, refresh: () => {} }
}

function buildWeatherModePanel(): RefreshableElement {
    const section = sectionEl('Weather zone')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.style.color = 'rgba(255, 220, 240, 0.78)'
    hint.textContent = 'Use the Weather tab to pick the preset, tune the size, and toggle the paired sound.'
    section.appendChild(hint)
    return { element: section, refresh: () => {} }
}

function buildPistonPanel(ctx: EditTabContext): RefreshableElement {
    const { editorState: state, world, chunks } = ctx
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const settings = sectionEl('Piston settings')

    const dirRow = document.createElement('div')
    dirRow.className = 'vpe-row tight'
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
    settings.appendChild(dirRow)

    settings.appendChild(numberField('Distance:', state.pistonDistance, 1, 8, 1, (v) => { state.pistonDistance = v }))
    settings.appendChild(numberField('Delay (s):', state.pistonDelay, 0, 60, 0.25, (v) => { state.pistonDelay = v }))

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
        btn.style.flex = '1'
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
    settings.appendChild(motionRow)

    settings.appendChild(numberField('Travel (s):', state.pistonTravelTime, 0.05, 30, 0.05, (v) => { state.pistonTravelTime = v }))

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
        btn.style.flex = '1'
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
    settings.appendChild(policyRow)

    // ── Movement sound (per-piston, optional) ─────────────────────
    const soundLabel = document.createElement('div')
    soundLabel.className = 'vpe-section-heading'
    soundLabel.textContent = 'Movement sound'
    soundLabel.style.marginTop = '6px'
    soundLabel.style.fontSize = '11px'
    soundLabel.style.color = 'var(--text-dim, rgba(217, 247, 255, 0.65))'
    settings.appendChild(soundLabel)
    settings.appendChild(pistonSoundSelectField(state.pistonMoveSoundId, (id) => {
        state.pistonMoveSoundId = id
    }))
    settings.appendChild(numberField('Sound vol:', state.pistonMoveSoundVolume, 0, 1, 0.05, (v) => { state.pistonMoveSoundVolume = v }))

    root.appendChild(settings)

    const listSection = sectionEl('Placed pistons')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    let fingerprint = ''
    function refresh(): void {
        const fp = state.pistons.map((p) => `${p.from.x},${p.from.y},${p.from.z}>${p.to.x},${p.to.y},${p.to.z}|${p.motion}|${p.delay}|${p.travelTime}|${p.characterPolicy}`).join('||')
        if (fp === fingerprint) return
        fingerprint = fp
        list.innerHTML = ''
        if (state.pistons.length === 0) {
            const empty = document.createElement('span')
            empty.className = 'vpe-list-empty'
            empty.textContent = 'No pistons placed yet.'
            list.appendChild(empty)
            return
        }
        // Snapshot length so callbacks resolve their target by reference
        // — the index changes when other items are removed during the
        // same refresh cycle.
        for (let i = 0; i < state.pistons.length; i++) {
            const piston = state.pistons[i]!
            const row = document.createElement('div')
            row.className = 'vpe-list-item'
            const span = document.createElement('span')
            const motion = piston.motion ?? 'teleport'
            const delay = piston.delay ?? piston.interval ?? 2
            const travel = piston.travelTime ?? 1
            span.textContent = `${formatCoord(piston.from)} → ${formatCoord(piston.to)} · ${motion} · delay ${delay}s · travel ${travel}s · ${piston.characterPolicy}`
            const removeBtn = document.createElement('button')
            removeBtn.textContent = 'remove'
            removeBtn.onclick = () => {
                // Resolve by reference, not index — refresh() may have
                // re-built the list since this row was created.
                const idx = state.pistons.indexOf(piston)
                if (idx >= 0) removePistonAt(world, chunks, state, idx)
                fingerprint = '' // force the next refresh to rebuild
                refresh()
            }
            row.append(span, removeBtn)
            list.appendChild(row)
        }
    }
    refresh()
    return { element: root, refresh }
}

function buildZonePanel(ctx: EditTabContext): RefreshableElement {
    const { chunks, editorState: state } = ctx
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const settings = sectionEl('Zone settings')

    settings.appendChild(textField('Kind:', state.zoneKind, 'generic', (v) => { state.zoneKind = v || 'generic' }))
    settings.appendChild(textField('Label:', state.zoneLabel, '(optional)', (v) => { state.zoneLabel = v }))
    settings.appendChild(numberField('XZ size:', state.zoneSize, 1, 32, 1, (v) => { state.zoneSize = v }))
    settings.appendChild(numberField('Y height:', state.zoneHeight, 1, 32, 1, (v) => { state.zoneHeight = v }))

    const triggerRow = document.createElement('div')
    triggerRow.className = 'vpe-row'
    const triggerModes: { id: EditorZoneTriggerMode; label: string }[] = [
        { id: 'player', label: 'Player' },
        { id: 'arrow', label: 'Arrow' },
        { id: 'both', label: 'Both' },
    ]
    const triggerButtons: { id: EditorZoneTriggerMode; btn: HTMLButtonElement }[] = []
    for (const mode of triggerModes) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.style.flex = '1'
        btn.textContent = mode.label
        btn.onclick = () => {
            state.zoneTriggerMode = mode.id
            for (const { btn: b } of triggerButtons) b.classList.remove('active')
            btn.classList.add('active')
        }
        if (mode.id === state.zoneTriggerMode) btn.classList.add('active')
        triggerButtons.push({ id: mode.id, btn })
        triggerRow.appendChild(btn)
    }
    settings.appendChild(triggerRow)
    root.appendChild(settings)

    // Script builder.
    const scriptSection = sectionEl('Trigger script (next zone)')

    const msgRow = document.createElement('div')
    msgRow.className = 'vpe-row'
    const msgInput = document.createElement('input')
    msgInput.className = 'vpe-input'
    msgInput.type = 'text'
    msgInput.value = state.zoneScriptMessage
    msgInput.placeholder = 'message'
    msgInput.style.flex = '1'
    msgInput.oninput = () => { state.zoneScriptMessage = msgInput.value }
    const addMsgBtn = document.createElement('button')
    addMsgBtn.className = 'vpe-button'
    addMsgBtn.textContent = '+ Msg'
    addMsgBtn.onclick = () => {
        const message = state.zoneScriptMessage.trim()
        if (!message) return
        state.zoneScriptActions.push({ type: 'message', message })
        scriptFingerprint = ''
        refresh()
    }
    msgRow.append(msgInput, addMsgBtn)
    scriptSection.appendChild(msgRow)

    const offsetRow = document.createElement('div')
    offsetRow.className = 'vpe-field'
    const offsetLabel = document.createElement('span')
    offsetLabel.className = 'vpe-field-label'
    offsetLabel.textContent = 'Offset:'
    offsetRow.appendChild(offsetLabel)
    for (const axis of ['x', 'y', 'z'] as const) {
        const input = document.createElement('input')
        input.className = 'vpe-input'
        input.type = 'number'
        input.value = String(state.zoneScriptOffset[axis])
        input.style.width = '42px'
        input.title = `${axis.toUpperCase()} offset from zone min`
        input.oninput = () => {
            const v = parseInt(input.value, 10)
            if (Number.isFinite(v)) state.zoneScriptOffset[axis] = v
        }
        offsetRow.appendChild(input)
    }
    scriptSection.appendChild(offsetRow)

    const actionRow = document.createElement('div')
    actionRow.className = 'vpe-row'
    const killBtn = document.createElement('button')
    killBtn.className = 'vpe-button'
    killBtn.textContent = '+ Kill'
    killBtn.onclick = () => {
        const message = state.zoneScriptMessage.trim()
        state.zoneScriptActions.push(message ? { type: 'kill-player', message } : { type: 'kill-player' })
        scriptFingerprint = ''
        refresh()
    }
    const spawnBtn = document.createElement('button')
    spawnBtn.className = 'vpe-button'
    spawnBtn.textContent = '+ Spawn'
    spawnBtn.title = 'Add a set-block action using the active palette block, relative to zone min'
    spawnBtn.onclick = () => {
        state.zoneScriptActions.push({
            type: 'set-block',
            position: { ...state.zoneScriptOffset },
            block: state.activeBlock,
            relativeTo: 'zone-min',
        })
        scriptFingerprint = ''
        refresh()
    }
    const eraseBtn = document.createElement('button')
    eraseBtn.className = 'vpe-button'
    eraseBtn.textContent = '+ Erase'
    eraseBtn.onclick = () => {
        state.zoneScriptActions.push({
            type: 'set-block',
            position: { ...state.zoneScriptOffset },
            block: 0,
            relativeTo: 'zone-min',
        })
        scriptFingerprint = ''
        refresh()
    }
    const clearBtn = document.createElement('button')
    clearBtn.className = 'vpe-button'
    clearBtn.textContent = 'Clear'
    clearBtn.onclick = () => {
        state.zoneScriptActions.length = 0
        scriptFingerprint = ''
        refresh()
    }
    actionRow.append(killBtn, spawnBtn, eraseBtn, clearBtn)
    scriptSection.appendChild(actionRow)

    const scriptList = document.createElement('div')
    scriptList.className = 'vpe-list'
    scriptSection.appendChild(scriptList)
    root.appendChild(scriptSection)

    // Placed zones.
    const listSection = sectionEl('Placed zones')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    let scriptFingerprint = ''
    let zoneFingerprint = ''

    function refresh(): void {
        const sfp = state.zoneScriptActions.map((a) => JSON.stringify(a)).join('|')
        if (sfp !== scriptFingerprint) {
            scriptFingerprint = sfp
            scriptList.innerHTML = ''
            if (state.zoneScriptActions.length === 0) {
                const empty = document.createElement('span')
                empty.className = 'vpe-list-empty'
                empty.textContent = 'No script actions queued.'
                scriptList.appendChild(empty)
            } else {
                for (const action of state.zoneScriptActions) {
                    const row = document.createElement('div')
                    row.className = 'vpe-list-item'
                    const span = document.createElement('span')
                    span.textContent = formatZoneScriptAction(action, chunks.palette)
                    const removeBtn = document.createElement('button')
                    removeBtn.textContent = 'remove'
                    removeBtn.onclick = () => {
                        const i = state.zoneScriptActions.indexOf(action)
                        if (i >= 0) state.zoneScriptActions.splice(i, 1)
                        scriptFingerprint = ''
                        refresh()
                    }
                    row.append(span, removeBtn)
                    scriptList.appendChild(row)
                }
            }
        }

        const zfp = state.zones.map((z) => JSON.stringify(z)).join('|')
        if (zfp !== zoneFingerprint) {
            zoneFingerprint = zfp
            list.innerHTML = ''
            if (state.zones.length === 0) {
                const empty = document.createElement('span')
                empty.className = 'vpe-list-empty'
                empty.textContent = 'No zones placed yet.'
                list.appendChild(empty)
            } else {
                for (const zone of state.zones) {
                    const row = document.createElement('div')
                    row.className = 'vpe-list-item'
                    const span = document.createElement('span')
                    const w = zone.max.x - zone.min.x
                    const h = zone.max.y - zone.min.y
                    const d = zone.max.z - zone.min.z
                    const title = zone.label ?? zone.id
                    const sources = (zone.triggerSources ?? ['player']).join('+')
                    const scripts = zone.script?.actions.length ?? 0
                    span.textContent = `${title} [${zone.kind}] ${sources} ${w}×${h}×${d} · ${scripts} script`
                    const removeBtn = document.createElement('button')
                    removeBtn.textContent = 'remove'
                    removeBtn.onclick = () => {
                        const i = state.zones.indexOf(zone)
                        if (i >= 0) state.zones.splice(i, 1)
                        zoneFingerprint = ''
                        refresh()
                    }
                    row.append(span, removeBtn)
                    list.appendChild(row)
                }
            }
        }
    }
    refresh()
    return { element: root, refresh }
}

// ────────────────────────────────────────────────────────────────────────
// Small reusable field builders
// ────────────────────────────────────────────────────────────────────────

function numberField(
    label: string,
    initial: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
): HTMLElement {
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
    input.value = String(initial)
    input.style.width = '60px'
    input.oninput = () => {
        const v = step % 1 === 0 ? parseInt(input.value, 10) : parseFloat(input.value)
        if (Number.isFinite(v) && v >= min) onChange(v)
    }
    row.append(span, input)
    return row
}

function textField(
    label: string,
    initial: string,
    placeholder: string,
    onChange: (v: string) => void,
): HTMLElement {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'text'
    input.value = initial
    input.placeholder = placeholder
    input.style.flex = '2'
    input.oninput = () => { onChange(input.value) }
    row.append(span, input)
    return row
}

function checkboxField(
    label: string,
    initial: boolean,
    onChange: (checked: boolean) => void,
): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    field.style.cursor = 'pointer'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = initial
    input.onchange = () => { onChange(input.checked) }
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    field.append(input, span)
    return field
}

/** Per-piston movement-sound dropdown. Includes a `(none)` option so
 *  pistons that should be silent skip the audio call entirely. The
 *  asset list comes from the SFX manifest — looped ambient samples
 *  are excluded since they wouldn't make sense as one-shots. */
function pistonSoundSelectField(initial: string | null, onChange: (id: string | null) => void): HTMLElement {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = 'Sound:'
    const select = document.createElement('select')
    select.className = 'vpe-input'
    select.style.flex = '2'
    const none = document.createElement('option')
    none.value = ''
    none.textContent = '(silent)'
    select.appendChild(none)
    const assets: readonly AudioAsset[] = (GAME_AUDIO_MANIFEST.sounds ?? []).filter((a) => !a.loop)
    for (const asset of assets) {
        const opt = document.createElement('option')
        opt.value = asset.id
        opt.textContent = asset.id.replace(/^sfx\./, '').replace(/\./g, ' / ')
        select.appendChild(opt)
    }
    select.value = initial ?? ''
    select.onchange = () => { onChange(select.value ? select.value : null) }
    row.append(label, select)
    return row
}

function formatZoneScriptAction(action: ZoneScriptAction, palette: Palette): string {
    if (action.type === 'message') return `message "${trimForList(action.message)}"`
    if (action.type === 'kill-player') {
        return action.message ? `kill + "${trimForList(action.message)}"` : 'kill player'
    }
    if (action.type === 'set-block') {
        const block = action.block === 0
            ? 'air'
            : (palette.entries[action.block]?.name ?? `block ${action.block}`)
        return `${action.block === 0 ? 'erase' : 'spawn'} ${block} @ ${formatCoord(action.position)}`
    }
    const block = action.block === 0
        ? 'air'
        : (palette.entries[action.block]?.name ?? `block ${action.block}`)
    return `fill ${block} ${formatCoord(action.min)}..${formatCoord(action.max)}`
}

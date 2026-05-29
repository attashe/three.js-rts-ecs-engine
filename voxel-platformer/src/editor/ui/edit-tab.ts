import { isCollidable, isPathSurface, isRaycastTarget, occludesFaces, type Palette, type PaletteEntry } from '../../engine/voxel/palette'
import { TILE_NAMES, type TileName } from '../../engine/voxel/atlas-manifest'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { AudioAsset } from '../../engine/audio'
import { GAME_AUDIO_MANIFEST } from '../../game/audio'
import { BRUSHES, type BrushKind } from '../brush'
import { PISTON_DIRECTIONS, type PistonDirection } from '../piston-direction'
import { removePistonAt } from '../systems/piston-place-system'
import { appendMaterial, colorToHex, hexToColor, materialFingerprint } from '../palette-edit'
import { refreshPhysicalPistonVisuals } from '../../game/mechanisms'
import type {
    EditorMode,
    EditorPiston,
    EditorState,
    EditorViewMode,
    EditorZoneTriggerMode,
} from '../editor-state'
import { colorToSwatchCss, formatCoord, sectionEl, trimForList, type RefreshableElement } from './common'

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

    // View mode toggle (Iso / Top / Orbit). Compact button row.
    const viewRow = document.createElement('div')
    viewRow.className = 'vpe-row'
    const viewModes: { mode: EditorViewMode; label: string; hint: string }[] = [
        { mode: 'iso', label: 'Iso', hint: 'Default isometric view (V cycles camera modes)' },
        { mode: 'top-down', label: 'Top', hint: 'Top-down — hides above the plane (V cycles camera modes)' },
        { mode: 'orbit', label: 'Orbit', hint: 'Free orbit inspection view, like the FX demo' },
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
    shortcuts.textContent = 'Z/X: plane ±1 (Shift = ±4) · V: camera mode · L: lock'
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
        case 'place-prop':
        case 'scatter-props':
            return buildPropModePanel()
        case 'place-npc':
            return buildNpcModePanel()
        case 'place-stone':
        case 'place-stone-spawner':
            return buildStoneModePanel()
        case 'place-structure':
            return buildStructureModePanel()
    }
}

function buildPropModePanel(): RefreshableElement {
    const section = sectionEl('Props')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Switch to the Props tab to pick single placement or scatter brush settings.'
    section.appendChild(hint)
    return { element: section, refresh() {} }
}

function buildNpcModePanel(): RefreshableElement {
    const section = sectionEl('NPCs')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Switch to the NPCs tab to configure model, collision, interaction, and script settings.'
    section.appendChild(hint)
    return { element: section, refresh() {} }
}

function buildStoneModePanel(): RefreshableElement {
    const section = sectionEl('Stones')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Switch to the Stones tab to place physics stones or configure falling-stone spawners.'
    section.appendChild(hint)
    return { element: section, refresh() {} }
}

function buildStructureModePanel(): RefreshableElement {
    const section = sectionEl('Structures')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Switch to the Structures tab to pick a prefab or procedural structure, rotation, and seed. The cursor preview shows the bounding box.'
    section.appendChild(hint)
    return { element: section, refresh() {} }
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
        swatch.classList.toggle('torch', entry.renderAs === 'torch')
        swatch.style.background = entry.renderAs === 'torch' ? '' : colorToSwatchCss(entry)
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

        editor.appendChild(colorRow('Color:', colorToHex(entry.color), (hex) => {
            entry.color = hexToColor(hex)
            materialChanged()
        }))

        editor.appendChild(textureSelectField(entry.textureKey, (key) => {
            if (key === null) delete entry.textureKey
            else entry.textureKey = key
            // Re-mesh: the per-vertex tileIndex attribute changes with
            // the textureKey, so the chunks need a fresh greedyMesh.
            materialChanged()
        }))

        editor.appendChild(numberField('Opacity:', entry.opacity ?? 1, 0, 1, 0.05, (value) => {
            const opacity = Math.max(0, Math.min(1, value))
            if (opacity >= 1) delete entry.opacity
            else {
                entry.opacity = opacity
                entry.occludesFaces = false
            }
            materialChanged()
        }))

        editor.appendChild(buildEmissiveBlock(entry, materialChanged))

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
    hint.textContent = 'LMB selects spawn, pickups, props, NPCs, stones, zones, sound objects, or effect zones. Drag the gizmo to move by grid cells.'
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
    const section = sectionEl('Effect zone')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.style.color = 'rgba(255, 220, 240, 0.78)'
    hint.textContent = 'Use the Visual FX tab to pick the preset, tune the size, and toggle the paired sound.'
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
    const kindRow = document.createElement('div')
    kindRow.className = 'vpe-row'
    const quickKinds: { kind: string; label: string }[] = [
        { kind: 'generic', label: 'Generic' },
        { kind: 'trigger', label: 'Trigger' },
        { kind: 'portal', label: 'Portal' },
    ]
    for (const quick of quickKinds) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.style.flex = '1'
        btn.textContent = quick.label
        btn.onclick = () => {
            state.zoneKind = quick.kind
            refresh()
        }
        kindRow.appendChild(btn)
    }
    settings.appendChild(kindRow)
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
    settings.appendChild(textField('Target:', state.portalTargetLevelId, 'level id for portal zones', (v) => {
        state.portalTargetLevelId = v.trim()
    }))
    settings.appendChild(textField('Arrival:', state.portalArrivalId, '(optional destination zone id)', (v) => {
        state.portalArrivalId = v.trim()
    }))
    root.appendChild(settings)

    // Placed zones.
    const listSection = sectionEl('Placed zones')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    let zoneFingerprint = ''

    function refresh(): void {
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
                    const portal = zone.portal
                        ? ` → ${zone.portal.targetLevelId}${zone.portal.targetArrivalId ? ` @ ${zone.portal.targetArrivalId}` : ''}`
                        : ''
                    span.textContent = `${title} [${zone.kind}] ${sources}${portal} ${w}×${h}×${d}`
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

/**
 * Emissive + block-light controls. Self-illumination (`emissive*`) is a
 * pure shader effect — cheap, no light slot. Block PointLight fields
 * spawn a real PointLight at the voxel centre, useful both for authored
 * lamps and as a controlled test rig for the shadow pipeline. Castshadow
 * is per-block (default off — a fill, not a shadow source).
 */
function buildEmissiveBlock(entry: PaletteEntry, onChange: () => void): HTMLElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '2px'
    root.style.marginTop = '6px'
    root.style.paddingTop = '6px'
    root.style.borderTop = '1px solid rgba(217, 247, 255, 0.12)'

    const heading = document.createElement('div')
    heading.className = 'vpe-hint'
    heading.textContent = 'FX (emissive + block light)'
    heading.style.color = 'rgba(255, 214, 240, 0.7)'
    root.appendChild(heading)

    root.appendChild(colorRow('Emissive:', colorToHex(entry.emissive ?? [0, 0, 0]), (hex) => {
        const rgb = hexToColor(hex)
        if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) {
            delete entry.emissive
        } else {
            entry.emissive = rgb
        }
        onChange()
    }))

    root.appendChild(numberField('Emissive int:', entry.emissiveIntensity ?? 0, 0, 4, 0.05, (value) => {
        if (value <= 0) delete entry.emissiveIntensity
        else entry.emissiveIntensity = value
        onChange()
    }))

    // Same fallback chain as voxelLightSpec() in the runtime — when both
    // lightColor and emissive are unset, the spawned PointLight inherits
    // the block's base colour. Mirroring that here so the UI swatch
    // doesn't show black for a lamp that will actually emit colour.
    root.appendChild(colorRow('Light col:', colorToHex(entry.lightColor ?? entry.emissive ?? entry.color), (hex) => {
        entry.lightColor = hexToColor(hex)
        onChange()
    }))

    root.appendChild(numberField('Light int:', entry.lightIntensity ?? 0, 0, 16, 0.1, (value) => {
        if (value <= 0) delete entry.lightIntensity
        else entry.lightIntensity = value
        onChange()
    }))

    root.appendChild(numberField('Light dist:', entry.lightDistance ?? 8, 1, 32, 0.5, (value) => {
        entry.lightDistance = value
        onChange()
    }))

    root.appendChild(checkboxField('Light casts shadow', entry.lightCastsShadow ?? false, (checked) => {
        if (!checked) delete entry.lightCastsShadow
        else entry.lightCastsShadow = true
        onChange()
    }))

    return root
}

function colorRow(label: string, initial: string, onChange: (hex: string) => void): HTMLElement {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'color'
    input.value = initial
    input.oninput = () => onChange(input.value)
    row.append(span, input)
    return row
}

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

/**
 * Material-editor surface-texture dropdown. The list is sourced from
 * `TILE_NAMES` — the same registry the atlas builder uses — so adding
 * a new tile in the manifest immediately surfaces it as a pickable
 * option here, no UI changes required.
 *
 * The "(none)" option deletes `entry.textureKey`, which maps to slot
 * 0 (`blank`) at render time. Plain-colour blocks live in this state.
 *
 * `blank` is hidden from the dropdown intentionally: it's the
 * implementation-level fallback, not an authoring choice. A user who
 * wants "no texture" picks "(none)", which is semantically distinct
 * from "yes I want the explicit blank tile" — both happen to look
 * the same on screen, but only `(none)` survives a future change to
 * what the blank slot does.
 */
function textureSelectField(
    initial: string | undefined,
    onChange: (key: TileName | null) => void,
): HTMLElement {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = 'Texture:'
    const select = document.createElement('select')
    select.className = 'vpe-input'
    select.style.flex = '2'
    const none = document.createElement('option')
    none.value = ''
    none.textContent = '(none — plain colour)'
    select.appendChild(none)
    for (const name of TILE_NAMES) {
        if (name === 'blank') continue
        const opt = document.createElement('option')
        opt.value = name
        opt.textContent = name
        select.appendChild(opt)
    }
    // Coerce the stored value back to a known tile name, or fall
    // through to the empty (none) option if the saved key is unknown.
    select.value = initial && TILE_NAMES.includes(initial as TileName) ? initial : ''
    select.onchange = () => {
        onChange(select.value ? (select.value as TileName) : null)
    }
    row.append(label, select)
    return row
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

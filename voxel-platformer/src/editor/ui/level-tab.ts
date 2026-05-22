import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import {
    NEW_LEVEL_DEFAULT_DEPTH,
    NEW_LEVEL_DEFAULT_WIDTH,
    NEW_LEVEL_MAX_DIMENSION,
    loadLevelFromFile,
    newLevel,
    saveLevelDownload,
} from '../save-load'
import { launchPlaytest } from '../playtest'
import { sectionEl, type RefreshableElement } from './common'

export interface LevelTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

/** Save / Load / Playtest controls + level name field + new-level form. */
export function buildLevelTab(opts: LevelTabOptions): RefreshableElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // New-level form. Two number inputs (W × D in cells) plus a New
    // button. Clicking confirms before destroying the current state so
    // the user doesn't lose work by accident.
    const newSection = sectionEl('New level')
    const sizeRow = document.createElement('div')
    sizeRow.className = 'vpe-field'
    const sizeLabel = document.createElement('span')
    sizeLabel.className = 'vpe-field-label'
    sizeLabel.textContent = 'Size (W × D):'
    const widthInput = document.createElement('input')
    widthInput.className = 'vpe-input'
    widthInput.type = 'number'
    widthInput.min = '1'
    widthInput.max = String(NEW_LEVEL_MAX_DIMENSION)
    widthInput.value = String(NEW_LEVEL_DEFAULT_WIDTH)
    widthInput.style.width = '52px'
    widthInput.title = 'Width — number of cells along X'
    const times = document.createElement('span')
    times.textContent = '×'
    times.style.color = 'rgba(217, 247, 255, 0.55)'
    const depthInput = document.createElement('input')
    depthInput.className = 'vpe-input'
    depthInput.type = 'number'
    depthInput.min = '1'
    depthInput.max = String(NEW_LEVEL_MAX_DIMENSION)
    depthInput.value = String(NEW_LEVEL_DEFAULT_DEPTH)
    depthInput.style.width = '52px'
    depthInput.title = 'Depth — number of cells along Z'
    sizeRow.append(sizeLabel, widthInput, times, depthInput)
    newSection.appendChild(sizeRow)

    const newBtn = document.createElement('button')
    newBtn.className = 'vpe-button'
    newBtn.textContent = 'New'
    newBtn.title = 'Discard the current level and seed a fresh dirt+grass pad'
    newBtn.onclick = () => {
        const w = parseInt(widthInput.value, 10)
        const d = parseInt(depthInput.value, 10)
        if (!Number.isFinite(w) || !Number.isFinite(d) || w < 1 || d < 1) return
        const confirmed = window.confirm(
            `Discard the current level and create a new ${w} × ${d} pad? Unsaved work will be lost.`,
        )
        if (!confirmed) return
        newLevel(opts.world, opts.chunks, opts.editorState, w, d)
        opts.history.clear()
        nameInput.value = 'untitled-level'
    }
    newSection.appendChild(newBtn)
    root.appendChild(newSection)

    const section = sectionEl('Level')

    const nameRow = document.createElement('div')
    nameRow.className = 'vpe-field'
    const nameLabel = document.createElement('span')
    nameLabel.className = 'vpe-field-label'
    nameLabel.textContent = 'Name:'
    const nameInput = document.createElement('input')
    nameInput.className = 'vpe-input'
    nameInput.type = 'text'
    nameInput.value = 'untitled-level'
    nameInput.style.flex = '2'
    nameRow.append(nameLabel, nameInput)
    section.appendChild(nameRow)

    const ioRow = document.createElement('div')
    ioRow.className = 'vpe-row'
    const saveBtn = document.createElement('button')
    saveBtn.className = 'vpe-button'
    saveBtn.textContent = 'Save'
    saveBtn.style.flex = '1'
    saveBtn.onclick = () => saveLevelDownload(opts.chunks, opts.editorState, nameInput.value || 'untitled-level')

    const loadBtn = document.createElement('button')
    loadBtn.className = 'vpe-button'
    loadBtn.textContent = 'Load'
    loadBtn.style.flex = '1'
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.vplevel,application/octet-stream'
    fileInput.style.display = 'none'
    fileInput.onchange = async () => {
        const file = fileInput.files?.[0]
        if (!file) return
        try {
            const meta = await loadLevelFromFile(file, opts.world, opts.chunks, opts.editorState)
            opts.history.clear()
            nameInput.value = meta.name
        } catch (err) {
            console.error('Failed to load level:', err)
        } finally {
            fileInput.value = ''
        }
    }
    loadBtn.onclick = () => fileInput.click()
    ioRow.append(saveBtn, loadBtn, fileInput)
    section.appendChild(ioRow)

    const playtestBtn = document.createElement('button')
    playtestBtn.className = 'vpe-button'
    playtestBtn.textContent = '▶ Playtest'
    playtestBtn.title = 'Save the current level to session storage and open it in the game'
    playtestBtn.style.fontWeight = 'bold'
    playtestBtn.onclick = () => launchPlaytest(opts.chunks, opts.editorState, nameInput.value || 'playtest-level')
    section.appendChild(playtestBtn)

    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Save downloads a .vplevel file. Playtest jumps to the game with the current state.'
    section.appendChild(hint)

    root.appendChild(section)
    return { element: root, refresh: () => {} }
}

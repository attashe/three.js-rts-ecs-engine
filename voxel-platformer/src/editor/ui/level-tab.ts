import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'
import { saveLevelDownload, loadLevelFromFile } from '../save-load'
import { launchPlaytest } from '../playtest'
import { sectionEl, type RefreshableElement } from './common'

export interface LevelTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
}

/** Save / Load / Playtest controls + level name field. */
export function buildLevelTab(opts: LevelTabOptions): RefreshableElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

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

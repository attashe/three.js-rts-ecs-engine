import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { ScriptEntry } from '../../engine/script/types'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import { sectionEl, type RefreshableElement } from './common'

export interface LogicTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

/**
 * Editor → Logic tab.
 *
 * The script engine runs in playtest, not in the editor — this tab is
 * purely authoring + persistence. Authors:
 *
 *   - Load a `.js` file from disk: the picker reads its text, the
 *     entry shows the filename + a Reload button.
 *   - Paste a snippet directly: a textarea + Save snippet button
 *     stores the pasted source as a new entry with an author-chosen
 *     name.
 *   - Edit any existing entry's source in place.
 *   - Toggle entries on/off without deleting (saves the disabled flag
 *     into the level binary so a half-finished script can ride along
 *     without breaking playtest).
 *
 * On Save / Playtest the entries persist via `toLevelMeta()` →
 * `EditorLevelMeta.scripts`; the playtest client (`client.ts`) reads
 * them and feeds them into `createGameScriptSystem`.
 *
 * Each entry's body is parse-checked via `new AsyncFunction(...)` so
 * authors see a syntax error as soon as they hit Save instead of
 * discovering it mid-playtest.
 */
export function buildLogicTab(opts: LogicTabOptions): RefreshableElement {
    const state = opts.editorState

    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // ── Section 1: load from disk ─────────────────────────────────────
    const loadSection = sectionEl('Add from disk')
    const loadRow = document.createElement('div')
    loadRow.className = 'vpe-row'
    const loadBtn = document.createElement('button')
    loadBtn.className = 'vpe-button'
    loadBtn.textContent = 'Load .js file…'
    loadBtn.title = 'Pick a .js / .mjs file. The contents become a new script entry.'
    loadBtn.onclick = () => pickFile((name, source) => {
        addEntry(state, { name, source, fromFile: true })
        refresh()
    })
    const loadHint = document.createElement('div')
    loadHint.className = 'vpe-hint'
    loadHint.textContent = 'External edits won\'t hot-reload — re-Load the file to pull updates.'
    loadRow.appendChild(loadBtn)
    loadSection.appendChild(loadRow)
    loadSection.appendChild(loadHint)
    root.appendChild(loadSection)

    // ── Section 2: paste-in editor ────────────────────────────────────
    const pasteSection = sectionEl('Paste a snippet')

    const nameRow = document.createElement('label')
    nameRow.className = 'vpe-field'
    nameRow.style.display = 'flex'
    nameRow.style.gap = '6px'
    const nameLabel = document.createElement('span')
    nameLabel.textContent = 'Name:'
    nameLabel.style.minWidth = '52px'
    const nameInput = document.createElement('input')
    nameInput.className = 'vpe-input'
    nameInput.type = 'text'
    nameInput.value = ''
    nameInput.placeholder = 'snippet-1'
    nameInput.style.flex = '1'
    nameRow.append(nameLabel, nameInput)
    pasteSection.appendChild(nameRow)

    const textarea = document.createElement('textarea')
    textarea.className = 'vpe-input'
    textarea.placeholder = `// Paste or type a script here. The script API is documented in
// docs/script-engine.md. Example:
//
// on('zone-enter', { zoneId: 'gate' }, async () => {
//   log('Welcome.')
//   await wait(0.5)
//   chunks.fillBlocks({x:14,y:1,z:22}, {x:17,y:4,z:23}, 0)
// })
`
    textarea.spellcheck = false
    textarea.style.font = '12px ui-monospace, monospace'
    textarea.style.minHeight = '180px'
    textarea.style.width = '100%'
    textarea.style.resize = 'vertical'
    textarea.style.whiteSpace = 'pre'
    pasteSection.appendChild(textarea)

    const actionsRow = document.createElement('div')
    actionsRow.className = 'vpe-row'
    actionsRow.style.gap = '6px'

    const saveBtn = document.createElement('button')
    saveBtn.className = 'vpe-button'
    saveBtn.textContent = 'Save snippet'
    saveBtn.onclick = () => {
        const source = textarea.value
        const requestedName = nameInput.value.trim()
        const result = parseCheck(source)
        if (!result.ok) {
            statusEl.textContent = `Parse error: ${result.error}`
            statusEl.style.color = '#ff7e7e'
            return
        }
        const name = requestedName || nextDefaultName(state)
        if (editingId !== null) {
            updateEntry(state, editingId, source, name)
            editingId = null
            saveBtn.textContent = 'Save snippet'
            cancelBtn.style.display = 'none'
        } else {
            addEntry(state, { name, source })
        }
        textarea.value = ''
        nameInput.value = ''
        statusEl.textContent = ''
        refresh()
    }

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'vpe-button'
    cancelBtn.textContent = 'Cancel edit'
    cancelBtn.style.display = 'none'
    cancelBtn.onclick = () => {
        editingId = null
        textarea.value = ''
        nameInput.value = ''
        saveBtn.textContent = 'Save snippet'
        cancelBtn.style.display = 'none'
        statusEl.textContent = ''
    }

    const checkBtn = document.createElement('button')
    checkBtn.className = 'vpe-button'
    checkBtn.textContent = 'Parse-check'
    checkBtn.title = 'Run the AsyncFunction parser on the current text. Catches syntax errors before Playtest.'
    checkBtn.onclick = () => {
        const result = parseCheck(textarea.value)
        if (result.ok) {
            statusEl.textContent = 'OK — parses cleanly.'
            statusEl.style.color = '#9be66f'
        } else {
            statusEl.textContent = `Parse error: ${result.error}`
            statusEl.style.color = '#ff7e7e'
        }
    }

    actionsRow.append(saveBtn, checkBtn, cancelBtn)
    pasteSection.appendChild(actionsRow)

    const statusEl = document.createElement('div')
    statusEl.className = 'vpe-hint'
    statusEl.style.minHeight = '16px'
    statusEl.style.fontFamily = 'ui-monospace, monospace'
    statusEl.style.whiteSpace = 'pre-wrap'
    pasteSection.appendChild(statusEl)

    root.appendChild(pasteSection)

    // ── Section 3: placed list ────────────────────────────────────────
    const listSection = sectionEl('Scripts in this level')
    const listEl = document.createElement('div')
    listEl.style.display = 'flex'
    listEl.style.flexDirection = 'column'
    listEl.style.gap = '6px'
    listSection.appendChild(listEl)
    root.appendChild(listSection)

    let editingId: string | null = null
    let lastListFingerprint = ''

    function rebuildList(): void {
        const fp = state.scripts.map((e) => `${e.id}:${e.name}:${e.enabled ?? true}:${e.source.length}`).join('|')
        if (fp === lastListFingerprint && editingId === null) return
        lastListFingerprint = fp
        listEl.innerHTML = ''
        if (state.scripts.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'vpe-hint'
            empty.textContent = 'No scripts yet. Load a .js file or paste a snippet above.'
            listEl.appendChild(empty)
            return
        }
        for (const entry of state.scripts) {
            listEl.appendChild(buildEntryRow(entry))
        }
    }

    function buildEntryRow(entry: ScriptEntry): HTMLElement {
        const card = document.createElement('div')
        card.style.display = 'flex'
        card.style.flexDirection = 'column'
        card.style.gap = '4px'
        card.style.padding = '7px 8px'
        card.style.borderRadius = '5px'
        card.style.border = '1px solid rgba(217, 247, 255, 0.18)'
        card.style.background = editingId === entry.id
            ? 'rgba(28, 36, 26, 0.65)'
            : 'rgba(8, 12, 16, 0.45)'

        const header = document.createElement('div')
        header.className = 'vpe-row'
        header.style.alignItems = 'center'
        header.style.gap = '6px'

        const enabled = document.createElement('input')
        enabled.type = 'checkbox'
        enabled.checked = entry.enabled !== false
        enabled.title = 'Disabled scripts skip compile + execution at playtest.'
        enabled.onchange = () => {
            entry.enabled = enabled.checked
            refresh()
        }

        const name = document.createElement('span')
        name.textContent = entry.name
        name.title = entry.fromFile ? `Loaded from ${entry.sourcePath ?? 'disk'}` : 'Pasted snippet'
        name.style.flex = '1'
        name.style.fontWeight = '600'
        name.style.color = entry.fromFile ? '#bdf' : '#dfeae0'

        const size = document.createElement('span')
        size.className = 'vpe-hint'
        size.textContent = `${entry.source.length} chars`

        const editBtn = document.createElement('button')
        editBtn.className = 'vpe-button'
        editBtn.textContent = editingId === entry.id ? 'Editing…' : 'Edit'
        editBtn.disabled = editingId === entry.id
        editBtn.title = 'Load the source into the textarea above so you can edit + save changes.'
        editBtn.onclick = () => {
            editingId = entry.id
            nameInput.value = entry.name
            textarea.value = entry.source
            saveBtn.textContent = 'Save changes'
            cancelBtn.style.display = 'inline-block'
            statusEl.textContent = ''
            textarea.focus()
            refresh()
        }

        const reloadBtn = entry.fromFile
            ? makeReloadButton(entry, refresh)
            : null

        const removeBtn = document.createElement('button')
        removeBtn.className = 'vpe-button'
        removeBtn.textContent = '✕'
        removeBtn.style.padding = '2px 8px'
        removeBtn.title = 'Remove this script entry from the level.'
        removeBtn.onclick = () => {
            const idx = state.scripts.findIndex((e) => e.id === entry.id)
            if (idx >= 0) state.scripts.splice(idx, 1)
            if (editingId === entry.id) {
                editingId = null
                textarea.value = ''
                nameInput.value = ''
                saveBtn.textContent = 'Save snippet'
                cancelBtn.style.display = 'none'
            }
            refresh()
        }

        header.append(enabled, name, size)
        if (reloadBtn) header.appendChild(reloadBtn)
        header.append(editBtn, removeBtn)
        card.appendChild(header)

        if (entry.fromFile && entry.sourcePath) {
            const path = document.createElement('div')
            path.className = 'vpe-hint'
            path.style.fontSize = '11px'
            path.textContent = entry.sourcePath
            card.appendChild(path)
        }
        return card
    }

    function refresh(): void {
        rebuildList()
    }

    refresh()
    return { element: root, refresh }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function addEntry(state: EditorState, partial: { name: string; source: string; fromFile?: boolean; sourcePath?: string }): void {
    state.scripts.push({
        id: nextScriptId(state),
        name: partial.name,
        source: partial.source,
        fromFile: partial.fromFile,
        sourcePath: partial.sourcePath,
        enabled: true,
    })
}

function updateEntry(state: EditorState, id: string, source: string, name: string): void {
    const entry = state.scripts.find((e) => e.id === id)
    if (!entry) return
    entry.source = source
    entry.name = name
}

function nextScriptId(state: EditorState): string {
    let n = state.scripts.length + 1
    const taken = new Set(state.scripts.map((e) => e.id))
    while (taken.has(`script-${n}`)) n++
    return `script-${n}`
}

function nextDefaultName(state: EditorState): string {
    let n = state.scripts.length + 1
    const taken = new Set(state.scripts.map((e) => e.name))
    while (taken.has(`snippet-${n}`)) n++
    return `snippet-${n}`
}

function pickFile(onLoad: (name: string, source: string) => void): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.js,.mjs,.ts,application/javascript,text/javascript'
    input.onchange = () => {
        const file = input.files?.[0]
        if (!file) return
        file.text().then((text) => onLoad(file.name, text)).catch((err) => {
            // eslint-disable-next-line no-alert
            alert(`Failed to read ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
        })
    }
    input.click()
}

function makeReloadButton(entry: ScriptEntry, refresh: () => void): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'vpe-button'
    btn.textContent = '↻'
    btn.style.padding = '2px 8px'
    btn.title = 'Re-pick the source file and replace this entry\'s text.'
    btn.onclick = () => pickFile((name, source) => {
        entry.source = source
        // Keep the original name unless the user picked a file with
        // the same exact name (likely intentional rename). The
        // original name is what existing event handlers in OTHER
        // entries might reference indirectly via flags / emit,
        // though that's loose.
        if (entry.name !== name && entry.name.endsWith('.js')) entry.name = name
        refresh()
    })
    return btn
}

interface ParseSuccess { ok: true }
interface ParseFailure { ok: false; error: string }

function parseCheck(source: string): ParseSuccess | ParseFailure {
    if (!source.trim()) return { ok: false, error: 'Empty script.' }
    try {
        const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => unknown
        // Wrap in the same destructure shape the runtime uses so
        // shadowed names (`on`, `wait`, etc.) parse the same way.
        new AsyncFunctionCtor('ctx', `"use strict"; const { on, once, emit, wait, log, player, chunks, pickups, audio, flags, time, zone, geom, ui, dayCycle, weather, random } = ctx; ${source}`)
        return { ok: true }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
}

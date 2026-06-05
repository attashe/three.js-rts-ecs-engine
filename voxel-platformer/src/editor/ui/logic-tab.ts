import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import { PRELUDE_LOCALS } from '../../engine/script/compile'
import type { ScriptEntry } from '../../engine/script/types'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import {
    clearAllPlaytestScriptErrors,
    clearPlaytestScriptError,
    readPlaytestScriptErrors,
    type RecordedScriptError,
} from '../playtest-error-bridge'
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
            // Editing a row that previously stashed a runtime error
            // means the recorded source is no longer current. Drop
            // the entry from the bridge so the banner doesn't linger.
            clearPlaytestScriptError(editingId)
            runtimeErrors.delete(editingId)
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

    // Header row hosts a "Clear playtest errors" affordance so authors
    // can sweep stale runtime errors from the last playtest without
    // re-running anything. Hidden when no errors are recorded so it
    // doesn't add visual noise to a clean level.
    const listHeader = document.createElement('div')
    listHeader.className = 'vpe-row'
    listHeader.style.justifyContent = 'flex-end'
    listHeader.style.marginTop = '-4px'
    const clearErrorsBtn = document.createElement('button')
    clearErrorsBtn.className = 'vpe-button'
    clearErrorsBtn.textContent = 'Clear playtest errors'
    clearErrorsBtn.title = 'Forget every runtime error stashed from the last playtest. New errors appear on the next playtest.'
    clearErrorsBtn.style.display = 'none'
    clearErrorsBtn.onclick = () => {
        clearAllPlaytestScriptErrors()
        runtimeErrors.clear()
        refresh()
    }
    listHeader.appendChild(clearErrorsBtn)
    listSection.appendChild(listHeader)

    const listEl = document.createElement('div')
    listEl.style.display = 'flex'
    listEl.style.flexDirection = 'column'
    listEl.style.gap = '6px'
    listSection.appendChild(listEl)
    root.appendChild(listSection)

    let editingId: string | null = null
    let lastListFingerprint = ''
    let runtimeErrors: Map<string, RecordedScriptError> = new Map()

    function rebuildList(): void {
        runtimeErrors = readPlaytestScriptErrors()
        // Fingerprint folds in source content + recorded runtime errors
        // so an edit OR a fresh playtest error invalidates the cached
        // row list. Errors are keyed by scriptId so a per-row banner
        // refresh fires when the stored set changes.
        const errorFp = [...runtimeErrors.values()]
            .map((e) => `${e.scriptId}:${e.phase}:${e.occurredAt}`)
            .sort()
            .join('|')
        const fp = state.scripts.map((e) => `${e.id}:${e.name}:${e.enabled ?? true}:${e.source.length}:${hashShort(e.source)}`).join('|') + '#' + errorFp
        if (fp === lastListFingerprint && editingId === null) return
        lastListFingerprint = fp
        clearErrorsBtn.style.display = runtimeErrors.size > 0 ? 'inline-block' : 'none'
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
            // Clear-on-edit: the recorded error refers to the
            // already-superseded source. Drop it now so the banner
            // disappears as soon as the author starts iterating.
            clearPlaytestScriptError(entry.id)
            runtimeErrors.delete(entry.id)
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
            clearPlaytestScriptError(entry.id)
            runtimeErrors.delete(entry.id)
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

        // Per-entry parse-error banner. Runs the same AsyncFunction parse
        // the runtime uses, so a syntax error caught here exactly matches
        // the playtest "broken at compile" error a Slice 1 reviewer would
        // have hit silently.
        const parseResult = parseCheck(entry.source)
        if (!parseResult.ok) {
            card.appendChild(errorBanner('parse', `Parse error: ${parseResult.error}`,
                'Editing this script will re-run the parse check on save.'))
        }

        // Per-entry runtime-error banner — populated by the playtest
        // tab via `recordPlaytestScriptError`. We surface the most
        // recent recorded error and let the user clear it inline; the
        // banner also auto-clears when the user starts an edit on
        // this row (see editBtn above).
        const runtimeErr = runtimeErrors.get(entry.id)
        if (runtimeErr) {
            const banner = errorBanner('runtime',
                `Playtest ${runtimeErr.phase} error (${runtimeErr.where}): ${runtimeErr.message}`,
                `Recorded ${formatRelativeTime(runtimeErr.occurredAt)} during playtest. Editing this row clears it.`)
            const dismiss = document.createElement('button')
            dismiss.className = 'vpe-button'
            dismiss.textContent = 'Dismiss'
            dismiss.style.padding = '2px 8px'
            dismiss.style.marginLeft = '6px'
            dismiss.style.float = 'right'
            dismiss.onclick = () => {
                clearPlaytestScriptError(entry.id)
                runtimeErrors.delete(entry.id)
                refresh()
            }
            banner.appendChild(dismiss)
            card.appendChild(banner)
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
        // Reloaded source is fresh; the previously-stashed runtime
        // error refers to an old build of this row.
        clearPlaytestScriptError(entry.id)
        refresh()
    })
    return btn
}

/** Build a consistent red-bordered banner DOM for parse + runtime errors.
 *  Both phases use the same visual treatment so the user reads "this row
 *  has a problem" first and the phase tag second. */
function errorBanner(phase: 'parse' | 'runtime', message: string, title?: string): HTMLDivElement {
    const banner = document.createElement('div')
    banner.className = 'vpe-hint'
    banner.style.fontFamily = 'ui-monospace, monospace'
    banner.style.color = phase === 'parse' ? '#ff7e7e' : '#ffa06b'
    banner.style.background = phase === 'parse'
        ? 'rgba(220, 60, 60, 0.10)'
        : 'rgba(220, 130, 60, 0.10)'
    banner.style.border = `1px solid ${phase === 'parse' ? 'rgba(255, 126, 126, 0.40)' : 'rgba(255, 160, 107, 0.40)'}`
    banner.style.borderRadius = '3px'
    banner.style.padding = '4px 6px'
    banner.style.whiteSpace = 'pre-wrap'
    banner.style.fontSize = '11px'
    banner.textContent = message
    if (title) banner.title = title
    return banner
}

/** Human-readable "5 m ago" / "2 h ago" string. Used in runtime-error
 *  banner titles so the user can spot stale errors at a glance. */
function formatRelativeTime(ts: number): string {
    if (!Number.isFinite(ts) || ts <= 0) return 'just now'
    const elapsedSec = Math.max(0, (Date.now() - ts) / 1000)
    if (elapsedSec < 60) return 'just now'
    if (elapsedSec < 3600) return `${Math.round(elapsedSec / 60)} min ago`
    if (elapsedSec < 86400) return `${Math.round(elapsedSec / 3600)} h ago`
    return `${Math.round(elapsedSec / 86400)} d ago`
}

/** Cheap content fingerprint so the row-list cache invalidates when a
 *  source string changes (without storing the full source per entry in
 *  the fingerprint). Collisions are tolerated — at worst a row skips a
 *  re-render for a content change of identical length and FNV-1a hash. */
function hashShort(s: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h | 0
}

interface ParseSuccess { ok: true }
interface ParseFailure { ok: false; error: string }

function parseCheck(source: string): ParseSuccess | ParseFailure {
    if (!source.trim()) return { ok: false, error: 'Empty script.' }
    try {
        const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => unknown
        // Wrap in the same destructure shape the runtime uses so
        // shadowed names (`on`, `wait`, etc.) parse the same way.
        new AsyncFunctionCtor('ctx', `"use strict"; const { ${PRELUDE_LOCALS} } = ctx; ${source}`)
        return { ok: true }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
}

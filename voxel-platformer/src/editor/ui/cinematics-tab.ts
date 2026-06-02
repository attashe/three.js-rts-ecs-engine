// Cinematics tab — author camera/text/character sequences and preview them in
// the editor. Cinematics are level-global (no world placement); this tab edits
// `editorState.cinematics`. The camera "Capture view" / "Jump to shot" buttons
// and the Play/Stop preview are driven through the CinematicPreviewController
// the editor bootstrap injects (it owns the renderer/camera).

import { sectionEl, type RefreshableElement } from './common'
import type { MountEditorPanelOptions } from './index'
import type { EditorState } from '../editor-state'
import {
    estimateDuration,
    newStep,
    type Cinematic,
    type CinematicStep,
    type CinematicStepType,
    type Vec3,
} from '../../game/cinematics/cinematic-types'

const STEP_TYPES: { type: CinematicStepType; label: string }[] = [
    { type: 'camera', label: 'Camera' },
    { type: 'subtitle', label: 'Subtitle' },
    { type: 'speech', label: 'Speech' },
    { type: 'move', label: 'Move' },
    { type: 'wait', label: 'Wait' },
    { type: 'fade', label: 'Fade' },
    { type: 'sound', label: 'Sound' },
]

export function buildCinematicsTab(opts: MountEditorPanelOptions): RefreshableElement {
    const state = opts.editorState
    const preview = opts.cinematicPreview ?? null

    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const listHost = document.createElement('div')
    const editorHost = document.createElement('div')
    root.append(listHost, editorHost)

    let fingerprint = ''

    function selected(): Cinematic | null {
        return state.cinematics.find((c) => c.id === state.selectedCinematicId) ?? null
    }

    function nextCinematicId(): string {
        const taken = new Set(state.cinematics.map((c) => c.id))
        let n = state.cinematics.length + 1
        while (taken.has(`cinematic-${n}`)) n++
        return `cinematic-${n}`
    }

    function nextStepId(c: Cinematic): string {
        const taken = new Set(c.steps.map((s) => s.id))
        let n = c.steps.length + 1
        while (taken.has(`step-${n}`)) n++
        return `step-${n}`
    }

    function rebuild(): void {
        renderList()
        renderEditor()
        fingerprint = currentFingerprint()
    }

    function currentFingerprint(): string {
        const c = selected()
        const steps = c ? c.steps.map((s) => `${s.id}:${s.type}:${s.wait}`).join(',') : ''
        return `${state.cinematics.map((x) => x.id + x.name).join('|')}##${state.selectedCinematicId}##${steps}`
    }

    // ── cinematics list ─────────────────────────────────────────────
    function renderList(): void {
        listHost.innerHTML = ''
        const section = sectionEl('Cinematics')
        const add = button('+ New cinematic', () => {
            const id = nextCinematicId()
            state.cinematics.push({ id, name: `Cinematic ${state.cinematics.length + 1}`, letterbox: true, freezePlayer: true, steps: [] })
            state.selectedCinematicId = id
            rebuild()
        })
        section.appendChild(add)

        if (state.cinematics.length === 0) {
            section.appendChild(hint('No cinematics yet. Create one, then add steps and preview.'))
        }
        const list = document.createElement('div')
        list.className = 'vpe-list'
        for (const c of state.cinematics) {
            const item = document.createElement('div')
            item.className = 'vpe-list-item'
            if (c.id === state.selectedCinematicId) item.style.outline = '1px solid #6cf'
            const name = document.createElement('span')
            name.textContent = `${c.name} (${c.steps.length})`
            name.style.flex = '1'
            name.style.cursor = 'pointer'
            name.onclick = () => { state.selectedCinematicId = c.id; rebuild() }
            const dup = button('⧉', () => {
                const copy = { ...c, id: nextCinematicId(), name: `${c.name} copy`, steps: c.steps.map((s) => ({ ...s })) }
                state.cinematics.push(copy)
                state.selectedCinematicId = copy.id
                rebuild()
            }, { title: 'Duplicate' })
            const del = button('✕', () => {
                state.cinematics = state.cinematics.filter((x) => x.id !== c.id)
                if (state.selectedCinematicId === c.id) state.selectedCinematicId = state.cinematics[0]?.id ?? null
                rebuild()
            }, { title: 'Delete' })
            item.append(name, dup, del)
            list.appendChild(item)
        }
        section.appendChild(list)
        listHost.appendChild(section)
    }

    // ── selected-cinematic editor ───────────────────────────────────
    function renderEditor(): void {
        editorHost.innerHTML = ''
        const c = selected()
        if (!c) return

        const meta = sectionEl('Settings')
        meta.appendChild(field('Name', textInput(c.name, (v) => { c.name = v; renderList() })))
        meta.appendChild(checkbox('Play on level start', c.playOnStart ?? false, (v) => { c.playOnStart = v }))
        meta.appendChild(checkbox('Letterbox bars', c.letterbox ?? true, (v) => { c.letterbox = v }))
        meta.appendChild(checkbox('Freeze player', c.freezePlayer ?? true, (v) => { c.freezePlayer = v }))
        editorHost.appendChild(meta)

        // Preview bar.
        const prev = sectionEl('Preview')
        const playBtn = button('▶ Play', () => preview?.play(c))
        const stopBtn = button('■ Stop', () => preview?.stop())
        if (!preview) { playBtn.disabled = true; stopBtn.disabled = true }
        const dur = document.createElement('span')
        dur.className = 'vpe-field-label'
        dur.textContent = `~${estimateDuration(c).toFixed(1)}s`
        const row = document.createElement('div')
        row.className = 'vpe-row'
        row.append(playBtn, stopBtn, dur)
        prev.appendChild(row)
        prev.appendChild(hint('Capture/Jump need the Orbit view (press V). Character walking is shown in playtest.'))
        editorHost.appendChild(prev)

        // Steps.
        const stepsSection = sectionEl('Steps')
        const addRow = document.createElement('div')
        addRow.className = 'vpe-row'
        addRow.style.flexWrap = 'wrap'
        for (const { type, label } of STEP_TYPES) {
            addRow.appendChild(button(`+ ${label}`, () => {
                const shot = type === 'camera' && preview ? preview.captureShot() : undefined
                c.steps.push(newStep(type, nextStepId(c), shot))
                rebuild()
            }))
        }
        stepsSection.appendChild(addRow)

        c.steps.forEach((step, index) => stepsSection.appendChild(renderStep(c, step, index)))
        editorHost.appendChild(stepsSection)
    }

    function renderStep(c: Cinematic, step: CinematicStep, index: number): HTMLElement {
        const box = document.createElement('div')
        box.className = 'vpe-section'
        box.style.padding = '6px'
        box.style.border = '1px solid rgba(255,255,255,0.12)'

        // Header: index, type, wait toggle, reorder, delete.
        const head = document.createElement('div')
        head.className = 'vpe-row'
        const title = document.createElement('span')
        title.textContent = `${index + 1}. ${step.type}`
        title.style.flex = '1'
        title.style.fontWeight = '600'
        head.appendChild(title)
        if (step.type !== 'wait' && step.type !== 'sound') {
            head.appendChild(button(step.wait ? '▶ wait' : '‖ with next', () => {
                ;(step as { wait: boolean }).wait = !step.wait
                rebuild()
            }, { title: 'Toggle: block before next step / run concurrently' }))
        }
        head.appendChild(button('↑', () => move(c, index, -1), { title: 'Move up' }))
        head.appendChild(button('↓', () => move(c, index, +1), { title: 'Move down' }))
        head.appendChild(button('✕', () => { c.steps.splice(index, 1); rebuild() }, { title: 'Delete step' }))
        box.appendChild(head)

        box.appendChild(renderStepBody(step))
        return box
    }

    function renderStepBody(step: CinematicStep): HTMLElement {
        const body = document.createElement('div')
        body.style.display = 'grid'
        body.style.gap = '4px'
        switch (step.type) {
            case 'camera': {
                const cam = step
                if (preview) {
                    const camRow = document.createElement('div')
                    camRow.className = 'vpe-row'
                    camRow.append(
                        button('Capture view', () => { cam.shot = preview.captureShot(); rebuild() }, { title: 'Set this shot from the current orbit camera' }),
                        button('Jump to shot', () => preview.jumpTo(cam.shot), { title: 'Move the editor camera to this shot' }),
                    )
                    body.appendChild(camRow)
                }
                body.appendChild(vec3Row('Pos', cam.shot.position))
                body.appendChild(vec3Row('Look', cam.shot.target))
                body.appendChild(field('Zoom', numberInput(cam.shot.zoom, (v) => { cam.shot.zoom = v }, { min: 0.1, max: 8, step: 0.05 })))
                body.appendChild(field('Tween s', numberInput(cam.duration, (v) => { cam.duration = v }, { min: 0, max: 60, step: 0.1 })))
                body.appendChild(field('Ease', select(cam.ease, [['linear', 'Linear'], ['easeInOut', 'Ease in-out'], ['easeOut', 'Ease out']], (v) => { cam.ease = v as typeof cam.ease })))
                break
            }
            case 'subtitle': {
                const s = step
                body.appendChild(field('Text', textInput(s.text, (v) => { s.text = v })))
                body.appendChild(field('Speaker', textInput(s.speaker ?? '', (v) => { s.speaker = v || undefined }, 'optional')))
                body.appendChild(field('Seconds', numberInput(s.duration, (v) => { s.duration = v }, { min: 0, max: 60, step: 0.1 })))
                break
            }
            case 'speech': {
                const s = step
                body.appendChild(field('NPC', npcSelect(s.npcId, (v) => { s.npcId = v })))
                body.appendChild(field('Line', textInput(s.text, (v) => { s.text = v })))
                body.appendChild(field('Seconds', numberInput(s.seconds ?? 0, (v) => { s.seconds = v > 0 ? v : undefined }, { min: 0, max: 60, step: 0.1 })))
                break
            }
            case 'move': {
                const s = step
                body.appendChild(field('NPC', npcSelect(s.npcId, (v) => { s.npcId = v })))
                body.appendChild(vec3Row('To', s.to))
                if (state.cursor) {
                    body.appendChild(button('Use cursor', () => {
                        const cur = state.cursor!
                        s.to = { x: cur.x + 0.5, y: cur.y, z: cur.z + 0.5 }
                        rebuild()
                    }))
                }
                body.appendChild(field('Timeout s', numberInput(s.timeoutSeconds ?? 8, (v) => { s.timeoutSeconds = v }, { min: 0, max: 60, step: 0.5 })))
                break
            }
            case 'wait':
                body.appendChild(field('Seconds', numberInput(step.duration, (v) => { step.duration = v }, { min: 0, max: 60, step: 0.1 })))
                break
            case 'fade': {
                const s = step
                body.appendChild(field('To', select(s.to, [['black', 'Black'], ['clear', 'Clear']], (v) => { s.to = v as 'black' | 'clear' })))
                body.appendChild(field('Seconds', numberInput(s.duration, (v) => { s.duration = v }, { min: 0, max: 60, step: 0.1 })))
                break
            }
            case 'sound': {
                const s = step
                body.appendChild(field('Sound id', textInput(s.soundId, (v) => { s.soundId = v }, 'e.g. music.theme.royal')))
                body.appendChild(field('Fade s', numberInput(s.fade ?? 0, (v) => { s.fade = v }, { min: 0, max: 10, step: 0.1 })))
                break
            }
        }
        return body
    }

    function move(c: Cinematic, index: number, dir: -1 | 1): void {
        const j = index + dir
        if (j < 0 || j >= c.steps.length) return
        const [s] = c.steps.splice(index, 1)
        c.steps.splice(j, 0, s!)
        rebuild()
    }

    // ── small widgets ───────────────────────────────────────────────
    function npcSelect(value: string, onChange: (v: string) => void): HTMLSelectElement {
        const options: [string, string][] = [['', '(pick NPC)'], ...state.npcs.map((n): [string, string] => [n.id, n.name])]
        return select(value, options, onChange)
    }

    function vec3Row(label: string, vec: Vec3): HTMLElement {
        const row = document.createElement('div')
        row.className = 'vpe-field'
        const span = document.createElement('span')
        span.className = 'vpe-field-label'
        span.textContent = label
        const wrap = document.createElement('div')
        wrap.style.display = 'flex'
        wrap.style.gap = '3px'
        wrap.append(
            numberInput(vec.x, (v) => { vec.x = v }, { step: 0.5, width: '52px' }),
            numberInput(vec.y, (v) => { vec.y = v }, { step: 0.5, width: '52px' }),
            numberInput(vec.z, (v) => { vec.z = v }, { step: 0.5, width: '52px' }),
        )
        row.append(span, wrap)
        return row
    }

    rebuild()
    return {
        element: root,
        refresh() {
            // External changes (load, V-toggle nothing here) → rebuild only on
            // structural change so typing in inputs doesn't lose focus.
            if (currentFingerprint() !== fingerprint) rebuild()
        },
    }
}

// ── generic field helpers (kept local, matching the other tabs) ─────

function field(label: string, input: HTMLElement): HTMLElement {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    row.append(span, input)
    return row
}

function numberInput(
    value: number,
    onChange: (v: number) => void,
    opts: { min?: number; max?: number; step?: number; width?: string } = {},
): HTMLInputElement {
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    if (opts.min !== undefined) input.min = String(opts.min)
    if (opts.max !== undefined) input.max = String(opts.max)
    input.step = String(opts.step ?? 1)
    input.value = String(value)
    input.style.width = opts.width ?? '70px'
    input.oninput = () => {
        const v = parseFloat(input.value)
        if (Number.isFinite(v)) onChange(v)
    }
    return input
}

function textInput(value: string, onChange: (v: string) => void, placeholder = ''): HTMLInputElement {
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'text'
    input.value = value
    input.placeholder = placeholder
    input.oninput = () => onChange(input.value)
    return input
}

function select(value: string, options: [string, string][], onChange: (v: string) => void): HTMLSelectElement {
    const sel = document.createElement('select')
    sel.className = 'vpe-input'
    for (const [val, label] of options) {
        const opt = document.createElement('option')
        opt.value = val
        opt.textContent = label
        sel.appendChild(opt)
    }
    sel.value = value
    sel.onchange = () => onChange(sel.value)
    return sel
}

function checkbox(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    row.style.cursor = 'pointer'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.onchange = () => onChange(input.checked)
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    row.append(input, span)
    return row
}

function button(label: string, onClick: () => void, opts: { title?: string } = {}): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'vpe-button'
    btn.textContent = label
    if (opts.title) btn.title = opts.title
    btn.onclick = onClick
    return btn
}

function hint(text: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'vpe-hint'
    el.textContent = text
    return el
}

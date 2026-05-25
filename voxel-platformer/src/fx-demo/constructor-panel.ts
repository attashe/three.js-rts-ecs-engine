import type { WeatherZone, WeatherZoneParams } from '../engine/fx'
import type { FxTemplate, TemplateStore } from './template-store'
import { cloneParams } from './template-store'
import {
    checkboxField,
    collapsible,
    colorField,
    el,
    sliderField,
    textField,
    vec3Field,
    type CheckboxField,
    type ColorField,
    type SliderField,
    type TextField,
} from './ui-helpers'

/**
 * Constructor panel — a single form that edits either a template
 * (palette entry) or a live zone (placed in the world). The form
 * keeps a `draft` copy of `WeatherZoneParams`; every input edit
 * mutates the draft and dispatches `onChange`. The orchestrator
 * decides whether the change goes to `fx.updateZone` (zone mode) or
 * just stays in the draft (template mode) until the user saves.
 *
 * Tying both editing surfaces to the same form keeps the UI
 * consistent: editing a placed lava pool feels the same as editing a
 * "Lava" template, and either can be saved as a new custom template.
 */

export type ConstructorTarget =
    | { kind: 'template'; template: FxTemplate }
    | { kind: 'zone'; zone: WeatherZone; templateId?: string }
    | { kind: 'empty' }

export interface ConstructorHandle {
    element: HTMLElement
    /** Switch what the form is editing. Form fields refresh to match. */
    setTarget(target: ConstructorTarget): void
    /** Push the latest live zone params back into the form — call
     *  this whenever something outside the constructor mutates the
     *  selected zone (e.g. the TransformControls gizmo). */
    refresh(): void
    /** Read the current draft. The orchestrator uses this when the
     *  user clicks "Spawn" or "Save as new". */
    draft(): WeatherZoneParams
}

export interface ConstructorCallbacks {
    /** Spawn a new zone in the world from the current draft. */
    onSpawn(draft: WeatherZoneParams): void
    /** Save the current draft back onto the active custom template.
     *  Only enabled when target.kind === 'template' && !template.builtin. */
    onSaveChanges(draft: WeatherZoneParams): void
    /** Persist the draft as a brand-new custom template. */
    onSaveAsNew(draft: WeatherZoneParams): void
    /** Delete the active custom template. */
    onDeleteTemplate(template: FxTemplate): void
    /** Delete the live zone (when editing a zone). */
    onRemoveZone(zone: WeatherZone): void
    /** Live edit callback. Called on every input change when the
     *  target is a placed zone — the orchestrator forwards to
     *  `fx.updateZone(id, patch)`. */
    onZoneEdit(zone: WeatherZone, patch: Partial<WeatherZoneParams>): void
}

export function mountConstructor(opts: { root: HTMLElement; store: TemplateStore } & ConstructorCallbacks): ConstructorHandle {
    let target: ConstructorTarget = { kind: 'empty' }
    let draft: WeatherZoneParams = emptyParams()
    // While `refresh()` is pushing values back into the inputs we
    // mustn't react to the synthetic `input` events those triggers
    // emit, or the constructor will fire phantom edits back to the
    // live zone and stomp values the user is actively dragging.
    let syncing = false

    const root = opts.root
    root.classList.add('constructor')

    // Header — shows what we're editing, plus the action buttons.
    const header = el('div', 'constructor-head')
    const title = el('div', 'constructor-title')
    const subtitle = el('div', 'hint')
    header.append(title, subtitle)
    root.appendChild(header)

    const actions = el('div', 'row')
    actions.style.marginTop = '6px'
    const spawnBtn = el('button', 'full')
    spawnBtn.textContent = '+ Spawn'
    spawnBtn.title = 'Drop a copy of the current settings at the camera target'
    spawnBtn.onclick = () => opts.onSpawn(cloneParams(draft))

    const saveBtn = el('button', 'full')
    saveBtn.textContent = 'Save'
    saveBtn.title = 'Persist edits back to this custom template'
    saveBtn.onclick = () => opts.onSaveChanges(cloneParams(draft))

    const saveAsBtn = el('button', 'full')
    saveAsBtn.textContent = 'Save as new'
    saveAsBtn.title = 'Add a new custom template to the palette'
    saveAsBtn.onclick = () => opts.onSaveAsNew(cloneParams(draft))

    const deleteBtn = el('button', 'full danger')
    deleteBtn.textContent = 'Delete'
    deleteBtn.title = 'Delete the active custom template or remove the live zone'
    deleteBtn.onclick = () => {
        if (target.kind === 'template' && !target.template.builtin) {
            if (window.confirm(`Delete template "${target.template.label}"?`)) opts.onDeleteTemplate(target.template)
        } else if (target.kind === 'zone') {
            opts.onRemoveZone(target.zone)
        }
    }

    actions.append(spawnBtn, saveBtn, saveAsBtn, deleteBtn)
    root.appendChild(actions)

    // ── Form fields ───────────────────────────────────────────────
    const body = el('div')
    body.style.marginTop = '8px'
    root.appendChild(body)

    // Basics
    const basics = collapsible('Basics', true)
    body.appendChild(basics.root)
    const nameInput = textField({ label: 'Name', initial: 'Effect', placeholder: 'name' })
    const colorInput = colorField({ label: 'Color', initial: '#ffffff' })
    basics.body.append(nameInput.row, colorInput.row)

    // Particles
    const particles = collapsible('Particles', true)
    body.appendChild(particles.root)
    const countInput = sliderField({ label: 'Count', min: 50, max: 8000, step: 50, initial: 1000 })
    const sizeInput = sliderField({ label: 'Size', min: 0.01, max: 2.4, step: 0.01, initial: 0.2, decimals: 2 })
    const opacityInput = sliderField({ label: 'Opacity', min: 0, max: 1, step: 0.01, initial: 0.8, decimals: 2 })
    const speedInput = sliderField({ label: 'Speed', min: 0, max: 30, step: 0.1, initial: 1, decimals: 1 })
    const turbInput = sliderField({ label: 'Turbulence', min: 0, max: 5, step: 0.05, initial: 1, decimals: 2 })
    const lifetimeInput = sliderField({ label: 'Lifetime', min: 0.5, max: 20, step: 0.1, initial: 4, decimals: 1, suffix: 's' })
    const gravityInput = sliderField({ label: 'Gravity', min: -2, max: 3, step: 0.05, initial: 0, decimals: 2 })
    particles.body.append(
        countInput.row, sizeInput.row, opacityInput.row, speedInput.row,
        turbInput.row, lifetimeInput.row, gravityInput.row,
    )

    // Wind
    const wind = collapsible('Wind')
    body.appendChild(wind.root)
    const windXInput = sliderField({ label: 'Wind X', min: -12, max: 12, step: 0.1, initial: 0, decimals: 1 })
    const windZInput = sliderField({ label: 'Wind Z', min: -12, max: 12, step: 0.1, initial: 0, decimals: 1 })
    wind.body.append(windXInput.row, windZInput.row)

    // Transform — position + size (numeric inputs; the gizmo also
    // pushes here via `refresh()`).
    const xform = collapsible('Transform')
    body.appendChild(xform.root)
    const posInput = vec3Field({ label: 'Position', initial: { x: 0, y: 0, z: 0 }, step: 0.1 })
    const sizeVecInput = vec3Field({ label: 'Size', initial: { x: 10, y: 6, z: 10 }, min: 1, step: 0.1 })
    xform.body.append(posInput.row, sizeVecInput.row)

    // Streaks
    const streaks = collapsible('Streaks')
    body.appendChild(streaks.root)
    const streaksToggle = checkboxField({ label: 'Streaks enabled', initial: false })
    const streakLenInput = sliderField({ label: 'Length', min: 0.02, max: 2.5, step: 0.01, initial: 0.5, decimals: 2 })
    streaks.body.append(streaksToggle.row, streakLenInput.row)

    // Light
    const light = collapsible('Light')
    body.appendChild(light.root)
    const lightOn = checkboxField({ label: 'Light enabled', initial: false })
    const lightColor = colorField({ label: 'Color', initial: '#ffffff' })
    const lightInt = sliderField({ label: 'Intensity', min: 0, max: 30, step: 0.05, initial: 1, decimals: 2 })
    const lightDist = sliderField({ label: 'Distance', min: 1, max: 100, step: 0.5, initial: 16, decimals: 1 })
    const lightning = checkboxField({ label: 'Lightning flashes', initial: false })
    light.body.append(lightOn.row, lightColor.row, lightInt.row, lightDist.row, lightning.row)

    // Wire all inputs to push into the draft + propagate the change.
    const allSliders: SliderField[] = [
        countInput, sizeInput, opacityInput, speedInput, turbInput, lifetimeInput, gravityInput,
        windXInput, windZInput, streakLenInput, lightInt, lightDist,
    ]
    const allCheckboxes: CheckboxField[] = [streaksToggle, lightOn, lightning]
    const allColors: ColorField[] = [colorInput, lightColor]
    const allTexts: TextField[] = [nameInput]

    function commit(): void {
        if (syncing) return
        const patch = readForm()
        Object.assign(draft, patch)
        if (patch.position) draft.position = { ...patch.position }
        if (patch.size) draft.size = { ...patch.size }
        if (target.kind === 'zone') opts.onZoneEdit(target.zone, patch)
    }

    for (const s of allSliders) s.input.addEventListener('input', commit)
    for (const c of allCheckboxes) c.input.addEventListener('change', commit)
    for (const c of allColors) c.input.addEventListener('input', commit)
    for (const t of allTexts) t.input.addEventListener('input', commit)
    for (const i of posInput.inputs) i.addEventListener('input', commit)
    for (const i of sizeVecInput.inputs) i.addEventListener('input', commit)

    function readForm(): Partial<WeatherZoneParams> {
        return {
            name: nameInput.input.value || 'Effect',
            color: colorInput.input.value,
            count: parseIntSafe(countInput.input.value, draft.count),
            particleSize: parseFloatSafe(sizeInput.input.value, draft.particleSize),
            opacity: parseFloatSafe(opacityInput.input.value, draft.opacity),
            speed: parseFloatSafe(speedInput.input.value, draft.speed),
            turbulence: parseFloatSafe(turbInput.input.value, draft.turbulence),
            lifetime: parseFloatSafe(lifetimeInput.input.value, draft.lifetime),
            gravity: parseFloatSafe(gravityInput.input.value, draft.gravity),
            windX: parseFloatSafe(windXInput.input.value, draft.windX),
            windZ: parseFloatSafe(windZInput.input.value, draft.windZ),
            position: {
                x: parseFloatSafe(posInput.inputs[0].value, draft.position.x),
                y: parseFloatSafe(posInput.inputs[1].value, draft.position.y),
                z: parseFloatSafe(posInput.inputs[2].value, draft.position.z),
            },
            size: {
                x: Math.max(1, parseFloatSafe(sizeVecInput.inputs[0].value, draft.size.x)),
                y: Math.max(1, parseFloatSafe(sizeVecInput.inputs[1].value, draft.size.y)),
                z: Math.max(1, parseFloatSafe(sizeVecInput.inputs[2].value, draft.size.z)),
            },
            streaks: streaksToggle.input.checked,
            streakLength: parseFloatSafe(streakLenInput.input.value, draft.streakLength),
            lightEnabled: lightOn.input.checked,
            lightColor: lightColor.input.value,
            lightIntensity: parseFloatSafe(lightInt.input.value, draft.lightIntensity),
            lightDistance: parseFloatSafe(lightDist.input.value, draft.lightDistance),
            lightning: lightning.input.checked,
        }
    }

    function pushForm(): void {
        syncing = true
        try {
            nameInput.setValue(draft.name)
            colorInput.setValue(draft.color)
            countInput.setValue(draft.count)
            sizeInput.setValue(draft.particleSize)
            opacityInput.setValue(draft.opacity)
            speedInput.setValue(draft.speed)
            turbInput.setValue(draft.turbulence)
            lifetimeInput.setValue(draft.lifetime)
            gravityInput.setValue(draft.gravity)
            windXInput.setValue(draft.windX)
            windZInput.setValue(draft.windZ)
            posInput.setValue(draft.position)
            sizeVecInput.setValue(draft.size)
            streaksToggle.setValue(draft.streaks)
            streakLenInput.setValue(draft.streakLength)
            lightOn.setValue(draft.lightEnabled)
            lightColor.setValue(draft.lightColor)
            lightInt.setValue(draft.lightIntensity)
            lightDist.setValue(draft.lightDistance)
            lightning.setValue(draft.lightning)
        } finally {
            syncing = false
        }
    }

    function refreshHeader(): void {
        if (target.kind === 'empty') {
            title.textContent = 'Constructor'
            subtitle.textContent = 'Pick a template or a placed zone to edit.'
            spawnBtn.disabled = true
            saveBtn.disabled = true
            saveAsBtn.disabled = true
            deleteBtn.disabled = true
            root.classList.add('disabled')
            return
        }
        root.classList.remove('disabled')
        if (target.kind === 'template') {
            const t = target.template
            title.textContent = `Template · ${t.label}`
            subtitle.textContent = t.builtin
                ? `Built-in (${t.params.type}). Edits stay local until you click "Save as new".`
                : `Custom (${t.params.type}). Use "Save" to persist changes.`
            spawnBtn.disabled = false
            saveBtn.disabled = t.builtin
            saveAsBtn.disabled = false
            deleteBtn.disabled = t.builtin
        } else {
            const z = target.zone
            title.textContent = `Zone · ${z.runtime.params.name}`
            subtitle.textContent = `Live edits apply instantly. Type: ${z.runtime.params.type}`
            spawnBtn.disabled = false  // spawn = duplicate at target
            saveBtn.disabled = true     // zones don't get "saved"
            saveAsBtn.disabled = false
            deleteBtn.disabled = false
        }
    }

    function setTarget(next: ConstructorTarget): void {
        target = next
        if (next.kind === 'empty') {
            draft = emptyParams()
        } else if (next.kind === 'template') {
            draft = cloneParams(next.template.params)
            draft.name = next.template.label
        } else {
            draft = cloneParams(next.zone.runtime.params)
            draft.id = next.zone.runtime.params.id
        }
        pushForm()
        refreshHeader()
    }

    function refresh(): void {
        if (target.kind === 'zone') {
            draft = cloneParams(target.zone.runtime.params)
            draft.id = target.zone.runtime.params.id
            pushForm()
        }
        refreshHeader()
    }

    refreshHeader()

    return {
        element: root,
        setTarget,
        refresh,
        draft: () => cloneParams(draft),
    }
}

function parseFloatSafe(s: string, fallback: number): number {
    const v = parseFloat(s)
    return Number.isFinite(v) ? v : fallback
}

function parseIntSafe(s: string, fallback: number): number {
    const v = parseInt(s, 10)
    return Number.isFinite(v) ? v : fallback
}

function emptyParams(): WeatherZoneParams {
    return {
        name: 'Effect',
        type: 'rain',
        position: { x: 0, y: 0, z: 0 },
        size: { x: 10, y: 6, z: 10 },
        color: '#ffffff',
        count: 1000,
        particleSize: 0.2,
        opacity: 0.8,
        speed: 1,
        turbulence: 1,
        windX: 0,
        windZ: 0,
        gravity: 0,
        lifetime: 4,
        streaks: false,
        streakLength: 0.5,
        lightEnabled: false,
        lightColor: '#ffffff',
        lightIntensity: 1,
        lightDistance: 16,
        lightning: false,
    }
}

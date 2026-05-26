import type { AudioAsset } from '../../engine/audio'
import { WEATHER_PRESETS } from '../../engine/fx/presets/weather-presets'
import { DAY_CYCLE_PRESET_HOURS, formatHourLabel } from '../../engine/fx/core/day-cycle'
import { GAME_AUDIO_MANIFEST } from '../../game/audio'
import {
    type AmbientWeatherStateSnapshot,
    type EditorEnvironmentMode,
    type EditorState,
} from '../editor-state'
import { sectionEl } from './common'

interface BuiltSection {
    element: HTMLElement
    refresh: () => void
}

interface AmbientFieldGroup {
    refresh: () => void
}

const SOURCE_ASSETS: readonly AudioAsset[] = GAME_AUDIO_MANIFEST.sounds ?? []
const MUSIC_ASSETS: readonly AudioAsset[] = GAME_AUDIO_MANIFEST.music ?? []
const ENVIRONMENT_ASSETS: readonly AudioAsset[] = [...SOURCE_ASSETS, ...MUSIC_ASSETS]
const AMBIENT_PRESET_IDS: readonly string[] = Object.keys(WEATHER_PRESETS)

export function buildEnvironmentAudioSection(state: EditorState): BuiltSection {
    const section = sectionEl('Environment audio')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Level-wide stereo bed. Use local sound sources and sound zones for positional audio.'
    section.appendChild(hint)

    const envSelect = environmentSelectField(state.environment.soundId, (id) => {
        state.environment.soundId = id
    })
    section.appendChild(envSelect.row)

    const envVol = numberField('Volume:', state.environment.volume, 0, 1, 0.05, (v) => {
        state.environment.volume = v
    })
    section.appendChild(envVol.row)

    return {
        element: section,
        refresh() {
            envSelect.input.value = state.environment.soundId ?? ''
            envVol.input.value = String(state.environment.volume)
        },
    }
}

/**
 * Visual-environment editor panel. Three-mode model:
 *   - Outdoor → day-cycle table drives sky/fog/sun/ambient. Author picks
 *     a time + (optional) a weather preset; per-field overrides are
 *     under collapsible "advanced" sections.
 *   - Indoor → no sun, no sky dome. Author tunes ambient + fog colour;
 *     emissive blocks ("FX (emissive + block light)" in the palette) are
 *     the primary illumination.
 *   - Custom → freeform per-field colour fields, the pre-cycle behaviour.
 */
export function buildGlobalVisualEnvironmentSection(state: EditorState): BuiltSection {
    const section = sectionEl('Visual environment')

    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Pick a mode; outdoor uses an automatic day-cycle palette.'
    section.appendChild(hint)

    const enabledRow = checkboxField('Enabled', state.ambientWeather.enabled, (checked) => {
        state.ambientWeather.enabled = checked
        sync()
    })
    section.appendChild(enabledRow.row)

    const modeRow = buildModeSelector(() => state.ambientWeather.state.mode, (mode) => {
        state.ambientWeather.state.mode = mode
        sync()
    })
    section.appendChild(modeRow.element)

    const body = document.createElement('div')
    body.style.display = 'flex'
    body.style.flexDirection = 'column'
    body.style.gap = '6px'
    section.appendChild(body)

    const outdoorPanel = buildOutdoorPanel(state)
    const indoorPanel = buildIndoorPanel(state)
    const customPanel = buildCustomPanel(state)
    body.append(outdoorPanel.element, indoorPanel.element, customPanel.element)

    function sync(): void {
        enabledRow.input.checked = state.ambientWeather.enabled
        modeRow.refresh()
        const mode = state.ambientWeather.state.mode
        outdoorPanel.element.style.display = mode === 'outdoor' ? '' : 'none'
        indoorPanel.element.style.display = mode === 'indoor' ? '' : 'none'
        customPanel.element.style.display = mode === 'custom' ? '' : 'none'
        outdoorPanel.refresh()
        indoorPanel.refresh()
        customPanel.refresh()
        const opacity = state.ambientWeather.enabled ? '1' : '0.5'
        modeRow.element.style.opacity = opacity
        body.style.opacity = opacity
    }

    sync()
    return { element: section, refresh: sync }
}

function buildModeSelector(getMode: () => EditorEnvironmentMode, onChange: (mode: EditorEnvironmentMode) => void): {
    element: HTMLElement
    refresh: () => void
} {
    const row = document.createElement('div')
    row.className = 'vpe-row'
    row.style.gap = '4px'
    const buttons: Array<{ mode: EditorEnvironmentMode; btn: HTMLButtonElement }> = []
    const defs: Array<{ mode: EditorEnvironmentMode; label: string; title: string }> = [
        { mode: 'outdoor', label: 'Outdoor', title: 'Auto sky + sun driven by time of day.' },
        { mode: 'indoor', label: 'Indoor', title: 'No sky dome, no sun — use emissive blocks for light.' },
        { mode: 'custom', label: 'Custom', title: 'Freeform colour fields (legacy / stylised levels).' },
    ]
    for (const { mode, label, title } of defs) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = label
        btn.title = title
        btn.onclick = () => {
            if (getMode() === mode) return
            onChange(mode)
            refresh()
        }
        buttons.push({ mode, btn })
        row.appendChild(btn)
    }
    function refresh(): void {
        const current = getMode()
        for (const { mode, btn } of buttons) btn.classList.toggle('active', mode === current)
    }
    refresh()
    return { element: row, refresh }
}

function buildOutdoorPanel(state: EditorState): BuiltSection {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '6px'
    const snap = (): AmbientWeatherStateSnapshot => state.ambientWeather.state

    // ── Timeline scrubber + label ────────────────────────────────────
    const timeRow = document.createElement('div')
    timeRow.className = 'vpe-field'
    const timeLabel = document.createElement('span')
    timeLabel.className = 'vpe-field-label'
    timeLabel.textContent = 'Time:'
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '24'
    slider.step = '0.05'
    slider.style.flex = '1'
    slider.value = String(snap().timeOfDay)
    const readout = document.createElement('span')
    readout.style.fontVariantNumeric = 'tabular-nums'
    readout.style.minWidth = '46px'
    readout.style.textAlign = 'right'
    readout.textContent = formatHourLabel(snap().timeOfDay)
    slider.oninput = () => {
        const t = parseFloat(slider.value)
        if (!Number.isFinite(t)) return
        snap().timeOfDay = t
        readout.textContent = formatHourLabel(t)
        syncPresetHighlight()
    }
    timeRow.append(timeLabel, slider, readout)
    root.appendChild(timeRow)

    // ── Preset chips ─────────────────────────────────────────────────
    const chipRow = document.createElement('div')
    chipRow.className = 'vpe-row'
    chipRow.style.flexWrap = 'wrap'
    chipRow.style.gap = '4px'
    const chips: Array<{ hour: number; btn: HTMLButtonElement }> = []
    for (const preset of DAY_CYCLE_PRESET_HOURS) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = preset.label
        btn.title = `Jump to ${preset.label} (${formatHourLabel(preset.hour)})`
        btn.onclick = () => {
            snap().timeOfDay = preset.hour
            slider.value = String(preset.hour)
            readout.textContent = formatHourLabel(preset.hour)
            syncPresetHighlight()
        }
        chips.push({ hour: preset.hour, btn })
        chipRow.appendChild(btn)
    }
    root.appendChild(chipRow)

    function syncPresetHighlight(): void {
        const t = snap().timeOfDay
        for (const { hour, btn } of chips) {
            const dist = Math.min(Math.abs(t - hour), 24 - Math.abs(t - hour))
            btn.classList.toggle('active', dist < 0.25)
        }
    }
    syncPresetHighlight()

    // ── Animate cycle ────────────────────────────────────────────────
    const animateRow = document.createElement('div')
    animateRow.className = 'vpe-row'
    animateRow.style.gap = '8px'
    const animateField = checkboxField('Animate cycle', snap().cycleEnabled, (checked) => {
        snap().cycleEnabled = checked
    })
    const cycleNum = numberField('Cycle s:', snap().cycleSeconds, 5, 7200, 5, (v) => {
        snap().cycleSeconds = v
    })
    animateRow.append(animateField.row, cycleNum.row)
    root.appendChild(animateRow)

    // ── Sun direction (azimuth) ──────────────────────────────────────
    const azimuthRow = document.createElement('div')
    azimuthRow.className = 'vpe-row'
    const azimuth = numberField('Sun azimuth:', snap().sunAzimuth, 0, 360, 5, (v) => {
        snap().sunAzimuth = v
    })
    azimuthRow.append(azimuth.row)
    root.appendChild(azimuthRow)

    // ── Collapsible: atmosphere overrides ────────────────────────────
    const overrides = buildCollapsible('Atmosphere overrides', (host) => {
        const fields: Array<{ refresh: () => void }> = []
        fields.push(numberFieldR('Sun ×:', () => snap().sunIntensityMul, (v) => { snap().sunIntensityMul = v }, 0, 4, 0.05, host))
        fields.push(numberFieldR('Fog ×:', () => snap().fogDensityMul, (v) => { snap().fogDensityMul = v }, 0, 4, 0.05, host))
        const tintColor = colorTintField('Sky tint:', () => snap().skyTint, (rgb) => { snap().skyTint = rgb }, host)
        fields.push(tintColor)
        fields.push(numberFieldR('Cloud cover:', () => snap().cloudCoverage, (v) => { snap().cloudCoverage = v }, 0, 1, 0.05, host))
        return fields
    })
    root.appendChild(overrides.element)

    // ── Collapsible: weather presets (legacy) ────────────────────────
    const weatherPresets = buildCollapsible('Weather preset', (host) => {
        const gallery = document.createElement('div')
        gallery.className = 'vpe-row'
        gallery.style.flexWrap = 'wrap'
        const presetButtons: Array<{ id: string; btn: HTMLButtonElement }> = []
        for (const id of AMBIENT_PRESET_IDS) {
            const preset = WEATHER_PRESETS[id]!
            const btn = document.createElement('button')
            btn.className = 'vpe-button'
            btn.textContent = `${preset.icon ?? ''} ${preset.label}`.trim()
            btn.title = `Apply ${preset.label} weather (overrides time-derived sky + adds rain/snow if set)`
            btn.onclick = () => {
                state.ambientWeather.presetId = id
                // Layer the preset on top of the current snapshot so mode +
                // cycle settings survive. Presets cover sky/sun/fog +
                // weather toggles; everything else (mode, animation, tints)
                // stays as-authored.
                Object.assign(snap(), preset.apply)
            }
            presetButtons.push({ id, btn })
            gallery.appendChild(btn)
        }
        host.appendChild(gallery)
        return [{
            refresh() {
                for (const { id, btn } of presetButtons) {
                    btn.classList.toggle('active', id === state.ambientWeather.presetId)
                }
            },
        }]
    })
    root.appendChild(weatherPresets.element)

    // ── Collapsible: weather details ─────────────────────────────────
    const weatherDetails = buildCollapsible('Rain / snow / lightning', (host) => {
        const fields: Array<{ refresh: () => void }> = []
        fields.push(toggleField('Rain on:', () => snap().rainOn, (v) => { snap().rainOn = v }, host))
        fields.push(numberFieldR('Rain count:', () => snap().rainCount, (v) => { snap().rainCount = v }, 0, 12000, 100, host))
        fields.push(numberFieldR('Rain speed:', () => snap().rainSpeed, (v) => { snap().rainSpeed = v }, 0, 60, 0.5, host))
        fields.push(numberFieldR('Rain alpha:', () => snap().rainOpacity, (v) => { snap().rainOpacity = v }, 0, 1, 0.05, host))
        fields.push(colorField('Rain col:', () => snap().rainColor, (v) => { snap().rainColor = v }, host))
        fields.push(toggleField('Snow on:', () => snap().snowOn, (v) => { snap().snowOn = v }, host))
        fields.push(numberFieldR('Snow count:', () => snap().snowCount, (v) => { snap().snowCount = v }, 0, 8000, 100, host))
        fields.push(numberFieldR('Snow speed:', () => snap().snowSpeed, (v) => { snap().snowSpeed = v }, 0, 6, 0.05, host))
        fields.push(numberFieldR('Snow sway:', () => snap().snowSway, (v) => { snap().snowSway = v }, 0, 3, 0.05, host))
        fields.push(numberFieldR('Snow alpha:', () => snap().snowOpacity, (v) => { snap().snowOpacity = v }, 0, 1, 0.05, host))
        fields.push(toggleField('Lightning on:', () => snap().lightningOn, (v) => { snap().lightningOn = v }, host))
        fields.push(numberFieldR('Bolts /s:', () => snap().lightningRate, (v) => { snap().lightningRate = v }, 0, 5, 0.05, host))
        fields.push(numberFieldR('Flash int:', () => snap().lightningIntensity, (v) => { snap().lightningIntensity = v }, 0, 80, 1, host))
        fields.push(colorField('Bolt col:', () => snap().lightningColor, (v) => { snap().lightningColor = v }, host))
        return fields
    })
    root.appendChild(weatherDetails.element)

    // ── Collapsible: wind ────────────────────────────────────────────
    const wind = buildCollapsible('Wind', (host) => {
        const fields: Array<{ refresh: () => void }> = []
        fields.push(numberFieldR('Wind X:', () => snap().windX, (v) => { snap().windX = v }, -10, 10, 0.1, host))
        fields.push(numberFieldR('Wind Z:', () => snap().windZ, (v) => { snap().windZ = v }, -10, 10, 0.1, host))
        fields.push(numberFieldR('Gusts:', () => snap().windGusts, (v) => { snap().windGusts = v }, 0, 2, 0.05, host))
        return fields
    })
    root.appendChild(wind.element)

    function refresh(): void {
        slider.value = String(snap().timeOfDay)
        readout.textContent = formatHourLabel(snap().timeOfDay)
        animateField.input.checked = snap().cycleEnabled
        cycleNum.input.value = String(snap().cycleSeconds)
        azimuth.input.value = String(snap().sunAzimuth)
        syncPresetHighlight()
        overrides.refresh()
        weatherPresets.refresh()
        weatherDetails.refresh()
        wind.refresh()
    }

    return { element: root, refresh }
}

function buildIndoorPanel(state: EditorState): BuiltSection {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '4px'
    const snap = (): AmbientWeatherStateSnapshot => state.ambientWeather.state

    const note = document.createElement('div')
    note.className = 'vpe-hint'
    note.textContent = 'No sky, no sun. Use palette → FX (emissive + block light) for illumination.'
    note.style.color = 'rgba(255, 214, 240, 0.7)'
    root.appendChild(note)

    const fields: Array<{ refresh: () => void }> = []
    fields.push(colorField('Ambient:', () => snap().ambientColor, (v) => { snap().ambientColor = v }, root))
    fields.push(numberFieldR('Amb int:', () => snap().ambientIntensity, (v) => { snap().ambientIntensity = v }, 0, 3, 0.05, root))
    fields.push(colorField('Fog:', () => snap().fogColor, (v) => { snap().fogColor = v }, root))
    fields.push(numberFieldR('Fog density:', () => snap().fogDensity, (v) => { snap().fogDensity = v }, 0, 0.08, 0.001, root))

    return {
        element: root,
        refresh() { for (const f of fields) f.refresh() },
    }
}

function buildCustomPanel(state: EditorState): BuiltSection {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '4px'

    const note = document.createElement('div')
    note.className = 'vpe-hint'
    note.textContent = 'Legacy freeform fields (every colour is read literally; time-of-day only moves the sun).'
    note.style.color = 'rgba(255, 214, 240, 0.7)'
    root.appendChild(note)

    const ambientFields = buildAmbientFields(state, root)
    return { element: root, refresh: ambientFields.refresh }
}

function buildCollapsible(title: string, build: (host: HTMLElement) => Array<{ refresh: () => void }>): {
    element: HTMLElement
    refresh: () => void
} {
    const details = document.createElement('details')
    details.style.borderTop = '1px solid rgba(238, 246, 242, 0.12)'
    details.style.paddingTop = '4px'
    const summary = document.createElement('summary')
    summary.textContent = title
    summary.style.cursor = 'pointer'
    summary.style.color = 'rgba(255, 214, 240, 0.65)'
    summary.style.fontSize = '12px'
    summary.style.userSelect = 'none'
    details.appendChild(summary)
    const host = document.createElement('div')
    host.style.display = 'flex'
    host.style.flexDirection = 'column'
    host.style.gap = '2px'
    host.style.marginTop = '4px'
    details.appendChild(host)
    const fields = build(host)
    return {
        element: details,
        refresh() { for (const f of fields) f.refresh() },
    }
}

function colorTintField(
    labelText: string,
    get: () => [number, number, number],
    set: (rgb: [number, number, number]) => void,
    parent: HTMLElement,
): { refresh: () => void } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    const input = document.createElement('input')
    input.type = 'color'
    input.value = rgbToHex(get())
    input.oninput = () => set(hexToRgb(input.value))
    row.append(label, input)
    parent.appendChild(row)
    return { refresh: () => { input.value = rgbToHex(get()) } }
}

function rgbToHex(rgb: [number, number, number]): string {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0')
    return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`
}

function hexToRgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) return [1, 1, 1]
    const v = m[1]!
    return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255]
}

function buildAmbientFields(state: EditorState, parent: HTMLElement): AmbientFieldGroup {
    const fields: Array<{ refresh: () => void }> = []
    const snapshot = (): AmbientWeatherStateSnapshot => state.ambientWeather.state

    addGroup(parent, 'Sky / fog', (host) => {
        fields.push(colorField('Sky top:', () => snapshot().skyTop, (v) => { snapshot().skyTop = v }, host))
        fields.push(colorField('Sky bottom:', () => snapshot().skyBottom, (v) => { snapshot().skyBottom = v }, host))
        fields.push(colorField('Fog:', () => snapshot().fogColor, (v) => { snapshot().fogColor = v }, host))
        fields.push(numberFieldR('Fog density:', () => snapshot().fogDensity, (v) => { snapshot().fogDensity = v }, 0, 0.08, 0.001, host))
        fields.push(numberFieldR('Cloud cover:', () => snapshot().cloudCoverage, (v) => { snapshot().cloudCoverage = v }, 0, 1, 0.05, host))
    })

    addGroup(parent, 'Sun & light', (host) => {
        fields.push(colorField('Sun:', () => snapshot().sunColor, (v) => { snapshot().sunColor = v }, host))
        fields.push(numberFieldR('Sun int:', () => snapshot().sunIntensity, (v) => { snapshot().sunIntensity = v }, 0, 5, 0.05, host))
        fields.push(colorField('Ambient:', () => snapshot().ambientColor, (v) => { snapshot().ambientColor = v }, host))
        fields.push(numberFieldR('Amb int:', () => snapshot().ambientIntensity, (v) => { snapshot().ambientIntensity = v }, 0, 3, 0.05, host))
        fields.push(numberFieldR('Time of day:', () => snapshot().timeOfDay, (v) => { snapshot().timeOfDay = v }, 0, 24, 0.5, host))
        fields.push(numberFieldR('Sun azimuth:', () => snapshot().sunAzimuth, (v) => { snapshot().sunAzimuth = v }, 0, 360, 5, host))
    })

    addGroup(parent, 'Wind & lightning', (host) => {
        fields.push(numberFieldR('Wind X:', () => snapshot().windX, (v) => { snapshot().windX = v }, -10, 10, 0.1, host))
        fields.push(numberFieldR('Wind Z:', () => snapshot().windZ, (v) => { snapshot().windZ = v }, -10, 10, 0.1, host))
        fields.push(numberFieldR('Gusts:', () => snapshot().windGusts, (v) => { snapshot().windGusts = v }, 0, 2, 0.05, host))
        fields.push(toggleField('Lightning on:', () => snapshot().lightningOn, (v) => { snapshot().lightningOn = v }, host))
        fields.push(numberFieldR('Bolts /s:', () => snapshot().lightningRate, (v) => { snapshot().lightningRate = v }, 0, 5, 0.05, host))
        fields.push(numberFieldR('Flash int:', () => snapshot().lightningIntensity, (v) => { snapshot().lightningIntensity = v }, 0, 80, 1, host))
        fields.push(colorField('Bolt col:', () => snapshot().lightningColor, (v) => { snapshot().lightningColor = v }, host))
    })

    addGroup(parent, 'Rain & snow', (host) => {
        fields.push(toggleField('Rain on:', () => snapshot().rainOn, (v) => { snapshot().rainOn = v }, host))
        fields.push(numberFieldR('Rain count:', () => snapshot().rainCount, (v) => { snapshot().rainCount = v }, 0, 12000, 100, host))
        fields.push(numberFieldR('Rain speed:', () => snapshot().rainSpeed, (v) => { snapshot().rainSpeed = v }, 0, 60, 0.5, host))
        fields.push(numberFieldR('Rain alpha:', () => snapshot().rainOpacity, (v) => { snapshot().rainOpacity = v }, 0, 1, 0.05, host))
        fields.push(colorField('Rain col:', () => snapshot().rainColor, (v) => { snapshot().rainColor = v }, host))
        fields.push(toggleField('Snow on:', () => snapshot().snowOn, (v) => { snapshot().snowOn = v }, host))
        fields.push(numberFieldR('Snow count:', () => snapshot().snowCount, (v) => { snapshot().snowCount = v }, 0, 8000, 100, host))
        fields.push(numberFieldR('Snow speed:', () => snapshot().snowSpeed, (v) => { snapshot().snowSpeed = v }, 0, 6, 0.05, host))
        fields.push(numberFieldR('Snow sway:', () => snapshot().snowSway, (v) => { snapshot().snowSway = v }, 0, 3, 0.05, host))
        fields.push(numberFieldR('Snow alpha:', () => snapshot().snowOpacity, (v) => { snapshot().snowOpacity = v }, 0, 1, 0.05, host))
    })

    return {
        refresh() {
            for (const field of fields) field.refresh()
        },
    }
}

function addGroup(parent: HTMLElement, label: string, build: (host: HTMLElement) => void): void {
    const heading = document.createElement('div')
    heading.className = 'vpe-hint'
    heading.style.marginTop = '4px'
    heading.style.color = 'rgba(255, 214, 240, 0.65)'
    heading.textContent = label
    parent.appendChild(heading)
    const host = document.createElement('div')
    host.style.display = 'flex'
    host.style.flexDirection = 'column'
    host.style.gap = '2px'
    parent.appendChild(host)
    build(host)
}

function environmentSelectField(
    initial: string | null,
    onChange: (id: string | null) => void,
): { row: HTMLElement; input: HTMLSelectElement } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = 'Track:'
    const input = document.createElement('select')
    input.className = 'vpe-input'
    input.style.flex = '2'
    const none = document.createElement('option')
    none.value = ''
    none.textContent = '(none)'
    input.appendChild(none)
    for (const asset of ENVIRONMENT_ASSETS) {
        const option = document.createElement('option')
        option.value = asset.id
        option.textContent = formatAssetName(asset)
        input.appendChild(option)
    }
    input.value = initial ?? ''
    input.onchange = () => { onChange(input.value ? input.value : null) }
    row.append(label, input)
    return { row, input }
}

function numberField(
    labelText: string,
    initial: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(initial)
    input.style.width = '66px'
    input.oninput = () => {
        const value = step % 1 === 0 ? parseInt(input.value, 10) : parseFloat(input.value)
        if (Number.isFinite(value)) onChange(Math.max(min, Math.min(max, value)))
    }
    row.append(label, input)
    return { row, input }
}

function checkboxField(
    labelText: string,
    initial: boolean,
    onChange: (checked: boolean) => void,
): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    row.style.cursor = 'pointer'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = initial
    input.onchange = () => onChange(input.checked)
    const span = document.createElement('span')
    span.textContent = labelText
    row.append(span, input)
    return { row, input }
}

function colorField(
    labelText: string,
    get: () => string,
    set: (value: string) => void,
    parent: HTMLElement,
): { refresh: () => void } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    const input = document.createElement('input')
    input.type = 'color'
    input.value = get()
    input.oninput = () => set(input.value)
    row.append(label, input)
    parent.appendChild(row)
    return { refresh: () => { input.value = get() } }
}

function numberFieldR(
    labelText: string,
    get: () => number,
    set: (value: number) => void,
    min: number,
    max: number,
    step: number,
    parent: HTMLElement,
): { refresh: () => void } {
    const field = numberField(labelText, get(), min, max, step, set)
    parent.appendChild(field.row)
    return { refresh: () => { field.input.value = String(get()) } }
}

function toggleField(
    labelText: string,
    get: () => boolean,
    set: (value: boolean) => void,
    parent: HTMLElement,
): { refresh: () => void } {
    const field = checkboxField(labelText, get(), set)
    parent.appendChild(field.row)
    return { refresh: () => { field.input.checked = get() } }
}

function formatAssetName(asset: AudioAsset): string {
    const type = MUSIC_ASSETS.includes(asset) ? 'music' : asset.loop ? 'loop' : 'shot'
    return `${asset.id} (${type})`
}

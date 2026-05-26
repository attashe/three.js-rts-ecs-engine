import type { AudioAsset } from '../../engine/audio'
import { WEATHER_PRESETS } from '../../engine/fx/presets/weather-presets'
import { GAME_AUDIO_MANIFEST } from '../../game/audio'
import {
    DEFAULT_AMBIENT_WEATHER,
    type AmbientWeatherStateSnapshot,
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

export function buildGlobalVisualEnvironmentSection(state: EditorState): BuiltSection {
    const section = sectionEl('Visual environment')
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Level-wide sky, fog, sun, clouds, rain, snow, wind and lightning.'
    section.appendChild(hint)

    const enabledRow = checkboxField('Enabled', state.ambientWeather.enabled, (checked) => {
        state.ambientWeather.enabled = checked
        syncAmbientPanel()
    })
    section.appendChild(enabledRow.row)

    const presetGallery = document.createElement('div')
    presetGallery.className = 'vpe-row'
    presetGallery.style.flexWrap = 'wrap'
    for (const id of AMBIENT_PRESET_IDS) {
        const preset = WEATHER_PRESETS[id]!
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.dataset.presetId = id
        btn.textContent = `${preset.icon ?? ''} ${preset.label}`.trim()
        btn.title = `Apply ${preset.label} environment preset`
        btn.onclick = () => {
            state.ambientWeather.enabled = true
            state.ambientWeather.presetId = id
            state.ambientWeather.state = { ...DEFAULT_AMBIENT_WEATHER, ...preset.apply } as AmbientWeatherStateSnapshot
            syncAmbientPanel()
        }
        presetGallery.appendChild(btn)
    }
    section.appendChild(presetGallery)

    const ambientBody = document.createElement('div')
    ambientBody.style.display = 'flex'
    ambientBody.style.flexDirection = 'column'
    ambientBody.style.gap = '4px'
    section.appendChild(ambientBody)
    const ambientFields = buildAmbientFields(state, ambientBody)

    function syncAmbientPanel(): void {
        enabledRow.input.checked = state.ambientWeather.enabled
        for (const btn of presetGallery.querySelectorAll<HTMLButtonElement>('button')) {
            btn.classList.toggle('active', btn.dataset.presetId === state.ambientWeather.presetId)
        }
        ambientFields.refresh()
        const opacity = state.ambientWeather.enabled ? '1' : '0.5'
        presetGallery.style.opacity = opacity
        ambientBody.style.opacity = opacity
    }

    syncAmbientPanel()
    return { element: section, refresh: syncAmbientPanel }
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

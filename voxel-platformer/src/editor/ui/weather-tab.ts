import { ZONE_PRESETS } from '../../engine/fx/presets/zone-presets'
import { WEATHER_PRESETS } from '../../engine/fx/presets/weather-presets'
import { GAME_AUDIO_MANIFEST } from '../../game/audio'
import { defaultSoundForPreset } from '../../game/weather-config'
import {
    DEFAULT_AMBIENT_WEATHER,
    type AmbientWeatherStateSnapshot,
    type EditorState,
} from '../editor-state'
import { formatCoord, sectionEl, trimForList, type RefreshableElement } from './common'

export interface WeatherTabContext {
    editorState: EditorState
}

const ZONE_PRESET_IDS: readonly string[] = Object.keys(ZONE_PRESETS)
const AMBIENT_PRESET_IDS: readonly string[] = Object.keys(WEATHER_PRESETS)
// Override dropdown only lists ambient-bed assets — pairing a fire
// zone with a footstep loop is almost certainly a mistake, so we
// filter to ids prefixed `sfx.amb.` (the manifest's "ambient loops"
// group). The author can still tune the bed via `soundVolume`.
const SOURCE_SOUND_IDS: readonly string[] = (GAME_AUDIO_MANIFEST.sounds ?? [])
    .filter((a) => a.id.startsWith('sfx.amb.'))
    .map((a) => a.id)

/**
 * Weather tab — three sections:
 *
 *  1. **Ambient weather** — preset picker (LUT-style gallery) plus the
 *     full set of `AmbientWeatherState` knobs. Enable/disable toggle.
 *  2. **Weather zone placement** — pick a zone preset, size, paired
 *     sound. "Add sound" defaults on; the runtime auto-picks a
 *     matching ambient bed unless the override is set.
 *  3. **Placed zones** — list of authored zones with select/remove.
 *
 * Same UI vocabulary as the Sound tab so users only learn the pattern
 * once. Refresh re-syncs draft inputs when state changes outside the
 * tab (e.g. preset reset).
 */
export function buildWeatherTab(ctx: WeatherTabContext): RefreshableElement {
    const state = ctx.editorState

    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // ── Ambient weather ──────────────────────────────────────────────
    const ambientSection = sectionEl('Ambient weather')
    const ambientHint = document.createElement('div')
    ambientHint.className = 'vpe-hint'
    ambientHint.textContent = 'Level-wide sky / fog / sun / drifting rain & snow. Pick a preset, then tweak any knob.'
    ambientSection.appendChild(ambientHint)

    const enabledRow = checkboxField('Enabled', state.ambientWeather.enabled, (checked) => {
        state.ambientWeather.enabled = checked
        syncAmbientPanel()
    })
    ambientSection.appendChild(enabledRow.row)

    const presetGallery = document.createElement('div')
    presetGallery.className = 'vpe-row'
    presetGallery.style.flexWrap = 'wrap'
    for (const id of AMBIENT_PRESET_IDS) {
        const preset = WEATHER_PRESETS[id]!
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.dataset.presetId = id
        btn.textContent = `${preset.icon ?? ''} ${preset.label}`.trim()
        btn.title = `Apply ${preset.label} preset`
        btn.onclick = () => {
            state.ambientWeather.presetId = id
            // Apply preset on top of defaults so every field has a
            // definitive value (presets are partial). Future edits
            // sit on top of the resolved snapshot.
            state.ambientWeather.state = { ...DEFAULT_AMBIENT_WEATHER, ...preset.apply } as AmbientWeatherStateSnapshot
            syncAmbientPanel()
        }
        presetGallery.appendChild(btn)
    }
    ambientSection.appendChild(presetGallery)

    const ambientBody = document.createElement('div')
    ambientBody.style.display = 'flex'
    ambientBody.style.flexDirection = 'column'
    ambientBody.style.gap = '4px'
    ambientSection.appendChild(ambientBody)
    const ambientFields = buildAmbientFields(state, ambientBody)
    root.appendChild(ambientSection)

    // ── Weather zone placement ───────────────────────────────────────
    const zoneSection = sectionEl('Weather zone')
    const zoneHint = document.createElement('div')
    zoneHint.className = 'vpe-hint'
    zoneHint.textContent = 'Particle FX volume — placed on the working plane, centred on the cursor cell.'
    zoneSection.appendChild(zoneHint)

    const presetSelect = selectField('Preset:', state.weatherPresetId, ZONE_PRESET_IDS.map((id) => ({
        value: id,
        label: ZONE_PRESETS[id]!.label,
    })), (id) => {
        state.weatherPresetId = id
        // Seed the next-zone size from the preset so place defaults look
        // right per-preset (a bonfire is small, storm is huge).
        const presetSize = ZONE_PRESETS[id]!.params.size
        if (presetSize) {
            state.weatherZoneSize = Math.max(1, Math.round(presetSize.x))
            state.weatherZoneHeight = Math.max(1, Math.round(presetSize.y))
        }
        // Reset the override so the next zone picks the new preset's
        // default paired sound (unless the user re-enters an override
        // after switching).
        state.weatherZoneSoundId = ''
        syncZonePanel()
    })
    zoneSection.appendChild(presetSelect.row)

    const zoneLabel = textField('Label:', state.weatherZoneLabel, '(optional)', (value) => {
        state.weatherZoneLabel = value
    })
    zoneSection.appendChild(zoneLabel.row)

    const zoneSizeXZ = numberField('XZ size:', state.weatherZoneSize, 1, 64, 1, (value) => {
        state.weatherZoneSize = value
    })
    zoneSection.appendChild(zoneSizeXZ.row)

    const zoneSizeY = numberField('Y size:', state.weatherZoneHeight, 1, 32, 1, (value) => {
        state.weatherZoneHeight = value
    })
    zoneSection.appendChild(zoneSizeY.row)

    const addSound = checkboxField('Add sound', state.weatherZoneAddSound, (checked) => {
        state.weatherZoneAddSound = checked
        syncZonePanel()
    })
    zoneSection.appendChild(addSound.row)

    const soundOverride = selectField('Sound:', state.weatherZoneSoundId, [
        { value: '', label: 'Auto (preset default)' },
        ...SOURCE_SOUND_IDS.map((id) => ({ value: id, label: id })),
    ], (id) => {
        state.weatherZoneSoundId = id
    })
    zoneSection.appendChild(soundOverride.row)

    const soundVol = numberField('Volume:', state.weatherZoneSoundVolume, 0, 1, 0.05, (value) => {
        state.weatherZoneSoundVolume = value
    })
    zoneSection.appendChild(soundVol.row)

    const placeBtn = document.createElement('button')
    placeBtn.className = 'vpe-button'
    placeBtn.textContent = 'Place weather zone'
    placeBtn.onclick = () => {
        state.selectedWeatherZoneId = null
        state.mode = 'place-weather'
        syncPlaceButton()
    }
    zoneSection.appendChild(placeBtn)
    root.appendChild(zoneSection)

    // ── Placed zones list ────────────────────────────────────────────
    const listSection = sectionEl('Placed weather zones')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    let listFingerprint = ''

    function syncPlaceButton(): void {
        placeBtn.classList.toggle('active', state.mode === 'place-weather')
        placeBtn.textContent = state.mode === 'place-weather' ? 'Placing weather zone' : 'Place weather zone'
    }

    function syncZonePanel(): void {
        presetSelect.input.value = state.weatherPresetId
        zoneLabel.input.value = state.weatherZoneLabel
        zoneSizeXZ.input.value = String(state.weatherZoneSize)
        zoneSizeY.input.value = String(state.weatherZoneHeight)
        addSound.input.checked = state.weatherZoneAddSound
        soundOverride.input.value = state.weatherZoneSoundId
        soundVol.input.value = String(state.weatherZoneSoundVolume)
        // Grey out the sound override when "Add sound" is off so the
        // disabled state matches behaviour.
        soundOverride.input.disabled = !state.weatherZoneAddSound
        soundVol.input.disabled = !state.weatherZoneAddSound

        // Update the placeholder for the default sound when the preset
        // changes — purely cosmetic but helps the user see what they'd
        // get without overriding.
        const auto = defaultSoundForPreset(state.weatherPresetId)
        const opts = soundOverride.input.options
        if (opts.length > 0 && opts[0]) {
            opts[0].textContent = auto
                ? `Auto (${auto})`
                : 'Auto (none — preset has no default)'
        }
    }

    function syncAmbientPanel(): void {
        enabledRow.input.checked = state.ambientWeather.enabled
        for (const btn of presetGallery.querySelectorAll<HTMLButtonElement>('button')) {
            btn.classList.toggle('active', btn.dataset.presetId === state.ambientWeather.presetId)
        }
        ambientFields.refresh()
        // Disable the gallery + fields when the ambient is off so the
        // user knows they're inert. We don't actually disable buttons —
        // pressing a preset both auto-enables and applies, which is
        // less surprising than "click does nothing".
        const dim = state.ambientWeather.enabled ? '1' : '0.5'
        presetGallery.style.opacity = dim
        ambientBody.style.opacity = dim
    }

    function renderList(): void {
        const fp = state.weatherZones
            .map((z) => `${z.id}|${z.presetId}|${z.label ?? ''}|${z.position.x},${z.position.y},${z.position.z}|${z.size.x},${z.size.y},${z.size.z}|${z.addSound}|${z.soundId ?? ''}|${z.soundVolume}`)
            .join('||') + `::${state.selectedWeatherZoneId ?? ''}`
        if (fp === listFingerprint) return
        listFingerprint = fp
        list.innerHTML = ''
        if (state.weatherZones.length === 0) {
            const empty = document.createElement('span')
            empty.className = 'vpe-list-empty'
            empty.textContent = 'No weather zones placed yet.'
            list.appendChild(empty)
            return
        }
        for (const zone of state.weatherZones) {
            const row = document.createElement('div')
            row.className = 'vpe-list-item'
            if (zone.id === state.selectedWeatherZoneId) row.style.color = '#ffd166'
            const span = document.createElement('span')
            span.textContent = `${zone.label ? trimForList(zone.label) : zone.id} · ${zone.presetId} · ${formatCoord({
                x: round(zone.position.x), y: round(zone.position.y), z: round(zone.position.z),
            })}`
            span.title = `${zone.presetId} ${zone.size.x}×${zone.size.y}×${zone.size.z}`
            const controls = document.createElement('span')
            controls.style.display = 'flex'
            controls.style.gap = '2px'
            const selectBtn = document.createElement('button')
            selectBtn.textContent = 'select'
            selectBtn.onclick = () => {
                state.selectedWeatherZoneId = zone.id
                listFingerprint = ''
                renderList()
            }
            const removeBtn = document.createElement('button')
            removeBtn.textContent = 'remove'
            removeBtn.onclick = () => {
                const i = state.weatherZones.indexOf(zone)
                if (i >= 0) state.weatherZones.splice(i, 1)
                if (state.selectedWeatherZoneId === zone.id) state.selectedWeatherZoneId = null
                listFingerprint = ''
                renderList()
            }
            controls.append(selectBtn, removeBtn)
            row.append(span, controls)
            list.appendChild(row)
        }
    }

    function refresh(): void {
        if (!zoneSection.contains(document.activeElement)) syncZonePanel()
        if (!ambientSection.contains(document.activeElement)) syncAmbientPanel()
        syncPlaceButton()
        renderList()
    }

    syncZonePanel()
    syncAmbientPanel()
    syncPlaceButton()
    renderList()

    return { element: root, refresh }
}

interface AmbientFieldGroup {
    refresh: () => void
}

/**
 * Build the ambient-weather knob grid. Knobs are organised into four
 * mini-sections (sky, sun & light, wind & lightning, drifting weather)
 * so the long form has visual breathing room. The grid is allocated
 * once; `refresh()` re-syncs each input from the snapshot.
 */
function buildAmbientFields(state: EditorState, parent: HTMLElement): AmbientFieldGroup {
    const fields: Array<{ refresh: () => void }> = []
    const snapshot = state.ambientWeather.state

    addGroup(parent, 'Sky / fog', (host) => {
        fields.push(colorField('Sky top:', () => snapshot.skyTop, (v) => { snapshot.skyTop = v }, host))
        fields.push(colorField('Sky bottom:', () => snapshot.skyBottom, (v) => { snapshot.skyBottom = v }, host))
        fields.push(colorField('Fog:', () => snapshot.fogColor, (v) => { snapshot.fogColor = v }, host))
        fields.push(numberFieldR('Fog density:', () => snapshot.fogDensity, (v) => { snapshot.fogDensity = v }, 0, 0.08, 0.001, host))
        fields.push(numberFieldR('Cloud cover:', () => snapshot.cloudCoverage, (v) => { snapshot.cloudCoverage = v }, 0, 1, 0.05, host))
    })

    addGroup(parent, 'Sun & light', (host) => {
        fields.push(colorField('Sun:', () => snapshot.sunColor, (v) => { snapshot.sunColor = v }, host))
        fields.push(numberFieldR('Sun int:', () => snapshot.sunIntensity, (v) => { snapshot.sunIntensity = v }, 0, 5, 0.05, host))
        fields.push(colorField('Ambient:', () => snapshot.ambientColor, (v) => { snapshot.ambientColor = v }, host))
        fields.push(numberFieldR('Amb int:', () => snapshot.ambientIntensity, (v) => { snapshot.ambientIntensity = v }, 0, 3, 0.05, host))
        fields.push(numberFieldR('Time of day:', () => snapshot.timeOfDay, (v) => { snapshot.timeOfDay = v }, 0, 24, 0.5, host))
        fields.push(numberFieldR('Sun azimuth:', () => snapshot.sunAzimuth, (v) => { snapshot.sunAzimuth = v }, 0, 360, 5, host))
    })

    addGroup(parent, 'Wind & lightning', (host) => {
        fields.push(numberFieldR('Wind X:', () => snapshot.windX, (v) => { snapshot.windX = v }, -10, 10, 0.1, host))
        fields.push(numberFieldR('Wind Z:', () => snapshot.windZ, (v) => { snapshot.windZ = v }, -10, 10, 0.1, host))
        fields.push(numberFieldR('Gusts:', () => snapshot.windGusts, (v) => { snapshot.windGusts = v }, 0, 2, 0.05, host))
        fields.push(toggleField('Lightning on:', () => snapshot.lightningOn, (v) => { snapshot.lightningOn = v }, host))
        fields.push(numberFieldR('Bolts /s:', () => snapshot.lightningRate, (v) => { snapshot.lightningRate = v }, 0, 5, 0.05, host))
        fields.push(numberFieldR('Flash int:', () => snapshot.lightningIntensity, (v) => { snapshot.lightningIntensity = v }, 0, 80, 1, host))
        fields.push(colorField('Bolt col:', () => snapshot.lightningColor, (v) => { snapshot.lightningColor = v }, host))
    })

    addGroup(parent, 'Rain & snow (drifting)', (host) => {
        fields.push(toggleField('Rain on:', () => snapshot.rainOn, (v) => { snapshot.rainOn = v }, host))
        fields.push(numberFieldR('Rain count:', () => snapshot.rainCount, (v) => { snapshot.rainCount = v }, 0, 12000, 100, host))
        fields.push(numberFieldR('Rain speed:', () => snapshot.rainSpeed, (v) => { snapshot.rainSpeed = v }, 0, 60, 0.5, host))
        fields.push(numberFieldR('Rain alpha:', () => snapshot.rainOpacity, (v) => { snapshot.rainOpacity = v }, 0, 1, 0.05, host))
        fields.push(colorField('Rain col:', () => snapshot.rainColor, (v) => { snapshot.rainColor = v }, host))
        fields.push(toggleField('Snow on:', () => snapshot.snowOn, (v) => { snapshot.snowOn = v }, host))
        fields.push(numberFieldR('Snow count:', () => snapshot.snowCount, (v) => { snapshot.snowCount = v }, 0, 8000, 100, host))
        fields.push(numberFieldR('Snow speed:', () => snapshot.snowSpeed, (v) => { snapshot.snowSpeed = v }, 0, 6, 0.05, host))
        fields.push(numberFieldR('Snow sway:', () => snapshot.snowSway, (v) => { snapshot.snowSway = v }, 0, 3, 0.05, host))
        fields.push(numberFieldR('Snow alpha:', () => snapshot.snowOpacity, (v) => { snapshot.snowOpacity = v }, 0, 1, 0.05, host))
    })

    return {
        refresh() {
            for (const f of fields) f.refresh()
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

// ── Field helpers (kept local; share style with sound-tab.ts but
// these accept a getter so refresh() can re-read state). ─────────────

function selectField(
    labelText: string,
    initial: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    onChange: (value: string) => void,
): { row: HTMLElement; input: HTMLSelectElement } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    const input = document.createElement('select')
    input.className = 'vpe-input'
    input.style.flex = '2'
    for (const opt of options) {
        const o = document.createElement('option')
        o.value = opt.value
        o.textContent = opt.label
        input.appendChild(o)
    }
    input.value = initial
    input.onchange = () => onChange(input.value)
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

function textField(
    labelText: string,
    initial: string,
    placeholder: string,
    onChange: (value: string) => void,
): { row: HTMLElement; input: HTMLInputElement } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'text'
    input.value = initial
    input.placeholder = placeholder
    input.style.flex = '2'
    input.oninput = () => onChange(input.value)
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
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    row.append(input, label)
    return { row, input }
}

// ── Re-readable variants used by the ambient form — `refresh()`
// re-syncs the displayed value from the snapshot getter. ───────────

function numberFieldR(
    labelText: string,
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    step: number,
    host: HTMLElement,
): { refresh: () => void } {
    const f = numberField(labelText, get(), min, max, step, set)
    host.appendChild(f.row)
    return { refresh() { if (document.activeElement !== f.input) f.input.value = String(get()) } }
}

function colorField(
    labelText: string,
    get: () => string,
    set: (v: string) => void,
    host: HTMLElement,
): { refresh: () => void } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    const input = document.createElement('input')
    input.type = 'color'
    input.value = normalizeHex(get())
    input.style.width = '38px'
    input.style.height = '20px'
    input.style.border = '1px solid rgba(217, 247, 255, 0.25)'
    input.style.background = 'transparent'
    input.style.cursor = 'pointer'
    input.oninput = () => set(input.value)
    row.append(label, input)
    host.appendChild(row)
    return { refresh() { if (document.activeElement !== input) input.value = normalizeHex(get()) } }
}

function toggleField(
    labelText: string,
    get: () => boolean,
    set: (v: boolean) => void,
    host: HTMLElement,
): { refresh: () => void } {
    const f = checkboxField(labelText, get(), set)
    host.appendChild(f.row)
    return { refresh() { f.input.checked = get() } }
}

function round(n: number): number {
    return Math.round(n * 10) / 10
}

function normalizeHex(value: string): string {
    // <input type="color"> wants `#rrggbb` exact. Accept short hex too.
    if (!value) return '#000000'
    if (/^#[0-9a-f]{6}$/i.test(value)) return value
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        return '#' + value.slice(1).split('').map((c) => c + c).join('')
    }
    return '#000000'
}

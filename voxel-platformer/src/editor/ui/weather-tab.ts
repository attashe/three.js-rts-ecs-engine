import { ZONE_PRESETS } from '../../engine/fx/presets/zone-presets'
import { GAME_AUDIO_MANIFEST } from '../../game/audio'
import { defaultSoundForPreset } from '../../game/weather-config'
import type { EditorState } from '../editor-state'
import { formatCoord, sectionEl, trimForList, type RefreshableElement } from './common'

export interface WeatherTabContext {
    editorState: EditorState
}

const ZONE_PRESET_IDS: readonly string[] = Object.keys(ZONE_PRESETS)
// Override dropdown only lists ambient-bed assets — pairing a fire
// zone with a footstep loop is almost certainly a mistake, so we
// filter to ids prefixed `sfx.amb.` (the manifest's "ambient loops"
// group). The author can still tune the bed via `soundVolume`.
const SOURCE_SOUND_IDS: readonly string[] = (GAME_AUDIO_MANIFEST.sounds ?? [])
    .filter((a) => a.id.startsWith('sfx.amb.'))
    .map((a) => a.id)

/**
 * Visual FX tab — local particle/light volumes only. Level-wide sky,
 * fog, sun, rain/snow and environment audio live on the Level tab.
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

    // ── Effect zone placement ────────────────────────────────────────
    const zoneSection = sectionEl('Effect zone')
    const zoneHint = document.createElement('div')
    zoneHint.className = 'vpe-hint'
    zoneHint.textContent = 'Local particle/light volume — placed on the working plane, centred on the cursor cell.'
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
    placeBtn.textContent = 'Place effect zone'
    placeBtn.onclick = () => {
        state.selectedWeatherZoneId = null
        state.mode = 'place-weather'
        syncPlaceButton()
    }
    zoneSection.appendChild(placeBtn)
    root.appendChild(zoneSection)

    // ── Placed zones list ────────────────────────────────────────────
    const listSection = sectionEl('Placed effect zones')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    let listFingerprint = ''

    function syncPlaceButton(): void {
        placeBtn.classList.toggle('active', state.mode === 'place-weather')
        placeBtn.textContent = state.mode === 'place-weather' ? 'Placing effect zone' : 'Place effect zone'
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
            empty.textContent = 'No effect zones placed yet.'
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
        syncPlaceButton()
        renderList()
    }

    syncZonePanel()
    syncPlaceButton()
    renderList()

    return { element: root, refresh }
}

// ── Field helpers ───────────────────────────────────────────────────

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

function round(n: number): number {
    return Math.round(n * 10) / 10
}

import type { AudioAsset } from '../../engine/audio'
import { GAME_AUDIO_MANIFEST, GameAudio } from '../../game/audio'
import type { EditorSoundSource, EditorSoundZone, EditorState } from '../editor-state'
import { formatCoord, sectionEl, trimForList, type RefreshableElement } from './common'

export interface SoundTabContext {
    editorState: EditorState
}

const SOURCE_ASSETS: readonly AudioAsset[] = GAME_AUDIO_MANIFEST.sounds ?? []
const MUSIC_ASSETS: readonly AudioAsset[] = GAME_AUDIO_MANIFEST.music ?? []
/** Pool the Environment dropdown can pick from: sfx + music together
 *  (any stereo asset is a valid level-wide bed). */
const ENVIRONMENT_ASSETS: readonly AudioAsset[] = [...SOURCE_ASSETS, ...MUSIC_ASSETS]

export function buildSoundTab(ctx: SoundTabContext): RefreshableElement {
    const state = ctx.editorState
    ensureValidDefaultSound(state)

    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // ── Environment (level-wide ambient bed) ─────────────────────────
    const envSection = sectionEl('Environment')
    const envHint = document.createElement('div')
    envHint.className = 'vpe-hint'
    envHint.textContent = 'Plays in stereo throughout the level. Leaves the spatial channel for point sources + zones.'
    envSection.appendChild(envHint)

    const envSelect = environmentSelectField(state.environment.soundId, (id) => {
        state.environment.soundId = id
    })
    envSection.appendChild(envSelect.row)

    const envVol = numberField('Volume:', state.environment.volume, 0, 1, 0.05, (v) => {
        state.environment.volume = v
    })
    envSection.appendChild(envVol.row)
    root.appendChild(envSection)

    const placement = sectionEl('Sound source')
    const sourceHint = document.createElement('div')
    sourceHint.className = 'vpe-hint'
    sourceHint.textContent = 'Spatial point emitter. Inner ring = full-volume core; outer ring = inaudible boundary. Autoplay must stay on — non-autoplay sources are inert (nothing triggers them).'
    placement.appendChild(sourceHint)
    const soundSelect = soundSelectField(state.soundSourceSoundId, (id) => {
        state.soundSourceSoundId = id
        const asset = findSourceAsset(id)
        if (asset) state.soundSourceLoop = asset.loop ?? false
        syncPlacementControls()
    })
    placement.appendChild(soundSelect.row)

    const label = textField('Label:', state.soundSourceLabel, '(optional)', (value) => {
        state.soundSourceLabel = value
    })
    placement.appendChild(label.row)

    const radius = numberField('Radius:', state.soundSourceRadius, 0.5, 200, 0.5, (value) => {
        state.soundSourceRadius = value
    })
    placement.appendChild(radius.row)

    const volume = numberField('Volume:', state.soundSourceVolume, 0, 1, 0.05, (value) => {
        state.soundSourceVolume = value
    })
    placement.appendChild(volume.row)

    const toggles = document.createElement('div')
    toggles.className = 'vpe-row'
    const loop = checkboxField('Loop', state.soundSourceLoop, (checked) => {
        state.soundSourceLoop = checked
    })
    const autoplay = checkboxField('Autoplay', state.soundSourceAutoplay, (checked) => {
        state.soundSourceAutoplay = checked
    })
    toggles.append(loop.row, autoplay.row)
    placement.appendChild(toggles)

    const placeBtn = document.createElement('button')
    placeBtn.className = 'vpe-button'
    placeBtn.textContent = 'Place source'
    placeBtn.onclick = () => {
        state.selectedSoundSourceId = null
        state.mode = 'place-sound'
        syncPlaceButton()
        syncZonePlaceButton()
    }
    placement.appendChild(placeBtn)
    root.appendChild(placement)

    // ── Sound zone placement ─────────────────────────────────────────
    const zonePlacement = sectionEl('Sound zone')
    const zoneHint = document.createElement('div')
    zoneHint.className = 'vpe-hint'
    zoneHint.textContent = 'AABB region whose sound fades in while the player is inside, fades out when they leave. Use for biome ambience.'
    zonePlacement.appendChild(zoneHint)
    const zoneSoundSelect = soundSelectField(state.soundZoneSoundId, (id) => {
        state.soundZoneSoundId = id
        syncZonePlacementControls()
    })
    zonePlacement.appendChild(zoneSoundSelect.row)
    const zoneLabel = textField('Label:', state.soundZoneLabel, '(optional)', (v) => { state.soundZoneLabel = v })
    zonePlacement.appendChild(zoneLabel.row)
    const zoneSizeXZ = numberField('XZ size:', state.soundZoneSize, 1, 64, 1, (v) => { state.soundZoneSize = v })
    zonePlacement.appendChild(zoneSizeXZ.row)
    const zoneSizeY = numberField('Y size:', state.soundZoneHeight, 1, 32, 1, (v) => { state.soundZoneHeight = v })
    zonePlacement.appendChild(zoneSizeY.row)
    const zoneVolume = numberField('Volume:', state.soundZoneVolume, 0, 1, 0.05, (v) => { state.soundZoneVolume = v })
    zonePlacement.appendChild(zoneVolume.row)
    const zoneFade = numberField('Fade (s):', state.soundZoneFadeTime, 0, 10, 0.1, (v) => { state.soundZoneFadeTime = v })
    zonePlacement.appendChild(zoneFade.row)
    const placeZoneBtn = document.createElement('button')
    placeZoneBtn.className = 'vpe-button'
    placeZoneBtn.textContent = 'Place zone'
    placeZoneBtn.onclick = () => {
        state.selectedSoundZoneId = null
        state.mode = 'place-sound-zone'
        syncPlaceButton()
        syncZonePlaceButton()
    }
    zonePlacement.appendChild(placeZoneBtn)
    root.appendChild(zonePlacement)

    const selectedSection = sectionEl('Selected source')
    const selectedBody = document.createElement('div')
    selectedBody.style.display = 'flex'
    selectedBody.style.flexDirection = 'column'
    selectedBody.style.gap = '4px'
    selectedSection.appendChild(selectedBody)
    root.appendChild(selectedSection)

    const listSection = sectionEl('Placed sources')
    const list = document.createElement('div')
    list.className = 'vpe-list'
    listSection.appendChild(list)
    root.appendChild(listSection)

    const zoneListSection = sectionEl('Placed zones')
    const zoneList = document.createElement('div')
    zoneList.className = 'vpe-list'
    zoneListSection.appendChild(zoneList)
    root.appendChild(zoneListSection)

    let selectedId = ''
    let listFingerprint = ''
    let zoneListFingerprint = ''

    function syncPlacementControls(): void {
        soundSelect.input.value = state.soundSourceSoundId
        label.input.value = state.soundSourceLabel
        radius.input.value = String(state.soundSourceRadius)
        volume.input.value = String(state.soundSourceVolume)
        loop.input.checked = state.soundSourceLoop
        autoplay.input.checked = state.soundSourceAutoplay
    }

    function syncPlaceButton(): void {
        placeBtn.classList.toggle('active', state.mode === 'place-sound')
        placeBtn.textContent = state.mode === 'place-sound' ? 'Placing source' : 'Place source'
    }

    function syncZonePlaceButton(): void {
        placeZoneBtn.classList.toggle('active', state.mode === 'place-sound-zone')
        placeZoneBtn.textContent = state.mode === 'place-sound-zone' ? 'Placing zone' : 'Place zone'
    }

    function syncZonePlacementControls(): void {
        zoneSoundSelect.input.value = state.soundZoneSoundId
        zoneLabel.input.value = state.soundZoneLabel
        zoneSizeXZ.input.value = String(state.soundZoneSize)
        zoneSizeY.input.value = String(state.soundZoneHeight)
        zoneVolume.input.value = String(state.soundZoneVolume)
        zoneFade.input.value = String(state.soundZoneFadeTime)
    }

    function syncEnvironmentControls(): void {
        envSelect.input.value = state.environment.soundId ?? ''
        envVol.input.value = String(state.environment.volume)
    }

    function renderSelected(): void {
        const source = selectedSoundSource(state)
        selectedId = source?.id ?? ''
        selectedBody.innerHTML = ''
        if (!source) {
            const empty = document.createElement('span')
            empty.className = 'vpe-list-empty'
            empty.textContent = 'No source selected.'
            selectedBody.appendChild(empty)
            return
        }

        selectedBody.appendChild(soundSelectField(source.soundId, (id) => {
            source.soundId = id
            listFingerprint = ''
            renderList()
        }).row)
        selectedBody.appendChild(textField('Label:', source.label ?? '', '(optional)', (value) => {
            source.label = value.trim() || undefined
            listFingerprint = ''
            renderList()
        }).row)

        const pos = document.createElement('div')
        pos.className = 'vpe-hint'
        pos.textContent = `Position ${formatCoord({
            x: roundForList(source.position.x),
            y: roundForList(source.position.y),
            z: roundForList(source.position.z),
        })}`
        selectedBody.appendChild(pos)

        selectedBody.appendChild(numberField('Radius:', source.radius, 0.5, 200, 0.5, (value) => {
            source.radius = value
            listFingerprint = ''
            renderList()
        }).row)
        selectedBody.appendChild(numberField('Volume:', source.volume, 0, 1, 0.05, (value) => {
            source.volume = value
            listFingerprint = ''
            renderList()
        }).row)

        const selectedToggles = document.createElement('div')
        selectedToggles.className = 'vpe-row'
        selectedToggles.append(
            checkboxField('Loop', source.loop, (checked) => {
                source.loop = checked
                listFingerprint = ''
                renderList()
            }).row,
            checkboxField('Autoplay', source.autoplay, (checked) => {
                source.autoplay = checked
                listFingerprint = ''
                renderList()
            }).row,
        )
        selectedBody.appendChild(selectedToggles)

        const row = document.createElement('div')
        row.className = 'vpe-row'
        const templateBtn = document.createElement('button')
        templateBtn.className = 'vpe-button'
        templateBtn.textContent = 'Use as template'
        templateBtn.onclick = () => {
            state.soundSourceSoundId = source.soundId
            state.soundSourceLabel = source.label ?? ''
            state.soundSourceRadius = source.radius
            state.soundSourceVolume = source.volume
            state.soundSourceLoop = source.loop
            state.soundSourceAutoplay = source.autoplay
            syncPlacementControls()
        }
        const removeBtn = document.createElement('button')
        removeBtn.className = 'vpe-button'
        removeBtn.textContent = 'Remove'
        removeBtn.onclick = () => {
            removeSource(state, source)
            selectedId = ''
            listFingerprint = ''
            renderSelected()
            renderList()
        }
        row.append(templateBtn, removeBtn)
        selectedBody.appendChild(row)
    }

    function renderList(): void {
        const fp = state.soundSources.map((s) => `${s.id}|${s.soundId}|${s.label ?? ''}|${s.radius}|${s.volume}|${s.loop}|${s.autoplay}|${s.position.x},${s.position.y},${s.position.z}`).join('||') +
            `::${state.selectedSoundSourceId ?? ''}`
        if (fp === listFingerprint) return
        listFingerprint = fp
        list.innerHTML = ''
        if (state.soundSources.length === 0) {
            const empty = document.createElement('span')
            empty.className = 'vpe-list-empty'
            empty.textContent = 'No sound sources placed yet.'
            list.appendChild(empty)
            return
        }
        for (const source of state.soundSources) {
            const row = document.createElement('div')
            row.className = 'vpe-list-item'
            if (source.id === state.selectedSoundSourceId) row.style.color = '#ffd166'
            const span = document.createElement('span')
            span.textContent = `${source.label ? trimForList(source.label) : source.id} · ${source.soundId} · r${source.radius}`
            span.title = source.soundId
            const controls = document.createElement('span')
            controls.style.display = 'flex'
            controls.style.gap = '2px'
            const editBtn = document.createElement('button')
            editBtn.textContent = 'edit'
            editBtn.onclick = () => {
                state.selectedSoundSourceId = source.id
                renderSelected()
                listFingerprint = ''
                renderList()
            }
            const removeBtn = document.createElement('button')
            removeBtn.textContent = 'remove'
            removeBtn.onclick = () => {
                removeSource(state, source)
                renderSelected()
                listFingerprint = ''
                renderList()
            }
            controls.append(editBtn, removeBtn)
            row.append(span, controls)
            list.appendChild(row)
        }
    }

    function renderZoneList(): void {
        const fp = state.soundZones
            .map((z) => `${z.id}|${z.label ?? ''}|${z.soundId}|${z.min.x},${z.min.y},${z.min.z}|${z.max.x},${z.max.y},${z.max.z}|${z.volume}|${z.fadeTime}`)
            .join('||') + `::${state.selectedSoundZoneId ?? ''}`
        if (fp === zoneListFingerprint) return
        zoneListFingerprint = fp
        zoneList.innerHTML = ''
        if (state.soundZones.length === 0) {
            const empty = document.createElement('span')
            empty.className = 'vpe-list-empty'
            empty.textContent = 'No sound zones placed yet.'
            zoneList.appendChild(empty)
            return
        }
        for (const zone of state.soundZones) {
            const row = document.createElement('div')
            row.className = 'vpe-list-item'
            if (zone.id === state.selectedSoundZoneId) row.style.color = '#ffd166'
            const w = zone.max.x - zone.min.x
            const h = zone.max.y - zone.min.y
            const d = zone.max.z - zone.min.z
            const span = document.createElement('span')
            span.textContent = `${zone.label ? trimForList(zone.label) : zone.id} · ${zone.soundId} · ${w}×${h}×${d}`
            span.title = zone.soundId
            const controls = document.createElement('span')
            controls.style.display = 'flex'
            controls.style.gap = '2px'
            const editBtn = document.createElement('button')
            editBtn.textContent = 'select'
            editBtn.onclick = () => {
                state.selectedSoundZoneId = zone.id
                zoneListFingerprint = ''
                renderZoneList()
            }
            const removeBtn = document.createElement('button')
            removeBtn.textContent = 'remove'
            removeBtn.onclick = () => {
                const idx = state.soundZones.indexOf(zone)
                if (idx >= 0) state.soundZones.splice(idx, 1)
                if (state.selectedSoundZoneId === zone.id) state.selectedSoundZoneId = null
                zoneListFingerprint = ''
                renderZoneList()
            }
            controls.append(editBtn, removeBtn)
            row.append(span, controls)
            zoneList.appendChild(row)
        }
    }

    function refresh(): void {
        ensureValidDefaultSound(state)
        if (!placement.contains(document.activeElement)) syncPlacementControls()
        if (!zonePlacement.contains(document.activeElement)) syncZonePlacementControls()
        if (!envSection.contains(document.activeElement)) syncEnvironmentControls()
        syncPlaceButton()
        syncZonePlaceButton()
        if ((selectedSoundSource(state)?.id ?? '') !== selectedId) renderSelected()
        renderList()
        renderZoneList()
    }

    renderSelected()
    renderList()
    renderZoneList()
    syncPlaceButton()
    syncZonePlaceButton()

    return { element: root, refresh }
}

function selectedSoundSource(state: EditorState): EditorSoundSource | null {
    if (!state.selectedSoundSourceId) return null
    return state.soundSources.find((source) => source.id === state.selectedSoundSourceId) ?? null
}

function removeSource(state: EditorState, source: EditorSoundSource): void {
    const i = state.soundSources.indexOf(source)
    if (i >= 0) state.soundSources.splice(i, 1)
    if (state.selectedSoundSourceId === source.id) state.selectedSoundSourceId = null
}

function ensureValidDefaultSound(state: EditorState): void {
    if (findSourceAsset(state.soundSourceSoundId)) return
    state.soundSourceSoundId = SOURCE_ASSETS[0]?.id ?? GameAudio.AmbFire
}

function findSourceAsset(id: string): AudioAsset | undefined {
    return SOURCE_ASSETS.find((asset) => asset.id === id)
}

function soundSelectField(
    initial: string,
    onChange: (id: string) => void,
): { row: HTMLElement; input: HTMLSelectElement } {
    const row = document.createElement('div')
    row.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = 'Sound:'
    const input = document.createElement('select')
    input.className = 'vpe-input'
    input.style.flex = '2'
    for (const asset of SOURCE_ASSETS) {
        const option = document.createElement('option')
        option.value = asset.id
        option.textContent = formatAssetName(asset)
        input.appendChild(option)
    }
    input.value = initial
    input.onchange = () => { onChange(input.value) }
    row.append(label, input)
    return { row, input }
}

/** Like `soundSelectField` but includes music + an explicit `(none)`
 *  option so the level can opt out of an environment bed entirely. */
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
    input.oninput = () => { onChange(input.value) }
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
    input.onchange = () => { onChange(input.checked) }
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = labelText
    row.append(input, label)
    return { row, input }
}

function formatAssetName(asset: AudioAsset): string {
    const id = asset.id.replace(/^sfx\./, '').replace(/\./g, ' / ')
    return asset.loop ? `${id} loop` : id
}

function roundForList(value: number): number {
    return Math.round(value * 10) / 10
}

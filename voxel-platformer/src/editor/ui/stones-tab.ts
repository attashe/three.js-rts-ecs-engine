import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import {
    DEFAULT_STONE_TIER,
    STONE_TIER_IDS,
    stoneRadiusForConfig,
    type StoneFallSpawnerConfig,
    type StonePlacementConfig,
    type StoneTierId,
} from '../../game/moving-objects'
import { nextStoneEditorId, normalizeStoneEditorId } from '../stone-ids'
import { sectionEl, trimForList, type RefreshableElement } from './common'

export interface StonesTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

export function buildStonesTab(opts: StonesTabOptions): RefreshableElement {
    const state = opts.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const modeSection = sectionEl('Mode')
    const modeRow = document.createElement('div')
    modeRow.className = 'vpe-row'
    const placeStoneBtn = button('Place Stone', 'LMB places a physics stone. RMB removes the nearest stone.')
    placeStoneBtn.onclick = () => {
        state.mode = state.mode === 'place-stone' ? 'select' : 'place-stone'
        refresh()
    }
    const placeSpawnerBtn = button('Place Spawner', 'LMB places a falling-stone spawner. RMB removes the nearest spawner.')
    placeSpawnerBtn.onclick = () => {
        state.mode = state.mode === 'place-stone-spawner' ? 'select' : 'place-stone-spawner'
        refresh()
    }
    modeRow.append(placeStoneBtn, placeSpawnerBtn)
    modeSection.appendChild(modeRow)
    root.appendChild(modeSection)

    const stoneSection = sectionEl('Stone')
    const stoneTier = tierSelect(state.stoneTier, (tier) => { state.stoneTier = tier })
    const stoneSize = numberField('Size', state.stoneSize, 0.05, 2, 0.01, (v) => { state.stoneSize = clamp(v, 0.05, 2) })
    stoneSection.append(stoneTier, stoneSize)
    stoneSection.appendChild(vectorFields('Velocity', state.stoneVelocity, -40, 40, 0.1))
    root.appendChild(stoneSection)

    const spawnerSection = sectionEl('Spawner')
    const spawnerEnabled = checkboxField('Enabled', state.stoneSpawnerEnabled, (value) => { state.stoneSpawnerEnabled = value })
    const spawnerTier = tierSelect(state.stoneSpawnerTier, (tier) => { state.stoneSpawnerTier = tier })
    spawnerSection.append(spawnerEnabled, spawnerTier)
    const rowA = document.createElement('div')
    rowA.className = 'vpe-row'
    rowA.append(
        numberField('Size', state.stoneSpawnerSize, 0.05, 2, 0.01, (v) => { state.stoneSpawnerSize = clamp(v, 0.05, 2) }),
        numberField('Interval', state.stoneSpawnerInterval, 0.05, 60, 0.05, (v) => { state.stoneSpawnerInterval = clamp(v, 0.05, 60) }),
    )
    spawnerSection.appendChild(rowA)
    const rowB = document.createElement('div')
    rowB.className = 'vpe-row'
    rowB.append(
        numberField('Delay', state.stoneSpawnerDelay, 0, 60, 0.05, (v) => { state.stoneSpawnerDelay = clamp(v, 0, 60) }),
        numberField('Max active', state.stoneSpawnerMaxLive, 1, 64, 1, (v) => { state.stoneSpawnerMaxLive = Math.floor(clamp(v, 1, 64)) }),
    )
    spawnerSection.appendChild(rowB)
    spawnerSection.appendChild(numberField('Jitter', state.stoneSpawnerJitter, 0, 8, 0.05, (v) => { state.stoneSpawnerJitter = clamp(v, 0, 8) }))
    spawnerSection.appendChild(vectorFields('Velocity', state.stoneSpawnerVelocity, -40, 40, 0.1))
    root.appendChild(spawnerSection)

    const selectedStoneSection = sectionEl('Selected Stone')
    const selectedStoneBody = document.createElement('div')
    selectedStoneBody.style.display = 'flex'
    selectedStoneBody.style.flexDirection = 'column'
    selectedStoneBody.style.gap = '6px'
    selectedStoneSection.appendChild(selectedStoneBody)
    root.appendChild(selectedStoneSection)

    const selectedSpawnerSection = sectionEl('Selected Spawner')
    const selectedSpawnerBody = document.createElement('div')
    selectedSpawnerBody.style.display = 'flex'
    selectedSpawnerBody.style.flexDirection = 'column'
    selectedSpawnerBody.style.gap = '6px'
    selectedSpawnerSection.appendChild(selectedSpawnerBody)
    root.appendChild(selectedSpawnerSection)

    const stonesListSection = sectionEl('Stones')
    const stonesList = listContainer()
    stonesListSection.appendChild(stonesList)
    root.appendChild(stonesListSection)

    const spawnersListSection = sectionEl('Spawners')
    const spawnersList = listContainer()
    spawnersListSection.appendChild(spawnersList)
    root.appendChild(spawnersListSection)

    let listFingerprint = ''
    let selectedStoneFingerprint = ''
    let selectedSpawnerFingerprint = ''

    function refresh(): void {
        placeStoneBtn.classList.toggle('active', state.mode === 'place-stone')
        placeSpawnerBtn.classList.toggle('active', state.mode === 'place-stone-spawner')
        syncSelect(stoneTier, state.stoneTier)
        syncSelect(spawnerTier, state.stoneSpawnerTier)
        ;(spawnerEnabled.querySelector('input') as HTMLInputElement).checked = state.stoneSpawnerEnabled
        rebuildSelectedStone()
        rebuildSelectedSpawner()
        rebuildLists()
    }

    function rebuildSelectedStone(): void {
        const stone = selectedStone(state)
        const fp = stone ? stoneFingerprint(stone) : 'none'
        if (fp === selectedStoneFingerprint) return
        selectedStoneFingerprint = fp
        selectedStoneBody.innerHTML = ''
        if (!stone) {
            selectedStoneBody.appendChild(hint('No stone selected.'))
            return
        }
        selectedStoneBody.append(
            textField('Id', stone.id ?? '', (value) => {
                stone.id = normalizeStoneEditorId(value, stone.id, state.stones.map((item) => item.id), 'stone')
                state.selectedStoneId = stone.id
                selectedStoneFingerprint = ''
                listFingerprint = ''
            }),
            tierSelect(stone.tier ?? DEFAULT_STONE_TIER, (tier) => {
                stone.tier = tier
                selectedStoneFingerprint = ''
            }),
            numberField('Size', stone.size ?? stoneRadiusForConfig(stone), 0.05, 2, 0.01, (v) => {
                stone.size = clamp(v, 0.05, 2)
                selectedStoneFingerprint = ''
            }),
            vectorFields('Velocity', stone.velocity ?? (stone.velocity = { x: 0, y: 0, z: 0 }), -40, 40, 0.1),
        )
    }

    function rebuildSelectedSpawner(): void {
        const spawner = selectedSpawner(state)
        const fp = spawner ? spawnerFingerprint(spawner) : 'none'
        if (fp === selectedSpawnerFingerprint) return
        selectedSpawnerFingerprint = fp
        selectedSpawnerBody.innerHTML = ''
        if (!spawner) {
            selectedSpawnerBody.appendChild(hint('No spawner selected.'))
            return
        }
        selectedSpawnerBody.append(
            textField('Id', spawner.id ?? '', (value) => {
                spawner.id = normalizeStoneEditorId(value, spawner.id, state.stoneSpawners.map((item) => item.id), 'stone-spawner')
                state.selectedStoneSpawnerId = spawner.id
                selectedSpawnerFingerprint = ''
                listFingerprint = ''
            }),
            checkboxField('Enabled', spawner.enabled !== false, (value) => {
                spawner.enabled = value
                selectedSpawnerFingerprint = ''
            }),
            tierSelect(spawner.tier ?? DEFAULT_STONE_TIER, (tier) => {
                spawner.tier = tier
                selectedSpawnerFingerprint = ''
            }),
        )
        const row1 = document.createElement('div')
        row1.className = 'vpe-row'
        row1.append(
            numberField('Size', spawner.size ?? stoneRadiusForConfig(spawner), 0.05, 2, 0.01, (v) => {
                spawner.size = clamp(v, 0.05, 2)
                selectedSpawnerFingerprint = ''
            }),
            numberField('Interval', spawner.interval, 0.05, 60, 0.05, (v) => {
                spawner.interval = clamp(v, 0.05, 60)
                selectedSpawnerFingerprint = ''
            }),
        )
        selectedSpawnerBody.appendChild(row1)
        const row2 = document.createElement('div')
        row2.className = 'vpe-row'
        row2.append(
            numberField('Delay', spawner.delay ?? 0, 0, 60, 0.05, (v) => {
                spawner.delay = clamp(v, 0, 60)
                selectedSpawnerFingerprint = ''
            }),
            numberField('Max active', spawner.maxLive ?? 4, 1, 64, 1, (v) => {
                spawner.maxLive = Math.floor(clamp(v, 1, 64))
                selectedSpawnerFingerprint = ''
            }),
        )
        selectedSpawnerBody.appendChild(row2)
        selectedSpawnerBody.append(
            numberField('Jitter', spawner.jitter ?? 0, 0, 8, 0.05, (v) => {
                spawner.jitter = clamp(v, 0, 8)
                selectedSpawnerFingerprint = ''
            }),
            vectorFields('Velocity', spawner.velocity, -40, 40, 0.1),
        )
    }

    function rebuildLists(): void {
        const fp = [
            state.selectedStoneId,
            state.selectedStoneSpawnerId,
            state.stones.map(stoneFingerprint).join('|'),
            state.stoneSpawners.map(spawnerFingerprint).join('|'),
        ].join('||')
        if (fp === listFingerprint) return
        listFingerprint = fp
        stonesList.innerHTML = ''
        if (state.stones.length === 0) stonesList.appendChild(hint('No stones placed yet.'))
        for (const stone of state.stones) stonesList.appendChild(stoneRow(state, stone, refresh))
        spawnersList.innerHTML = ''
        if (state.stoneSpawners.length === 0) spawnersList.appendChild(hint('No spawners placed yet.'))
        for (const spawner of state.stoneSpawners) spawnersList.appendChild(spawnerRow(state, spawner, refresh))
    }

    refresh()
    return { element: root, refresh }
}

function stoneRow(state: EditorState, stone: StonePlacementConfig, refresh: () => void): HTMLElement {
    const row = document.createElement('div')
    row.className = 'vpe-row'
    row.style.alignItems = 'center'
    if (stone.id && stone.id === state.selectedStoneId) row.style.color = '#ffd166'
    const span = document.createElement('span')
    span.style.flex = '1'
    span.style.cursor = 'pointer'
    span.textContent = `${trimForList(stone.id ?? 'stone', 14)} · ${stone.tier ?? DEFAULT_STONE_TIER}`
    span.title = `${formatPoint(stone.position)}`
    span.onclick = () => {
        if (!stone.id) stone.id = nextStoneEditorId(state.stones.map((item) => item.id), 'stone')
        state.selectedStoneId = stone.id
        refresh()
    }
    const del = smallButton('x', 'Remove this stone')
    del.onclick = () => {
        const idx = state.stones.indexOf(stone)
        if (idx >= 0) state.stones.splice(idx, 1)
        if (stone.id && state.selectedStoneId === stone.id) state.selectedStoneId = null
        refresh()
    }
    row.append(span, del)
    return row
}

function spawnerRow(state: EditorState, spawner: StoneFallSpawnerConfig, refresh: () => void): HTMLElement {
    const row = document.createElement('div')
    row.className = 'vpe-row'
    row.style.alignItems = 'center'
    if (spawner.id && spawner.id === state.selectedStoneSpawnerId) row.style.color = '#ffd166'
    const span = document.createElement('span')
    span.style.flex = '1'
    span.style.cursor = 'pointer'
    span.textContent = `${trimForList(spawner.id ?? 'spawner', 14)} · ${spawner.enabled === false ? 'off' : 'on'}`
    span.title = `${formatPoint(spawner.position)} · every ${spawner.interval.toFixed(2)}s`
    span.onclick = () => {
        if (!spawner.id) spawner.id = nextStoneEditorId(state.stoneSpawners.map((item) => item.id), 'stone-spawner')
        state.selectedStoneSpawnerId = spawner.id
        refresh()
    }
    const del = smallButton('x', 'Remove this spawner')
    del.onclick = () => {
        const idx = state.stoneSpawners.indexOf(spawner)
        if (idx >= 0) state.stoneSpawners.splice(idx, 1)
        if (spawner.id && state.selectedStoneSpawnerId === spawner.id) state.selectedStoneSpawnerId = null
        refresh()
    }
    row.append(span, del)
    return row
}

function selectedStone(state: EditorState): StonePlacementConfig | null {
    return state.selectedStoneId
        ? state.stones.find((stone) => stone.id === state.selectedStoneId) ?? null
        : null
}

function selectedSpawner(state: EditorState): StoneFallSpawnerConfig | null {
    return state.selectedStoneSpawnerId
        ? state.stoneSpawners.find((spawner) => spawner.id === state.selectedStoneSpawnerId) ?? null
        : null
}

function tierSelect(value: StoneTierId, onChange: (tier: StoneTierId) => void): HTMLLabelElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    const label = document.createElement('span')
    label.className = 'vpe-field-label'
    label.textContent = 'Tier'
    const select = document.createElement('select')
    select.className = 'vpe-input'
    for (const tier of STONE_TIER_IDS) {
        const opt = document.createElement('option')
        opt.value = tier
        opt.textContent = tier
        select.appendChild(opt)
    }
    select.value = value
    select.onchange = () => {
        if ((STONE_TIER_IDS as readonly string[]).includes(select.value)) onChange(select.value as StoneTierId)
    }
    field.append(label, select)
    return field
}

function vectorFields(
    label: string,
    target: { x: number; y: number; z: number },
    min: number,
    max: number,
    step: number,
): HTMLElement {
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '4px'
    const title = document.createElement('div')
    title.className = 'vpe-hint'
    title.textContent = label
    const row = document.createElement('div')
    row.className = 'vpe-row'
    row.append(
        numberField('X', target.x, min, max, step, (v) => { target.x = clamp(v, min, max) }),
        numberField('Y', target.y, min, max, step, (v) => { target.y = clamp(v, min, max) }),
        numberField('Z', target.z, min, max, step, (v) => { target.z = clamp(v, min, max) }),
    )
    root.append(title, row)
    return root
}

function textField(label: string, value: string, onChange: (value: string) => void): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'text'
    input.value = value
    input.onchange = () => onChange(input.value)
    field.append(labelEl, input)
    return field
}

function checkboxField(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    field.style.cursor = 'pointer'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = value
    input.onchange = () => onChange(input.checked)
    field.append(labelEl, input)
    return field
}

function numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): HTMLElement {
    const field = document.createElement('label')
    field.className = 'vpe-field'
    field.style.flex = '1 1 70px'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(roundForInput(value))
    input.onchange = () => {
        const next = Number(input.value)
        if (!Number.isFinite(next)) {
            input.value = String(roundForInput(value))
            return
        }
        onChange(next)
    }
    field.append(labelEl, input)
    return field
}

function button(text: string, title: string): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.className = 'vpe-button'
    btn.textContent = text
    btn.title = title
    return btn
}

function smallButton(text: string, title: string): HTMLButtonElement {
    const btn = button(text, title)
    btn.style.padding = '2px 6px'
    return btn
}

function listContainer(): HTMLElement {
    const el = document.createElement('div')
    el.style.display = 'flex'
    el.style.flexDirection = 'column'
    el.style.gap = '4px'
    el.style.maxHeight = '170px'
    el.style.overflowY = 'auto'
    return el
}

function hint(text: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'vpe-hint'
    el.textContent = text
    return el
}

function syncSelect(label: HTMLElement, value: string): void {
    const select = label.querySelector('select')
    if (select && select.value !== value) select.value = value
}

function stoneFingerprint(stone: StonePlacementConfig): string {
    return [
        stone.id,
        stone.tier,
        stone.size,
        stone.position.x,
        stone.position.y,
        stone.position.z,
        stone.velocity?.x,
        stone.velocity?.y,
        stone.velocity?.z,
    ].join(':')
}

function spawnerFingerprint(spawner: StoneFallSpawnerConfig): string {
    return [
        spawner.id,
        spawner.enabled,
        spawner.tier,
        spawner.size,
        spawner.interval,
        spawner.delay,
        spawner.maxLive,
        spawner.jitter,
        spawner.position.x,
        spawner.position.y,
        spawner.position.z,
        spawner.velocity.x,
        spawner.velocity.y,
        spawner.velocity.z,
    ].join(':')
}

function formatPoint(p: { x: number; y: number; z: number }): string {
    return `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`
}

function roundForInput(value: number): number {
    return Math.round(value * 1000) / 1000
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}

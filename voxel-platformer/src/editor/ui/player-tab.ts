import type { EditorState } from '../editor-state'
import {
    INDOOR_CUT_MODE_LABELS,
    INDOOR_CUT_MODES,
    PLAYER_ABILITY_KEYS,
    PLAYER_ABILITY_LABELS,
    PLAYER_MODEL_KINDS,
    PLAYER_MODEL_LABELS,
    type IndoorCutMode,
    type PlayerAbilityKey,
    type PlayerModelKind,
} from '../../game/player-settings'
import {
    CHARACTER_BEARD_KINDS,
    CHARACTER_BEARD_LABELS,
    type CharacterBeardKind,
} from '../../game/character-appearance'
import { sectionEl, type RefreshableElement } from './common'
import { equipmentSelect, headEquipmentSelect, syncEquipmentSelect, syncHeadEquipmentSelect } from './equipment-field'

export interface PlayerTabOptions {
    editorState: EditorState
}

export function buildPlayerTab(opts: PlayerTabOptions): RefreshableElement {
    const state = opts.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const spawnSection = sectionEl('Spawn')
    const spawnReadout = document.createElement('div')
    spawnReadout.className = 'vpe-hint'
    const placeSpawnBtn = document.createElement('button')
    placeSpawnBtn.className = 'vpe-button'
    placeSpawnBtn.textContent = 'Place spawn'
    placeSpawnBtn.title = 'LMB on the level sets the player start point.'
    placeSpawnBtn.onclick = () => {
        state.mode = state.mode === 'place-spawn' ? 'select' : 'place-spawn'
        refresh()
    }
    spawnSection.append(spawnReadout, placeSpawnBtn)
    root.appendChild(spawnSection)

    const modelSection = sectionEl('Model')
    const modelRow = document.createElement('label')
    modelRow.className = 'vpe-field'
    const modelLabel = document.createElement('span')
    modelLabel.className = 'vpe-field-label'
    modelLabel.textContent = 'Model'
    const modelSelect = document.createElement('select')
    modelSelect.className = 'vpe-input'
    modelSelect.style.flex = '1'
    for (const model of PLAYER_MODEL_KINDS) {
        const opt = document.createElement('option')
        opt.value = model
        opt.textContent = PLAYER_MODEL_LABELS[model]
        modelSelect.appendChild(opt)
    }
    modelSelect.onchange = () => { state.player.model = modelSelect.value as PlayerModelKind }
    modelRow.append(modelLabel, modelSelect)

    const beardRow = document.createElement('label')
    beardRow.className = 'vpe-field'
    const beardLabel = document.createElement('span')
    beardLabel.className = 'vpe-field-label'
    beardLabel.textContent = 'Beard'
    const beardSelect = document.createElement('select')
    beardSelect.className = 'vpe-input'
    beardSelect.style.flex = '1'
    for (const beard of CHARACTER_BEARD_KINDS) {
        const opt = document.createElement('option')
        opt.value = beard
        opt.textContent = CHARACTER_BEARD_LABELS[beard]
        beardSelect.appendChild(opt)
    }
    beardSelect.onchange = () => { state.player.beard = beardSelect.value as CharacterBeardKind }
    beardRow.append(beardLabel, beardSelect)

    modelSection.append(modelRow, beardRow)
    root.appendChild(modelSection)

    const equipmentSection = sectionEl('Equipment')
    const headSelect = headEquipmentSelect('Head', (value) => { state.player.equipment.head = value })
    const meleeRight = equipmentSelect('Melee right', (value) => { state.player.equipment.melee.handR = value })
    const meleeLeft = equipmentSelect('Melee left', (value) => { state.player.equipment.melee.handL = value })
    const rangedRight = equipmentSelect('Ranged right', (value) => { state.player.equipment.ranged.handR = value })
    const rangedLeft = equipmentSelect('Ranged left', (value) => { state.player.equipment.ranged.handL = value })
    const magicRight = equipmentSelect('Magic right', (value) => { state.player.equipment.magic.handR = value })
    const magicLeft = equipmentSelect('Magic left', (value) => { state.player.equipment.magic.handL = value })
    equipmentSection.append(
        headSelect.row,
        meleeRight.row,
        meleeLeft.row,
        rangedRight.row,
        rangedLeft.row,
        magicRight.row,
        magicLeft.row,
    )
    root.appendChild(equipmentSection)

    const abilitiesSection = sectionEl('Abilities')
    const abilityInputs = new Map<PlayerAbilityKey, HTMLInputElement>()
    for (const ability of PLAYER_ABILITY_KEYS) {
        const row = checkboxInput(PLAYER_ABILITY_LABELS[ability], state.player.abilities[ability], (checked) => {
            state.player.abilities[ability] = checked
        })
        abilityInputs.set(ability, row.input)
        abilitiesSection.appendChild(row.row)
    }
    root.appendChild(abilitiesSection)

    const inventorySection = sectionEl('Starting Inventory')
    const goldField = numberInput('Money', state.player.inventory.gold, 0, 999999, 1, (value) => {
        state.player.inventory.gold = clampInt(value, 0, 999999)
    })
    const arrowsField = numberInput('Arrows', state.player.inventory.arrows, 0, 9999, 1, (value) => {
        state.player.inventory.arrows = clampInt(value, 0, 9999)
    })
    inventorySection.append(goldField.row, arrowsField.row)
    root.appendChild(inventorySection)

    const movementSection = sectionEl('Movement')
    const moveSpeedField = numberInput('Move speed', state.player.moveSpeed, 0, 30, 0.1, (value) => {
        state.player.moveSpeed = clampNumber(value, 0, 30)
    })
    const jumpField = numberInput('Jump velocity', state.player.jumpVelocity, 0, 40, 0.1, (value) => {
        state.player.jumpVelocity = clampNumber(value, 0, 40)
    })
    const highJumpField = numberInput('High jump', state.player.highJumpVelocity, 0, 60, 0.1, (value) => {
        state.player.highJumpVelocity = clampNumber(value, 0, 60)
    })
    movementSection.append(moveSpeedField.row, jumpField.row, highJumpField.row)
    root.appendChild(movementSection)

    const actionSection = sectionEl('Actions')
    const arrowSpeedField = numberInput('Arrow speed', state.player.arrowSpeed, 0, 80, 0.1, (value) => {
        state.player.arrowSpeed = clampNumber(value, 0, 80)
    })
    const arrowLiftField = numberInput('Arrow lift', state.player.arrowLift, -20, 40, 0.1, (value) => {
        state.player.arrowLift = clampNumber(value, -20, 40)
    })
    const airPushRangeField = numberInput('Air Push range', state.player.airPushRange, 0, 50, 0.1, (value) => {
        state.player.airPushRange = clampNumber(value, 0, 50)
    })
    const airPushPowerField = numberInput('Air Push power', state.player.airPushPower, 0, 80, 0.1, (value) => {
        state.player.airPushPower = clampNumber(value, 0, 80)
    })
    const airPushLiftField = numberInput('Air Push lift', state.player.airPushLift, 0, 60, 0.1, (value) => {
        state.player.airPushLift = clampNumber(value, 0, 60)
    })
    actionSection.append(arrowSpeedField.row, arrowLiftField.row, airPushRangeField.row, airPushPowerField.row, airPushLiftField.row)
    root.appendChild(actionSection)

    const torchSection = sectionEl('Held Torch')
    const torchIntensityField = numberInput('Intensity', state.player.torch.intensity, 0, 80, 0.1, (value) => {
        state.player.torch.intensity = clampNumber(value, 0, 80)
    })
    const torchDistanceField = numberInput('Distance', state.player.torch.distance, 0, 80, 0.1, (value) => {
        state.player.torch.distance = clampNumber(value, 0, 80)
    })
    const torchShadow = checkboxInput('Casts shadows', state.player.torch.castsShadow, (checked) => {
        state.player.torch.castsShadow = checked
    })
    torchSection.append(torchIntensityField.row, torchDistanceField.row, torchShadow.row)
    root.appendChild(torchSection)

    const viewSection = sectionEl('View')
    const indoorCutToggle = checkboxInput('Reveal character indoors', state.player.indoorCutEnabled, (checked) => {
        state.player.indoorCutEnabled = checked
    })
    const cutModeRow = document.createElement('label')
    cutModeRow.className = 'vpe-field'
    const cutModeLabel = document.createElement('span')
    cutModeLabel.className = 'vpe-field-label'
    cutModeLabel.textContent = 'Reveal style'
    const cutModeSelect = document.createElement('select')
    cutModeSelect.className = 'vpe-input'
    cutModeSelect.style.flex = '1'
    for (const mode of INDOOR_CUT_MODES) {
        const opt = document.createElement('option')
        opt.value = mode
        opt.textContent = INDOOR_CUT_MODE_LABELS[mode]
        cutModeSelect.appendChild(opt)
    }
    cutModeSelect.value = state.player.indoorCutMode
    cutModeSelect.onchange = () => { state.player.indoorCutMode = cutModeSelect.value as IndoorCutMode }
    cutModeRow.append(cutModeLabel, cutModeSelect)
    viewSection.append(indoorCutToggle.row, cutModeRow)
    root.appendChild(viewSection)

    function refresh(): void {
        spawnReadout.textContent = `Spawn: ${state.spawn.x.toFixed(1)}, ${state.spawn.y.toFixed(1)}, ${state.spawn.z.toFixed(1)}`
        placeSpawnBtn.classList.toggle('active', state.mode === 'place-spawn')
        if (document.activeElement !== modelSelect) modelSelect.value = state.player.model
        if (document.activeElement !== beardSelect) beardSelect.value = state.player.beard
        syncHeadEquipmentSelect(headSelect.input, state.player.equipment.head)
        syncEquipmentSelect(meleeRight.input, state.player.equipment.melee.handR)
        syncEquipmentSelect(meleeLeft.input, state.player.equipment.melee.handL)
        syncEquipmentSelect(rangedRight.input, state.player.equipment.ranged.handR)
        syncEquipmentSelect(rangedLeft.input, state.player.equipment.ranged.handL)
        syncEquipmentSelect(magicRight.input, state.player.equipment.magic.handR)
        syncEquipmentSelect(magicLeft.input, state.player.equipment.magic.handL)
        for (const ability of PLAYER_ABILITY_KEYS) {
            const input = abilityInputs.get(ability)
            if (input && input.checked !== state.player.abilities[ability]) input.checked = state.player.abilities[ability]
        }
        syncNumber(goldField, state.player.inventory.gold)
        syncNumber(arrowsField, state.player.inventory.arrows)
        syncNumber(moveSpeedField, state.player.moveSpeed)
        syncNumber(jumpField, state.player.jumpVelocity)
        syncNumber(highJumpField, state.player.highJumpVelocity)
        syncNumber(arrowSpeedField, state.player.arrowSpeed)
        syncNumber(arrowLiftField, state.player.arrowLift)
        syncNumber(airPushRangeField, state.player.airPushRange)
        syncNumber(airPushPowerField, state.player.airPushPower)
        syncNumber(airPushLiftField, state.player.airPushLift)
        syncNumber(torchIntensityField, state.player.torch.intensity)
        syncNumber(torchDistanceField, state.player.torch.distance)
        if (torchShadow.input.checked !== state.player.torch.castsShadow) torchShadow.input.checked = state.player.torch.castsShadow
        if (indoorCutToggle.input.checked !== state.player.indoorCutEnabled) indoorCutToggle.input.checked = state.player.indoorCutEnabled
        if (document.activeElement !== cutModeSelect && cutModeSelect.value !== state.player.indoorCutMode) cutModeSelect.value = state.player.indoorCutMode
    }

    refresh()
    return { element: root, refresh }

    function syncNumber(field: NumberField, value: number): void {
        if (document.activeElement === field.input) return
        field.input.value = String(roundForInput(value))
    }
}

interface NumberField {
    row: HTMLElement
    input: HTMLInputElement
}

interface CheckField {
    row: HTMLElement
    input: HTMLInputElement
}

function numberInput(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
): NumberField {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.value = String(value)
    input.style.width = '74px'
    input.onchange = () => {
        const next = parseFloat(input.value)
        if (!Number.isFinite(next)) {
            input.value = String(value)
            return
        }
        onChange(next)
    }
    row.append(labelEl, input)
    return { row, input }
}

function checkboxInput(label: string, checked: boolean, onChange: (checked: boolean) => void): CheckField {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    row.style.cursor = 'pointer'
    const span = document.createElement('span')
    span.className = 'vpe-field-label'
    span.textContent = label
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = checked
    input.onchange = () => onChange(input.checked)
    row.append(span, input)
    return { row, input }
}

function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}

function clampInt(value: number, min: number, max: number): number {
    return Math.floor(clampNumber(value, min, max))
}

function roundForInput(value: number): number {
    return Math.round(value * 100) / 100
}

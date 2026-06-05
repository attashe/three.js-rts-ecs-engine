import {
    EQUIPMENT_LABELS,
    HAND_EQUIPMENT_KINDS,
    HEAD_EQUIPMENT_KINDS,
    normalizeHeadEquipmentKind,
    normalizeHandEquipmentKind,
    type HeadEquipmentKind,
    type HandEquipmentKind,
} from '../../game/anim/equipment-types'

export interface EquipmentSelectField {
    row: HTMLElement
    input: HTMLSelectElement
}

export function equipmentSelect(
    label: string,
    onChange: (value: HandEquipmentKind | null) => void,
): EquipmentSelectField {
    return equipmentSelectBase(label, HAND_EQUIPMENT_KINDS, (value) => onChange(normalizeHandEquipmentKind(value)))
}

export function headEquipmentSelect(
    label: string,
    onChange: (value: HeadEquipmentKind | null) => void,
): EquipmentSelectField {
    return equipmentSelectBase(label, HEAD_EQUIPMENT_KINDS, (value) => onChange(normalizeHeadEquipmentKind(value)))
}

function equipmentSelectBase(
    label: string,
    kinds: readonly (HandEquipmentKind | HeadEquipmentKind)[],
    onChange: (value: string) => void,
): EquipmentSelectField {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('select')
    input.className = 'vpe-input'
    input.style.flex = '1'

    const none = document.createElement('option')
    none.value = 'none'
    none.textContent = 'None'
    input.appendChild(none)

    for (const kind of kinds) {
        const opt = document.createElement('option')
        opt.value = kind
        opt.textContent = EQUIPMENT_LABELS[kind]
        input.appendChild(opt)
    }

    input.onchange = () => onChange(input.value)
    row.append(labelEl, input)
    return { row, input }
}

export function syncEquipmentSelect(input: HTMLSelectElement, value: HandEquipmentKind | null): void {
    if (document.activeElement === input) return
    const next = value ?? 'none'
    if (input.value !== next) input.value = next
}

export function syncHeadEquipmentSelect(input: HTMLSelectElement, value: HeadEquipmentKind | null): void {
    if (document.activeElement === input) return
    const next = value ?? 'none'
    if (input.value !== next) input.value = next
}

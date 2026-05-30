import {
    EQUIPMENT_LABELS,
    HAND_EQUIPMENT_KINDS,
    normalizeHandEquipmentKind,
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

    for (const kind of HAND_EQUIPMENT_KINDS) {
        const opt = document.createElement('option')
        opt.value = kind
        opt.textContent = EQUIPMENT_LABELS[kind]
        input.appendChild(opt)
    }

    input.onchange = () => onChange(normalizeHandEquipmentKind(input.value))
    row.append(labelEl, input)
    return { row, input }
}

export function syncEquipmentSelect(input: HTMLSelectElement, value: HandEquipmentKind | null): void {
    if (document.activeElement === input) return
    const next = value ?? 'none'
    if (input.value !== next) input.value = next
}

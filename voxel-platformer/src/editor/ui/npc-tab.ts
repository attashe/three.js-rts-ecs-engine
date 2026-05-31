import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import { PRELUDE_LOCALS } from '../../engine/script/compile'
import type { CommandStack } from '../history'
import type { EditorState } from '../editor-state'
import {
    DEFAULT_NPC,
    NPC_MODEL_KINDS,
    NPC_MODEL_LABELS,
    defaultNpcBeard,
    defaultNpcEquipment,
    npcEquipmentKey,
    npcInteractionZoneId,
    sanitizeNpcId,
    type NpcConfig,
    type NpcModelKind,
} from '../../game/npcs/npc-types'
import {
    copyHandLoadout,
    handLoadoutKey,
} from '../../game/anim/equipment-types'
import {
    CHARACTER_BEARD_KINDS,
    CHARACTER_BEARD_LABELS,
    type CharacterBeardKind,
} from '../../game/character-appearance'
import { sectionEl, trimForList, type RefreshableElement } from './common'
import { equipmentSelect, syncEquipmentSelect } from './equipment-field'

export interface NpcTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

export function buildNpcTab(opts: NpcTabOptions): RefreshableElement {
    const state = opts.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    const modeSection = sectionEl('Mode')
    const modeRow = document.createElement('div')
    modeRow.className = 'vpe-row'
    const placeBtn = document.createElement('button')
    placeBtn.className = 'vpe-button'
    placeBtn.textContent = 'Place NPC'
    placeBtn.title = 'LMB places an NPC. RMB removes the nearest NPC.'
    placeBtn.onclick = () => {
        state.mode = state.mode === 'place-npc' ? 'select' : 'place-npc'
        refresh()
    }
    modeRow.appendChild(placeBtn)
    modeSection.appendChild(modeRow)
    const hint = document.createElement('div')
    hint.className = 'vpe-hint'
    hint.textContent = 'Static NPCs own model, collision, interaction, and script metadata.'
    modeSection.appendChild(hint)
    root.appendChild(modeSection)

    const listSection = sectionEl('NPCs')
    const listEl = document.createElement('div')
    listEl.style.display = 'flex'
    listEl.style.flexDirection = 'column'
    listEl.style.gap = '4px'
    listEl.style.maxHeight = '150px'
    listEl.style.overflowY = 'auto'
    listSection.appendChild(listEl)
    root.appendChild(listSection)

    const identitySection = sectionEl('Identity')
    const idField = textInput('Id', '', (value) => updateSelectedId(value))
    const nameField = textInput('Name', '', (value) => updateDraftOrSelected((npc) => { npc.name = value || DEFAULT_NPC.name }, () => { state.npcName = value }))
    identitySection.append(idField.row, nameField.row)

    const modelRow = document.createElement('label')
    modelRow.className = 'vpe-field'
    const modelLabel = document.createElement('span')
    modelLabel.className = 'vpe-field-label'
    modelLabel.textContent = 'Model'
    const modelSelect = document.createElement('select')
    modelSelect.className = 'vpe-input'
    modelSelect.style.flex = '1'
    for (const model of NPC_MODEL_KINDS) {
        const opt = document.createElement('option')
        opt.value = model
        opt.textContent = NPC_MODEL_LABELS[model]
        modelSelect.appendChild(opt)
    }
    modelSelect.onchange = () => {
        const model = modelSelect.value as NpcModelKind
        updateDraftOrSelected(
            (npc) => {
                const previousDefault = defaultNpcEquipment(npc.model)
                const wasDefaultEquipment = npcEquipmentKey(npc) === handLoadoutKey(previousDefault)
                const previousDefaultBeard = defaultNpcBeard(npc.model)
                const wasDefaultBeard = npc.beard === previousDefaultBeard
                npc.model = model
                if (wasDefaultEquipment) npc.equipment = defaultNpcEquipment(model)
                if (wasDefaultBeard) npc.beard = defaultNpcBeard(model)
            },
            () => {
                const previousDefault = defaultNpcEquipment(state.npcModel)
                const wasDefaultEquipment = handLoadoutKey(state.npcEquipment) === handLoadoutKey(previousDefault)
                const previousDefaultBeard = defaultNpcBeard(state.npcModel)
                const wasDefaultBeard = state.npcBeard === previousDefaultBeard
                state.npcModel = model
                if (wasDefaultEquipment) state.npcEquipment = defaultNpcEquipment(model)
                if (wasDefaultBeard) state.npcBeard = defaultNpcBeard(model)
            },
        )
    }
    modelRow.append(modelLabel, modelSelect)
    identitySection.appendChild(modelRow)

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
    beardSelect.onchange = () => {
        const beard = beardSelect.value as CharacterBeardKind
        updateDraftOrSelected((npc) => { npc.beard = beard }, () => { state.npcBeard = beard })
    }
    beardRow.append(beardLabel, beardSelect)
    identitySection.appendChild(beardRow)
    root.appendChild(identitySection)

    const transformSection = sectionEl('Transform')
    const gridRow = checkboxInput('Align to voxel grid', true, (checked) => {
        updateDraftOrSelected((npc) => { npc.gridAligned = checked }, () => { state.npcGridAlign = checked })
    })
    const yawField = numberInput('Yaw deg', 0, 0, 360, 1, (value) => {
        const yaw = degToRad(wrapDegrees(value))
        updateDraftOrSelected((npc) => { npc.yaw = yaw }, () => { state.npcYaw = yaw })
    })
    const scaleField = numberInput('Scale', 1, 0.25, 4, 0.05, (value) => {
        const scale = clamp(value, 0.25, 4)
        updateDraftOrSelected((npc) => { npc.scale = scale }, () => { state.npcScale = scale })
    })
    transformSection.append(gridRow.row, yawField.row, scaleField.row)
    root.appendChild(transformSection)

    const collisionSection = sectionEl('Collision')
    const collisionEnabled = checkboxInput('Blocks player/arrows/stones', true, (checked) => {
        updateDraftOrSelected((npc) => { npc.collisionEnabled = checked }, () => { state.npcCollisionEnabled = checked })
    })
    const radiusField = numberInput('Radius', DEFAULT_NPC.colliderRadius, 0.05, 2, 0.05, (value) => {
        const radius = clamp(value, 0.05, 2)
        updateDraftOrSelected((npc) => { npc.colliderRadius = radius }, () => { state.npcColliderRadius = radius })
    })
    const heightField = numberInput('Height', DEFAULT_NPC.colliderHeight, 0.2, 4, 0.05, (value) => {
        const height = clamp(value, 0.2, 4)
        updateDraftOrSelected((npc) => { npc.colliderHeight = height }, () => { state.npcColliderHeight = height })
    })
    collisionSection.append(collisionEnabled.row, radiusField.row, heightField.row)
    root.appendChild(collisionSection)

    const equipmentSection = sectionEl('Held Items')
    const handRSelect = equipmentSelect('Right hand', (value) => {
        updateDraftOrSelected(
            (npc) => { npc.equipment.handR = value },
            () => { state.npcEquipment.handR = value },
        )
    })
    const handLSelect = equipmentSelect('Left hand', (value) => {
        updateDraftOrSelected(
            (npc) => { npc.equipment.handL = value },
            () => { state.npcEquipment.handL = value },
        )
    })
    const resetEquipmentBtn = document.createElement('button')
    resetEquipmentBtn.className = 'vpe-button'
    resetEquipmentBtn.textContent = 'Model defaults'
    resetEquipmentBtn.onclick = () => {
        updateDraftOrSelected(
            (npc) => { npc.equipment = defaultNpcEquipment(npc.model) },
            () => { state.npcEquipment = defaultNpcEquipment(state.npcModel) },
        )
    }
    equipmentSection.append(handRSelect.row, handLSelect.row, resetEquipmentBtn)
    root.appendChild(equipmentSection)

    const interactionSection = sectionEl('Interaction')
    const interactionEnabled = checkboxInput('Interaction zone', true, (checked) => {
        updateDraftOrSelected((npc) => { npc.interactionEnabled = checked }, () => { state.npcInteractionEnabled = checked })
    })
    const promptField = textInput('Prompt', DEFAULT_NPC.interactionPrompt, (value) => {
        updateDraftOrSelected((npc) => { npc.interactionPrompt = value || DEFAULT_NPC.interactionPrompt }, () => { state.npcInteractionPrompt = value })
    })
    const interactionRadius = numberInput('Radius', DEFAULT_NPC.interactionRadius, 0.5, 8, 0.1, (value) => {
        const radius = clamp(value, 0.5, 8)
        updateDraftOrSelected((npc) => { npc.interactionRadius = radius }, () => { state.npcInteractionRadius = radius })
    })
    const interactionId = document.createElement('div')
    interactionId.className = 'vpe-hint'
    interactionSection.append(interactionEnabled.row, promptField.row, interactionRadius.row, interactionId)
    root.appendChild(interactionSection)

    const scriptSection = sectionEl('NPC Script')
    const scriptEnabled = checkboxInput('Enabled', true, (checked) => {
        updateDraftOrSelected((npc) => { npc.scriptEnabled = checked }, () => { state.npcScriptEnabled = checked })
    })
    scriptSection.appendChild(scriptEnabled.row)

    const templateRow = document.createElement('div')
    templateRow.className = 'vpe-row'
    const simpleTemplate = templateButton('Simple Dialogue', () => simpleDialogueTemplate(currentScriptTarget()))
    const choiceTemplate = templateButton('Choice Dialogue', () => choiceDialogueTemplate(currentScriptTarget()))
    const questTemplate = templateButton('Collection Quest', () => collectionQuestTemplate(currentScriptTarget()))
    templateRow.append(simpleTemplate, choiceTemplate, questTemplate)
    scriptSection.appendChild(templateRow)

    const scriptArea = document.createElement('textarea')
    scriptArea.className = 'vpe-input'
    scriptArea.spellcheck = false
    scriptArea.style.font = '12px ui-monospace, monospace'
    scriptArea.style.minHeight = '210px'
    scriptArea.style.width = '100%'
    scriptArea.style.resize = 'vertical'
    scriptArea.placeholder = `on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {\n  await ui.dialogue({ lines: [{ text: 'Hello.' }] })\n})`
    scriptArea.oninput = () => {
        saveScriptSource(scriptArea.value)
        lastListFingerprint = ''
    }
    scriptArea.onchange = () => {
        saveScriptSource(scriptArea.value)
        refresh()
    }
    scriptSection.appendChild(scriptArea)

    const scriptActions = document.createElement('div')
    scriptActions.className = 'vpe-row'
    const parseBtn = document.createElement('button')
    parseBtn.className = 'vpe-button'
    parseBtn.textContent = 'Parse-check'
    parseBtn.onclick = () => {
        const result = parseCheck(scriptArea.value)
        status.textContent = result.ok ? 'OK - parses cleanly.' : `Parse error: ${result.error}`
        status.style.color = result.ok ? '#9be66f' : '#ff7e7e'
    }
    scriptActions.appendChild(parseBtn)
    scriptSection.appendChild(scriptActions)

    const status = document.createElement('div')
    status.className = 'vpe-hint'
    status.style.minHeight = '16px'
    status.style.fontFamily = 'ui-monospace, monospace'
    status.style.whiteSpace = 'pre-wrap'
    scriptSection.appendChild(status)
    root.appendChild(scriptSection)

    let lastListFingerprint = ''

    function selectedNpc(): NpcConfig | null {
        return state.selectedNpcId
            ? state.npcs.find((npc) => npc.id === state.selectedNpcId) ?? null
            : null
    }

    function updateDraftOrSelected(editNpc: (npc: NpcConfig) => void, editDraft: () => void): void {
        const npc = selectedNpc()
        if (npc) editNpc(npc)
        else editDraft()
        refresh()
    }

    function saveScriptSource(source: string): void {
        const npc = selectedNpc()
        if (npc) npc.scriptSource = source
        else state.npcScriptSource = source
    }

    function updateSelectedId(value: string): void {
        const npc = selectedNpc()
        if (!npc) return
        const next = sanitizeNpcId(value)
        if (!next || next === npc.id) return
        if (state.npcs.some((candidate) => candidate.id === next)) {
            status.textContent = `NPC id "${next}" already exists.`
            status.style.color = '#ff7e7e'
            idField.input.value = npc.id
            return
        }
        npc.id = next
        state.selectedNpcId = next
        refresh()
    }

    function rebuildList(): void {
        const fp = [
            `selected:${state.selectedNpcId ?? ''}`,
            ...state.npcs.map((npc) => `${npc.id}:${npc.name}:${npc.model}:${npc.beard}:${npc.position.x},${npc.position.y},${npc.position.z}:${npc.scale}:${npcEquipmentKey(npc)}:${npc.scriptSource.length}`),
        ].join('|')
        if (fp === lastListFingerprint) return
        lastListFingerprint = fp
        listEl.innerHTML = ''
        if (state.npcs.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'vpe-hint'
            empty.textContent = 'No NPCs placed yet.'
            listEl.appendChild(empty)
            return
        }
        for (const npc of state.npcs) listEl.appendChild(npcRow(npc))
    }

    function npcRow(npc: NpcConfig): HTMLElement {
        const row = document.createElement('div')
        row.className = 'vpe-row'
        row.style.alignItems = 'center'
        if (npc.id === state.selectedNpcId) row.style.color = '#ffd166'

        const label = document.createElement('span')
        label.textContent = `${trimForList(npc.name || npc.id, 14)} · ${NPC_MODEL_LABELS[npc.model]}`
        label.title = `${npc.id} @ ${npc.position.x.toFixed(1)},${npc.position.y.toFixed(1)},${npc.position.z.toFixed(1)}`
        label.style.flex = '1'
        label.style.cursor = 'pointer'
        label.onclick = () => {
            state.selectedNpcId = npc.id
            refresh()
        }

        const duplicate = document.createElement('button')
        duplicate.className = 'vpe-button'
        duplicate.textContent = 'Copy'
        duplicate.onclick = () => {
            const copy = { ...npc, id: nextNpcId(`${npc.id}-copy`), position: { ...npc.position, x: npc.position.x + 1 } }
            state.npcs.push(copy)
            state.selectedNpcId = copy.id
            refresh()
        }

        const del = document.createElement('button')
        del.className = 'vpe-button'
        del.textContent = 'Remove'
        del.onclick = () => {
            const idx = state.npcs.findIndex((candidate) => candidate.id === npc.id)
            if (idx >= 0) state.npcs.splice(idx, 1)
            if (state.selectedNpcId === npc.id) state.selectedNpcId = null
            refresh()
        }

        row.append(label, duplicate, del)
        return row
    }

    function refresh(): void {
        const npc = selectedNpc()
        placeBtn.classList.toggle('active', state.mode === 'place-npc')

        const source = npc ?? draftNpc()
        idField.row.style.display = npc ? 'flex' : 'none'
        syncInputValue(idField.input, npc?.id ?? '')
        syncInputValue(nameField.input, source.name)
        if (document.activeElement !== modelSelect) modelSelect.value = source.model
        if (document.activeElement !== beardSelect) beardSelect.value = source.beard
        gridRow.input.checked = source.gridAligned
        syncInputValue(yawField.input, String(Math.round((source.yaw * 180) / Math.PI)))
        syncInputValue(scaleField.input, String(roundForInput(source.scale)))
        collisionEnabled.input.checked = source.collisionEnabled
        syncInputValue(radiusField.input, String(roundForInput(source.colliderRadius)))
        syncInputValue(heightField.input, String(roundForInput(source.colliderHeight)))
        syncEquipmentSelect(handRSelect.input, source.equipment.handR)
        syncEquipmentSelect(handLSelect.input, source.equipment.handL)
        interactionEnabled.input.checked = source.interactionEnabled
        syncInputValue(promptField.input, source.interactionPrompt)
        syncInputValue(interactionRadius.input, String(roundForInput(source.interactionRadius)))
        scriptEnabled.input.checked = source.scriptEnabled
        syncInputValue(scriptArea, source.scriptSource)
        interactionId.textContent = npc
            ? `Script target: ${npcInteractionZoneId(npc)}`
            : 'Place an NPC to get a stable script target id.'
        rebuildList()
    }

    function draftNpc(): NpcConfig {
        return {
            id: 'draft',
            name: state.npcName || DEFAULT_NPC.name,
            model: state.npcModel,
            beard: state.npcBeard,
            position: { x: 0, y: 0, z: 0 },
            yaw: state.npcYaw,
            scale: state.npcScale,
            gridAligned: state.npcGridAlign,
            collisionEnabled: state.npcCollisionEnabled,
            colliderRadius: state.npcColliderRadius,
            colliderHeight: state.npcColliderHeight,
            interactionEnabled: state.npcInteractionEnabled,
            interactionRadius: state.npcInteractionRadius,
            interactionPrompt: state.npcInteractionPrompt,
            equipment: copyHandLoadout(state.npcEquipment),
            scriptEnabled: state.npcScriptEnabled,
            scriptSource: state.npcScriptSource,
        }
    }

    function currentScriptTarget(): { name: string; avatar: string } {
        const npc = selectedNpc()
        return {
            name: npc?.name || state.npcName || DEFAULT_NPC.name,
            avatar: npc?.model ?? state.npcModel,
        }
    }

    function nextNpcId(base: string): string {
        let rootId = sanitizeNpcId(base)
        if (!state.npcs.some((npc) => npc.id === rootId)) return rootId
        let n = 2
        while (state.npcs.some((npc) => npc.id === `${rootId}-${n}`)) n++
        rootId = `${rootId}-${n}`
        return rootId
    }

    function templateButton(label: string, build: () => string): HTMLButtonElement {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = label
        btn.onclick = () => {
            scriptArea.value = build()
            updateDraftOrSelected((npc) => { npc.scriptSource = scriptArea.value }, () => { state.npcScriptSource = scriptArea.value })
            status.textContent = ''
            refresh()
        }
        return btn
    }

    refresh()
    return { element: root, refresh }
}

function syncInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    if (document.activeElement === input || input.value === value) return
    input.value = value
}

interface TextField {
    row: HTMLElement
    input: HTMLInputElement
}

interface CheckField {
    row: HTMLElement
    input: HTMLInputElement
}

interface NumberField {
    row: HTMLElement
    input: HTMLInputElement
}

function textInput(label: string, placeholder: string, onChange: (value: string) => void): TextField {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const input = document.createElement('input')
    input.className = 'vpe-input'
    input.type = 'text'
    input.placeholder = placeholder
    input.style.flex = '1'
    input.onchange = () => onChange(input.value.trim())
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

function simpleDialogueTemplate(target: { name: string; avatar: string }): string {
    return `on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {
  await ui.dialogue({
    title: ${JSON.stringify(target.name)},
    npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)} },
    player: { id: 'player', name: 'You', avatar: 'player' },
    lines: [
      { speaker: NPC_ID, text: 'Hello, traveler.' },
    ],
  })
})`
}

function choiceDialogueTemplate(target: { name: string; avatar: string }): string {
    return `on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {
  const result = await ui.dialogue({
    title: ${JSON.stringify(target.name)},
    npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)} },
    player: { id: 'player', name: 'You', avatar: 'player' },
    lines: [
      { speaker: NPC_ID, text: 'What do you need?' },
      {
        speaker: NPC_ID,
        text: 'Choose your question.',
        choices: [
          { id: 'quest', text: 'Do you have work?' },
          { id: 'bye', text: 'Goodbye.' },
        ],
      },
    ],
  })
  if (result.choiceId === 'quest') {
    log(\`\${NPC_NAME}: maybe later.\`)
  }
})`
}

function collectionQuestTemplate(target: { name: string; avatar: string }): string {
    return `const QUEST_STATE = \`npc.\${NPC_ID}.quest.state\`
const ITEM_KIND = \`npc-\${NPC_ID}-item\`
const ITEM_ID = \`npc.\${NPC_ID}.quest.item\`

on('input', { action: 'interact', targetId: NPC_INTERACTION }, async () => {
  const state = flags.get(QUEST_STATE) ?? 'unknown'
  if (state === 'unknown') {
    const result = await ui.dialogue({
      title: ${JSON.stringify(target.name)},
      npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)} },
      player: { id: 'player', name: 'You', avatar: 'player' },
      lines: [{
        speaker: NPC_ID,
        text: 'I lost something nearby. Can you bring it back?',
        choices: [
          { id: 'accept', text: 'I will find it.' },
          { id: 'later', text: 'Not now.' },
        ],
      }],
    })
    if (result.choiceId !== 'accept') return
    flags.set(QUEST_STATE, 'active')
    const p = player.getPosition()
    pickups.spawn(ITEM_KIND, { x: p.x + 2, y: p.y, z: p.z }, { id: ITEM_ID, label: 'Quest Item' })
    audio.play('sfx.quest.chime')
    return
  }
  if (state === 'ready') {
    flags.set(QUEST_STATE, 'done')
    pickups.spawn('coin', player.getPosition(), { amount: 25, label: \`\${NPC_NAME}'s reward\` })
    audio.play('sfx.quest.fanfare')
    await ui.dialogue({
      title: ${JSON.stringify(target.name)},
      npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)} },
      player: { id: 'player', name: 'You', avatar: 'player' },
      lines: [{ speaker: NPC_ID, text: 'Thank you. Take this.' }],
    })
  }
})

on('pickup-taken', { kind: ITEM_KIND }, (event) => {
  if (event.pickupId !== ITEM_ID || flags.get(QUEST_STATE) !== 'active') return
  flags.set(QUEST_STATE, 'ready')
  log(\`Return to \${NPC_NAME}.\`)
})`
}

interface ParseSuccess { ok: true }
interface ParseFailure { ok: false; error: string }

function parseCheck(source: string): ParseSuccess | ParseFailure {
    if (!source.trim()) return { ok: false, error: 'Empty script.' }
    try {
        const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => unknown
        new AsyncFunctionCtor('ctx', `"use strict"; const { ${PRELUDE_LOCALS} } = ctx; const NPC_ID = 'npc'; const NPC_NAME = 'NPC'; const NPC_INTERACTION = 'npc.npc.interact'; const NPC_ZONE = NPC_INTERACTION; ${source}`)
        return { ok: true }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
}

function degToRad(degrees: number): number {
    return (degrees * Math.PI) / 180
}

function wrapDegrees(value: number): number {
    if (!Number.isFinite(value)) return 0
    return ((value % 360) + 360) % 360
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}

function roundForInput(value: number): number {
    return Math.round(value * 100) / 100
}

import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import { PRELUDE_LOCALS } from '../../engine/script/compile'
import type { CommandStack } from '../history'
import type { EditorState } from '../editor-state'
import {
    DEFAULT_NPC,
    NPC_MODEL_KINDS,
    NPC_MODEL_LABELS,
    TROLL_OUTFIT_KINDS,
    TROLL_OUTFIT_LABELS,
    defaultNpcBeard,
    defaultNpcEquipment,
    defaultNpcVariant,
    defaultNpcVoice,
    normalizeNpcVariant,
    npcEquipmentKey,
    npcInteractionZoneId,
    sanitizeNpcId,
    type NpcConfig,
    type NpcModelKind,
    type TrollOutfitKind,
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
import {
    DIALOGUE_VOICE_PRESET_CONFIGS,
    DIALOGUE_VOICE_PRESETS,
    synthDialogueVoiceLine,
    type DialogueVoicePreset,
    type DialogueVoiceRef,
} from '../../game/dialogue-voice'
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
                const previousDefault = defaultNpcEquipment(npc.model, npc.variant)
                const wasDefaultEquipment = npcEquipmentKey(npc) === handLoadoutKey(previousDefault)
                const previousDefaultBeard = defaultNpcBeard(npc.model, npc.variant)
                const wasDefaultBeard = npc.beard === previousDefaultBeard
                const wasDefaultVoice = npcVoiceKey(npc.voice) === npcVoiceKey(defaultNpcVoice(npc.model))
                npc.model = model
                npc.variant = defaultNpcVariant(model)
                if (wasDefaultEquipment) npc.equipment = defaultNpcEquipment(model, npc.variant)
                if (wasDefaultBeard) npc.beard = defaultNpcBeard(model, npc.variant)
                if (wasDefaultVoice) npc.voice = defaultNpcVoice(model)
            },
            () => {
                const previousDefault = defaultNpcEquipment(state.npcModel, state.npcVariant)
                const wasDefaultEquipment = handLoadoutKey(state.npcEquipment) === handLoadoutKey(previousDefault)
                const previousDefaultBeard = defaultNpcBeard(state.npcModel, state.npcVariant)
                const wasDefaultBeard = state.npcBeard === previousDefaultBeard
                const wasDefaultVoice = npcVoiceKey(draftVoice()) === npcVoiceKey(defaultNpcVoice(state.npcModel))
                state.npcModel = model
                state.npcVariant = defaultNpcVariant(model)
                if (wasDefaultEquipment) state.npcEquipment = defaultNpcEquipment(model, state.npcVariant)
                if (wasDefaultBeard) state.npcBeard = defaultNpcBeard(model, state.npcVariant)
                if (wasDefaultVoice) applyDraftVoice(defaultNpcVoice(model))
            },
        )
    }
    modelRow.append(modelLabel, modelSelect)
    identitySection.appendChild(modelRow)

    const variantRow = document.createElement('label')
    variantRow.className = 'vpe-field'
    const variantLabel = document.createElement('span')
    variantLabel.className = 'vpe-field-label'
    variantLabel.textContent = 'Troll outfit'
    const variantSelect = document.createElement('select')
    variantSelect.className = 'vpe-input'
    variantSelect.style.flex = '1'
    for (const variant of TROLL_OUTFIT_KINDS) {
        const opt = document.createElement('option')
        opt.value = variant
        opt.textContent = TROLL_OUTFIT_LABELS[variant]
        variantSelect.appendChild(opt)
    }
    variantSelect.onchange = () => {
        const variant = variantSelect.value as TrollOutfitKind
        updateDraftOrSelected(
            (npc) => {
                const nextVariant = normalizeNpcVariant(npc.model, variant)
                const previousDefault = defaultNpcEquipment(npc.model, npc.variant)
                const wasDefaultEquipment = npcEquipmentKey(npc) === handLoadoutKey(previousDefault)
                const previousDefaultBeard = defaultNpcBeard(npc.model, npc.variant)
                const wasDefaultBeard = npc.beard === previousDefaultBeard
                npc.variant = nextVariant
                if (wasDefaultEquipment) npc.equipment = defaultNpcEquipment(npc.model, nextVariant)
                if (wasDefaultBeard) npc.beard = defaultNpcBeard(npc.model, nextVariant)
            },
            () => {
                const nextVariant = normalizeNpcVariant(state.npcModel, variant)
                const previousDefault = defaultNpcEquipment(state.npcModel, state.npcVariant)
                const wasDefaultEquipment = handLoadoutKey(state.npcEquipment) === handLoadoutKey(previousDefault)
                const previousDefaultBeard = defaultNpcBeard(state.npcModel, state.npcVariant)
                const wasDefaultBeard = state.npcBeard === previousDefaultBeard
                state.npcVariant = nextVariant
                if (wasDefaultEquipment) state.npcEquipment = defaultNpcEquipment(state.npcModel, nextVariant)
                if (wasDefaultBeard) state.npcBeard = defaultNpcBeard(state.npcModel, nextVariant)
            },
        )
    }
    variantRow.append(variantLabel, variantSelect)
    identitySection.appendChild(variantRow)

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
            (npc) => { npc.equipment = defaultNpcEquipment(npc.model, npc.variant) },
            () => { state.npcEquipment = defaultNpcEquipment(state.npcModel, state.npcVariant) },
        )
    }
    equipmentSection.append(handRSelect.row, handLSelect.row, resetEquipmentBtn)
    root.appendChild(equipmentSection)

    const voiceSection = sectionEl('Dialogue Voice')
    const voiceEnabled = checkboxInput('Generated voice', true, (checked) => {
        updateDraftOrSelected((npc) => { npc.voice.enabled = checked }, () => { state.npcVoiceEnabled = checked })
    })
    const voicePresetRow = document.createElement('label')
    voicePresetRow.className = 'vpe-field'
    const voicePresetLabel = document.createElement('span')
    voicePresetLabel.className = 'vpe-field-label'
    voicePresetLabel.textContent = 'Preset'
    const voicePresetSelect = document.createElement('select')
    voicePresetSelect.className = 'vpe-input'
    voicePresetSelect.style.flex = '1'
    for (const preset of DIALOGUE_VOICE_PRESETS) {
        const opt = document.createElement('option')
        opt.value = preset
        opt.textContent = DIALOGUE_VOICE_PRESET_CONFIGS[preset].name
        voicePresetSelect.appendChild(opt)
    }
    voicePresetSelect.onchange = () => {
        const preset = voicePresetSelect.value as DialogueVoicePreset
        updateDraftOrSelected(
            (npc) => {
                const previousPreset = npc.voice.preset ?? defaultNpcVoice(npc.model).preset ?? 'dwarf'
                const shouldUsePresetSeed = !npc.voice.seed || npc.voice.seed === defaultSeedForVoicePreset(previousPreset)
                npc.voice.preset = preset
                if (shouldUsePresetSeed) npc.voice.seed = defaultSeedForVoicePreset(preset)
            },
            () => {
                const shouldUsePresetSeed = !state.npcVoiceSeed || state.npcVoiceSeed === defaultSeedForVoicePreset(state.npcVoicePreset)
                state.npcVoicePreset = preset
                if (shouldUsePresetSeed) state.npcVoiceSeed = defaultSeedForVoicePreset(preset)
            },
        )
    }
    voicePresetRow.append(voicePresetLabel, voicePresetSelect)
    const voiceSeedField = textInput('Seed', 'voice-seed', (value) => {
        updateDraftOrSelected((npc) => { npc.voice.seed = value }, () => { state.npcVoiceSeed = value })
    })
    const voiceVolumeField = numberInput('Volume', 0.55, 0, 1, 0.05, (value) => {
        const volume = clamp(value, 0, 1)
        updateDraftOrSelected((npc) => { npc.voice.volume = volume }, () => { state.npcVoiceVolume = volume })
    })
    const voiceRateField = numberInput('Rate', 1, 0.45, 1.85, 0.05, (value) => {
        const rate = clamp(value, 0.45, 1.85)
        updateDraftOrSelected((npc) => { npc.voice.rate = rate }, () => { state.npcVoiceRate = rate })
    })
    const voicePitchField = numberInput('Pitch', 0, -36, 36, 1, (value) => {
        const pitch = clamp(value, -36, 36)
        updateDraftOrSelected((npc) => { npc.voice.pitchOffset = pitch }, () => { state.npcVoicePitchOffset = pitch })
    })
    const voicePreview = document.createElement('button')
    voicePreview.className = 'vpe-button'
    voicePreview.textContent = 'Preview'
    voicePreview.onclick = () => {
        void previewVoice((selectedNpc() ?? draftNpc()).voice, 'The old road remembers every footstep.')
    }
    voiceSection.append(voiceEnabled.row, voicePresetRow, voiceSeedField.row, voiceVolumeField.row, voiceRateField.row, voicePitchField.row, voicePreview)
    root.appendChild(voiceSection)

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
            ...state.npcs.map((npc) => `${npc.id}:${npc.name}:${npc.model}:${npc.variant}:${npc.beard}:${npc.position.x},${npc.position.y},${npc.position.z}:${npc.scale}:${npcEquipmentKey(npc)}:${npcVoiceKey(npc.voice)}:${npc.scriptSource.length}`),
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
        variantRow.style.display = source.model === 'large-troll' ? 'flex' : 'none'
        variantSelect.disabled = source.model !== 'large-troll'
        if (document.activeElement !== variantSelect) variantSelect.value = normalizeNpcVariant(source.model, source.variant) as string
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
        voiceEnabled.input.checked = source.voice.enabled ?? true
        if (document.activeElement !== voicePresetSelect) voicePresetSelect.value = source.voice.preset ?? defaultNpcVoice(source.model).preset ?? 'dwarf'
        syncInputValue(voiceSeedField.input, source.voice.seed ?? '')
        syncInputValue(voiceVolumeField.input, String(roundForInput(source.voice.volume ?? 0.55)))
        syncInputValue(voiceRateField.input, String(roundForInput(source.voice.rate ?? 1)))
        syncInputValue(voicePitchField.input, String(roundForInput(source.voice.pitchOffset ?? 0)))
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
            variant: normalizeNpcVariant(state.npcModel, state.npcVariant),
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
            invulnerable: false,
            equipment: copyHandLoadout(state.npcEquipment),
            voice: draftVoice(),
            scriptEnabled: state.npcScriptEnabled,
            scriptSource: state.npcScriptSource,
        }
    }

    function currentScriptTarget(): { name: string; avatar: string; voice: DialogueVoiceRef } {
        const npc = selectedNpc()
        return {
            name: npc?.name || state.npcName || DEFAULT_NPC.name,
            avatar: npc?.model ?? state.npcModel,
            voice: npc?.voice ?? draftVoice(),
        }
    }

    function draftVoice(): DialogueVoiceRef {
        return {
            enabled: state.npcVoiceEnabled,
            preset: state.npcVoicePreset,
            seed: state.npcVoiceSeed,
            volume: state.npcVoiceVolume,
            rate: state.npcVoiceRate,
            pitchOffset: state.npcVoicePitchOffset,
        }
    }

    function applyDraftVoice(voice: DialogueVoiceRef): void {
        state.npcVoiceEnabled = voice.enabled ?? true
        state.npcVoicePreset = voice.preset ?? 'dwarf'
        state.npcVoiceSeed = voice.seed ?? ''
        state.npcVoiceVolume = voice.volume ?? 0.55
        state.npcVoiceRate = voice.rate ?? 1
        state.npcVoicePitchOffset = voice.pitchOffset ?? 0
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
    npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)}, voice: NPC_VOICE },
    player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
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
    npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)}, voice: NPC_VOICE },
    player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
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
      npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)}, voice: NPC_VOICE },
      player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
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
    const p = player.position
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
      npc: { id: NPC_ID, name: NPC_NAME, avatar: ${JSON.stringify(target.avatar)}, voice: NPC_VOICE },
      player: { id: 'player', name: 'You', avatar: 'player', voice: { preset: 'player' } },
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

let previewAudioContext: AudioContext | null = null

function npcVoiceKey(voice: DialogueVoiceRef | undefined): string {
    return JSON.stringify({
        enabled: voice?.enabled ?? true,
        preset: voice?.preset ?? 'dwarf',
        seed: voice?.seed ?? '',
        volume: voice?.volume ?? 0.55,
        rate: voice?.rate ?? 1,
        pitchOffset: voice?.pitchOffset ?? 0,
    })
}

function defaultSeedForVoicePreset(preset: DialogueVoicePreset | undefined): string {
    return DIALOGUE_VOICE_PRESET_CONFIGS[preset ?? 'dwarf'].seed
}

async function previewVoice(voice: DialogueVoiceRef, text: string): Promise<void> {
    const rendered = synthDialogueVoiceLine(text, voice)
    if (rendered.samples.length === 0) return
    const Ctor = window.AudioContext ?? window.webkitAudioContext
    if (!Ctor) return
    const ctx = previewAudioContext ?? new Ctor()
    previewAudioContext = ctx
    if (ctx.state === 'suspended') await ctx.resume()
    const buffer = ctx.createBuffer(1, rendered.samples.length, rendered.sampleRate)
    buffer.copyToChannel(new Float32Array(rendered.samples), 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = voice.volume ?? 0.55
    source.connect(gain)
    gain.connect(ctx.destination)
    source.start()
}

function parseCheck(source: string): ParseSuccess | ParseFailure {
    if (!source.trim()) return { ok: false, error: 'Empty script.' }
    try {
        const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => unknown
        new AsyncFunctionCtor('ctx', `"use strict"; const { ${PRELUDE_LOCALS} } = ctx; const NPC_ID = 'npc'; const NPC_NAME = 'NPC'; const NPC_INTERACTION = 'npc.npc.interact'; const NPC_ZONE = NPC_INTERACTION; const NPC_VOICE = {}; ${source}`)
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

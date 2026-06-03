import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import { PRELUDE_LOCALS } from '../../engine/script/compile'
import type { CommandStack } from '../history'
import type { EditorState } from '../editor-state'
import {
    DEFAULT_NPC,
    DEFAULT_NPC_BEHAVIOUR,
    NPC_BEHAVIOUR_MODES,
    NPC_BEHAVIOUR_MODE_LABELS,
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
    type NpcBehaviourConfig,
    type NpcBehaviourMode,
    type NpcConfig,
    type NpcModelKind,
    type TrollOutfitKind,
} from '../../game/npcs/npc-types'
import {
    NPC_TEMPLATES,
    applyNpcTemplate,
    choiceDialogueTemplate,
    collectionQuestTemplate,
    simpleDialogueTemplate,
    traderScriptTemplate,
    type NpcTemplate,
} from '../../game/npcs/npc-templates'
import { mergeBehaviourIntoScript } from '../../game/npcs/npc-behaviour-script'
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
import { collapsibleSection, sectionEl, trimForList, type RefreshableElement } from './common'
import { equipmentSelect, syncEquipmentSelect } from './equipment-field'

export interface NpcTabOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    history: CommandStack
}

/** Which behaviour controls a given mode reveals. */
function modeShows(mode: NpcBehaviourMode, field: 'hostile' | 'perception' | 'threat' | 'flee' | 'route'): boolean {
    switch (field) {
        case 'hostile': return mode === 'patrol' || mode === 'guard' || mode === 'hunter'
        case 'perception': return mode !== 'none'
        case 'threat': return mode === 'hunter'
        case 'flee': return mode === 'prey'
        case 'route': return mode === 'patrol' || mode === 'guard' || mode === 'hunter' || mode === 'prey'
    }
}

export function buildNpcTab(opts: NpcTabOptions): RefreshableElement {
    const state = opts.editorState
    const root = document.createElement('div')
    root.style.display = 'flex'
    root.style.flexDirection = 'column'
    root.style.gap = '10px'

    // ── Template + place ────────────────────────────────────────────────
    const templateSection = sectionEl('Start from a template')
    const templateGrid = document.createElement('div')
    templateGrid.className = 'vpe-row'
    templateGrid.style.flexWrap = 'wrap'
    for (const tpl of NPC_TEMPLATES) {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = `${tpl.emoji} ${tpl.label}`
        btn.title = tpl.description
        btn.onclick = () => applyTemplate(tpl)
        templateGrid.appendChild(btn)
    }
    templateSection.appendChild(templateGrid)
    const placeRow = document.createElement('div')
    placeRow.className = 'vpe-row'
    const placeBtn = document.createElement('button')
    placeBtn.className = 'vpe-button'
    placeBtn.textContent = 'Place NPC'
    placeBtn.title = 'LMB places an NPC at the cursor. RMB removes the nearest NPC.'
    placeBtn.onclick = () => {
        state.mode = state.mode === 'place-npc' ? 'select' : 'place-npc'
        refresh()
    }
    placeRow.appendChild(placeBtn)
    templateSection.appendChild(placeRow)
    const placeHint = document.createElement('div')
    placeHint.className = 'vpe-hint'
    placeHint.textContent = 'Pick a template, then Place. Tune behaviour & dialogue below.'
    templateSection.appendChild(placeHint)
    root.appendChild(templateSection)

    // ── NPC list ────────────────────────────────────────────────────────
    const listSection = sectionEl('NPCs')
    const listEl = document.createElement('div')
    listEl.style.display = 'flex'
    listEl.style.flexDirection = 'column'
    listEl.style.gap = '4px'
    listEl.style.maxHeight = '150px'
    listEl.style.overflowY = 'auto'
    listSection.appendChild(listEl)
    root.appendChild(listSection)

    // ── Identity ────────────────────────────────────────────────────────
    const identitySection = sectionEl('Identity')
    const idField = textInput('Id', '', (value) => updateSelectedId(value))
    const nameField = textInput('Name', '', (value) => updateDraftOrSelected((npc) => { npc.name = value || DEFAULT_NPC.name }, () => { state.npcName = value }))
    identitySection.append(idField.row, nameField.row)

    const { row: modelRow, select: modelSelect } = selectField('Model', NPC_MODEL_KINDS, (m) => NPC_MODEL_LABELS[m], (value) => {
        const model = value as NpcModelKind
        updateDraftOrSelected(
            (npc) => {
                const wasDefaultEquipment = npcEquipmentKey(npc) === handLoadoutKey(defaultNpcEquipment(npc.model, npc.variant))
                const wasDefaultBeard = npc.beard === defaultNpcBeard(npc.model, npc.variant)
                const wasDefaultVoice = npcVoiceKey(npc.voice) === npcVoiceKey(defaultNpcVoice(npc.model))
                npc.model = model
                npc.variant = defaultNpcVariant(model)
                if (wasDefaultEquipment) npc.equipment = defaultNpcEquipment(model, npc.variant)
                if (wasDefaultBeard) npc.beard = defaultNpcBeard(model, npc.variant)
                if (wasDefaultVoice) npc.voice = defaultNpcVoice(model)
            },
            () => {
                const wasDefaultEquipment = handLoadoutKey(state.npcEquipment) === handLoadoutKey(defaultNpcEquipment(state.npcModel, state.npcVariant))
                const wasDefaultBeard = state.npcBeard === defaultNpcBeard(state.npcModel, state.npcVariant)
                const wasDefaultVoice = npcVoiceKey(draftVoice()) === npcVoiceKey(defaultNpcVoice(state.npcModel))
                state.npcModel = model
                state.npcVariant = defaultNpcVariant(model)
                if (wasDefaultEquipment) state.npcEquipment = defaultNpcEquipment(model, state.npcVariant)
                if (wasDefaultBeard) state.npcBeard = defaultNpcBeard(model, state.npcVariant)
                if (wasDefaultVoice) applyDraftVoice(defaultNpcVoice(model))
            },
        )
    })
    identitySection.appendChild(modelRow)

    const { row: variantRow, select: variantSelect } = selectField('Troll outfit', TROLL_OUTFIT_KINDS, (v) => TROLL_OUTFIT_LABELS[v], (value) => {
        const variant = value as TrollOutfitKind
        updateDraftOrSelected(
            (npc) => {
                const nextVariant = normalizeNpcVariant(npc.model, variant)
                const wasDefaultEquipment = npcEquipmentKey(npc) === handLoadoutKey(defaultNpcEquipment(npc.model, npc.variant))
                const wasDefaultBeard = npc.beard === defaultNpcBeard(npc.model, npc.variant)
                npc.variant = nextVariant
                if (wasDefaultEquipment) npc.equipment = defaultNpcEquipment(npc.model, nextVariant)
                if (wasDefaultBeard) npc.beard = defaultNpcBeard(npc.model, nextVariant)
            },
            () => {
                const nextVariant = normalizeNpcVariant(state.npcModel, variant)
                const wasDefaultEquipment = handLoadoutKey(state.npcEquipment) === handLoadoutKey(defaultNpcEquipment(state.npcModel, state.npcVariant))
                const wasDefaultBeard = state.npcBeard === defaultNpcBeard(state.npcModel, state.npcVariant)
                state.npcVariant = nextVariant
                if (wasDefaultEquipment) state.npcEquipment = defaultNpcEquipment(state.npcModel, nextVariant)
                if (wasDefaultBeard) state.npcBeard = defaultNpcBeard(state.npcModel, nextVariant)
            },
        )
    })
    identitySection.appendChild(variantRow)

    const { row: beardRow, select: beardSelect } = selectField('Beard', CHARACTER_BEARD_KINDS, (b) => CHARACTER_BEARD_LABELS[b], (value) => {
        const beard = value as CharacterBeardKind
        updateDraftOrSelected((npc) => { npc.beard = beard }, () => { state.npcBeard = beard })
    })
    identitySection.appendChild(beardRow)
    root.appendChild(identitySection)

    // ── Behaviour ───────────────────────────────────────────────────────
    const behaviourSection = sectionEl('Behaviour')
    const { row: modeRow, select: modeSelect } = selectField('Mode', NPC_BEHAVIOUR_MODES, (m) => NPC_BEHAVIOUR_MODE_LABELS[m], (value) => {
        editBehaviour((b) => { b.mode = value as NpcBehaviourMode })
    })
    behaviourSection.appendChild(modeRow)
    const hostileField = checkboxInput('Hostile to player', false, (checked) => editBehaviour((b) => { b.hostileToPlayer = checked }))
    const perceptionField = numberInput('Perception', 8, 0, 40, 1, (value) => editBehaviour((b) => { b.perceptionRadius = clamp(value, 0, 40) }))
    const threatField = numberInput('Pursuit memory (s)', 0, 0, 30, 1, (value) => editBehaviour((b) => { b.threatMemorySeconds = clamp(value, 0, 30) }))
    const fleeField = checkboxInput('Flee threats', false, (checked) => editBehaviour((b) => { b.flee = checked }))
    behaviourSection.append(hostileField.row, perceptionField.row, threatField.row, fleeField.row)

    const routeRow = document.createElement('div')
    routeRow.className = 'vpe-row'
    routeRow.style.alignItems = 'center'
    const routeCount = document.createElement('span')
    routeCount.className = 'vpe-hint'
    routeCount.style.flex = '1'
    const editWaypointsBtn = document.createElement('button')
    editWaypointsBtn.className = 'vpe-button'
    editWaypointsBtn.textContent = 'Edit waypoints'
    editWaypointsBtn.title = 'Drop / drag route nodes in the scene. LMB add · drag to move · RMB remove.'
    editWaypointsBtn.onclick = () => {
        const npc = selectedNpc()
        if (!npc) return
        if (state.mode === 'edit-waypoints') {
            state.mode = 'select'
        } else {
            ensureBehaviourOn(npc)
            state.mode = 'edit-waypoints'
        }
        refresh()
    }
    const clearRouteBtn = document.createElement('button')
    clearRouteBtn.className = 'vpe-button'
    clearRouteBtn.textContent = 'Clear'
    clearRouteBtn.onclick = () => editBehaviour((b) => { b.waypoints = [] })
    routeRow.append(routeCount, editWaypointsBtn, clearRouteBtn)
    behaviourSection.appendChild(routeRow)
    const behaviourHint = document.createElement('div')
    behaviourHint.className = 'vpe-hint'
    behaviourHint.textContent = 'Behaviour is compiled into an editable level-start script (see Advanced ▸ Raw script).'
    behaviourSection.appendChild(behaviourHint)
    root.appendChild(behaviourSection)

    // ── Interaction ─────────────────────────────────────────────────────
    const interactionSection = sectionEl('Interaction & dialogue')
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
    const dialogueTemplateRow = document.createElement('div')
    dialogueTemplateRow.className = 'vpe-row'
    dialogueTemplateRow.style.flexWrap = 'wrap'
    dialogueTemplateRow.append(
        interactionTemplateButton('Simple', () => simpleDialogueTemplate(currentAvatar())),
        interactionTemplateButton('Choices', () => choiceDialogueTemplate(currentAvatar())),
        interactionTemplateButton('Quest', () => collectionQuestTemplate(currentAvatar())),
        interactionTemplateButton('Trade', () => traderScriptTemplate(currentAvatar())),
    )
    const interactionId = document.createElement('div')
    interactionId.className = 'vpe-hint'
    interactionSection.append(interactionEnabled.row, promptField.row, interactionRadius.row, dialogueTemplateRow, interactionId)
    root.appendChild(interactionSection)

    // ── Advanced ────────────────────────────────────────────────────────
    const advanced = collapsibleSection('Advanced')
    root.appendChild(advanced.details)

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
    advanced.body.appendChild(transformSection)

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
    advanced.body.appendChild(collisionSection)

    const equipmentSection = sectionEl('Held items')
    const handRSelect = equipmentSelect('Right hand', (value) => {
        updateDraftOrSelected((npc) => { npc.equipment.handR = value }, () => { state.npcEquipment.handR = value })
    })
    const handLSelect = equipmentSelect('Left hand', (value) => {
        updateDraftOrSelected((npc) => { npc.equipment.handL = value }, () => { state.npcEquipment.handL = value })
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
    advanced.body.appendChild(equipmentSection)

    const essentialSection = sectionEl('Essential flags')
    const invulnerableField = checkboxInput('Invulnerable (ignores all damage)', false, (checked) => {
        updateDraftOrSelected((npc) => { npc.invulnerable = checked }, () => { state.npcInvulnerable = checked })
    })
    const unprovokableField = checkboxInput('Unprovokable (never fights back)', false, (checked) => {
        updateDraftOrSelected((npc) => { npc.unprovokable = checked }, () => { state.npcUnprovokable = checked })
    })
    essentialSection.append(invulnerableField.row, unprovokableField.row)
    advanced.body.appendChild(essentialSection)

    const voiceSection = sectionEl('Dialogue voice')
    const voiceEnabled = checkboxInput('Generated voice', true, (checked) => {
        updateDraftOrSelected((npc) => { npc.voice.enabled = checked }, () => { state.npcVoiceEnabled = checked })
    })
    const { row: voicePresetRow, select: voicePresetSelect } = selectField('Preset', DIALOGUE_VOICE_PRESETS, (p) => DIALOGUE_VOICE_PRESET_CONFIGS[p].name, (value) => {
        const preset = value as DialogueVoicePreset
        updateDraftOrSelected(
            (npc) => {
                const previousPreset = npc.voice.preset ?? defaultNpcVoice(npc.model).preset ?? 'dwarf'
                const usePresetSeed = !npc.voice.seed || npc.voice.seed === defaultSeedForVoicePreset(previousPreset)
                npc.voice.preset = preset
                if (usePresetSeed) npc.voice.seed = defaultSeedForVoicePreset(preset)
            },
            () => {
                const usePresetSeed = !state.npcVoiceSeed || state.npcVoiceSeed === defaultSeedForVoicePreset(state.npcVoicePreset)
                state.npcVoicePreset = preset
                if (usePresetSeed) state.npcVoiceSeed = defaultSeedForVoicePreset(preset)
            },
        )
    })
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
    advanced.body.appendChild(voiceSection)

    const scriptSection = sectionEl('Raw NPC script')
    const scriptEnabled = checkboxInput('Enabled', true, (checked) => {
        updateDraftOrSelected((npc) => { npc.scriptEnabled = checked }, () => { state.npcScriptEnabled = checked })
    })
    scriptSection.appendChild(scriptEnabled.row)
    const scriptArea = document.createElement('textarea')
    scriptArea.className = 'vpe-input'
    scriptArea.spellcheck = false
    scriptArea.style.font = '12px ui-monospace, monospace'
    scriptArea.style.minHeight = '200px'
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
    advanced.body.appendChild(scriptSection)

    let lastListFingerprint = ''

    // ── helpers ─────────────────────────────────────────────────────────
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

    function currentBehaviour(): NpcBehaviourConfig | undefined {
        const npc = selectedNpc()
        return npc ? npc.behaviour : state.npcBehaviour
    }

    function ensureBehaviourOn(npc: NpcConfig): NpcBehaviourConfig {
        if (!npc.behaviour || npc.behaviour.mode === 'none') {
            npc.behaviour = { ...DEFAULT_NPC_BEHAVIOUR, mode: 'patrol', waypoints: npc.behaviour?.waypoints ?? [] }
        }
        return npc.behaviour
    }

    /** Edit the draft/selected behaviour, then recompile the script region. */
    function editBehaviour(edit: (b: NpcBehaviourConfig) => void): void {
        const cur = currentBehaviour() ?? { ...DEFAULT_NPC_BEHAVIOUR }
        const next: NpcBehaviourConfig = { ...cur, waypoints: cur.waypoints.map((p) => ({ ...p })) }
        edit(next)
        const npc = selectedNpc()
        if (npc) {
            npc.behaviour = next
            npc.scriptSource = mergeBehaviourIntoScript(npc.scriptSource, next)
        } else {
            state.npcBehaviour = next
            state.npcScriptSource = mergeBehaviourIntoScript(state.npcScriptSource, next)
        }
        refresh()
    }

    function applyTemplate(tpl: NpcTemplate): void {
        const npc = selectedNpc()
        if (npc) {
            const next = applyNpcTemplate(npc, tpl)
            next.scriptSource = mergeBehaviourIntoScript(next.scriptSource, next.behaviour)
            Object.assign(npc, next)
        } else {
            const result = applyNpcTemplate({ ...draftNpc(), id: 'draft', position: { x: 0, y: 0, z: 0 } }, tpl)
            result.scriptSource = mergeBehaviourIntoScript(result.scriptSource, result.behaviour)
            loadConfigIntoDraft(result)
        }
        status.textContent = ''
        refresh()
    }

    function loadConfigIntoDraft(c: NpcConfig): void {
        state.npcName = c.name
        state.npcModel = c.model
        state.npcVariant = c.variant
        state.npcBeard = c.beard
        state.npcGridAlign = c.gridAligned
        state.npcYaw = c.yaw
        state.npcScale = c.scale
        state.npcCollisionEnabled = c.collisionEnabled
        state.npcColliderRadius = c.colliderRadius
        state.npcColliderHeight = c.colliderHeight
        state.npcInteractionEnabled = c.interactionEnabled
        state.npcInteractionRadius = c.interactionRadius
        state.npcInteractionPrompt = c.interactionPrompt
        state.npcInvulnerable = c.invulnerable
        state.npcUnprovokable = c.unprovokable ?? false
        state.npcEquipment = copyHandLoadout(c.equipment)
        applyDraftVoice(c.voice)
        state.npcScriptEnabled = c.scriptEnabled
        state.npcScriptSource = c.scriptSource
        state.npcBehaviour = c.behaviour
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

    function currentAvatar(): string {
        return selectedNpc()?.model ?? state.npcModel
    }

    function interactionTemplateButton(label: string, build: () => string): HTMLButtonElement {
        const btn = document.createElement('button')
        btn.className = 'vpe-button'
        btn.textContent = label
        btn.title = `Fill the interaction script with a ${label.toLowerCase()} starter (keeps the behaviour block).`
        btn.onclick = () => {
            const custom = build()
            const merged = mergeBehaviourIntoScript(custom, currentBehaviour())
            saveScriptSource(merged)
            advanced.details.open = true
            status.textContent = ''
            refresh()
        }
        return btn
    }

    function rebuildList(): void {
        const fp = [
            `selected:${state.selectedNpcId ?? ''}`,
            ...state.npcs.map((npc) => `${npc.id}:${npc.name}:${npc.model}:${npc.variant}:${npc.beard}:${npc.position.x},${npc.position.y},${npc.position.z}:${npc.scale}:${npcEquipmentKey(npc)}:${npcVoiceKey(npc.voice)}:${npc.scriptSource.length}:${npc.behaviour?.waypoints.length ?? -1}`),
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
            if (state.mode === 'edit-waypoints') state.mode = 'select'
            refresh()
        }
        const duplicate = document.createElement('button')
        duplicate.className = 'vpe-button'
        duplicate.textContent = 'Copy'
        duplicate.onclick = () => {
            const copy: NpcConfig = {
                ...npc,
                id: nextNpcId(`${npc.id}-copy`),
                position: { ...npc.position, x: npc.position.x + 1 },
                equipment: copyHandLoadout(npc.equipment),
                voice: { ...npc.voice },
                behaviour: npc.behaviour ? { ...npc.behaviour, waypoints: npc.behaviour.waypoints.map((p) => ({ ...p })) } : undefined,
            }
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

        // Behaviour
        const mode = source.behaviour?.mode ?? 'none'
        if (document.activeElement !== modeSelect) modeSelect.value = mode
        hostileField.row.style.display = modeShows(mode, 'hostile') ? 'flex' : 'none'
        perceptionField.row.style.display = modeShows(mode, 'perception') ? 'flex' : 'none'
        threatField.row.style.display = modeShows(mode, 'threat') ? 'flex' : 'none'
        fleeField.row.style.display = modeShows(mode, 'flee') ? 'flex' : 'none'
        routeRow.style.display = modeShows(mode, 'route') ? 'flex' : 'none'
        hostileField.input.checked = source.behaviour?.hostileToPlayer ?? false
        syncInputValue(perceptionField.input, String(roundForInput(source.behaviour?.perceptionRadius ?? DEFAULT_NPC_BEHAVIOUR.perceptionRadius)))
        syncInputValue(threatField.input, String(roundForInput(source.behaviour?.threatMemorySeconds ?? 0)))
        fleeField.input.checked = source.behaviour?.flee ?? false
        const wp = source.behaviour?.waypoints.length ?? 0
        routeCount.textContent = `Route: ${wp} point${wp === 1 ? '' : 's'}`
        editWaypointsBtn.disabled = !npc
        editWaypointsBtn.classList.toggle('active', state.mode === 'edit-waypoints')
        editWaypointsBtn.title = npc
            ? 'Drop / drag route nodes in the scene. LMB add · drag to move · RMB remove.'
            : 'Place the NPC first — waypoints are world positions.'

        // Interaction
        interactionEnabled.input.checked = source.interactionEnabled
        syncInputValue(promptField.input, source.interactionPrompt)
        syncInputValue(interactionRadius.input, String(roundForInput(source.interactionRadius)))
        interactionId.textContent = npc
            ? `Script target: ${npcInteractionZoneId(npc)}`
            : 'Place an NPC to get a stable script target id.'

        // Advanced
        gridRow.input.checked = source.gridAligned
        syncInputValue(yawField.input, String(Math.round((source.yaw * 180) / Math.PI)))
        syncInputValue(scaleField.input, String(roundForInput(source.scale)))
        collisionEnabled.input.checked = source.collisionEnabled
        syncInputValue(radiusField.input, String(roundForInput(source.colliderRadius)))
        syncInputValue(heightField.input, String(roundForInput(source.colliderHeight)))
        syncEquipmentSelect(handRSelect.input, source.equipment.handR)
        syncEquipmentSelect(handLSelect.input, source.equipment.handL)
        invulnerableField.input.checked = source.invulnerable
        unprovokableField.input.checked = source.unprovokable ?? false
        voiceEnabled.input.checked = source.voice.enabled ?? true
        if (document.activeElement !== voicePresetSelect) voicePresetSelect.value = source.voice.preset ?? defaultNpcVoice(source.model).preset ?? 'dwarf'
        syncInputValue(voiceSeedField.input, source.voice.seed ?? '')
        syncInputValue(voiceVolumeField.input, String(roundForInput(source.voice.volume ?? 0.55)))
        syncInputValue(voiceRateField.input, String(roundForInput(source.voice.rate ?? 1)))
        syncInputValue(voicePitchField.input, String(roundForInput(source.voice.pitchOffset ?? 0)))
        scriptEnabled.input.checked = source.scriptEnabled
        syncInputValue(scriptArea, source.scriptSource)

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
            invulnerable: state.npcInvulnerable,
            unprovokable: state.npcUnprovokable,
            equipment: copyHandLoadout(state.npcEquipment),
            voice: draftVoice(),
            scriptEnabled: state.npcScriptEnabled,
            scriptSource: state.npcScriptSource,
            behaviour: state.npcBehaviour,
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

    refresh()
    return { element: root, refresh }
}

// ─── small generic field builders ────────────────────────────────────────────

interface Field { row: HTMLElement; input: HTMLInputElement }

function selectField<T extends string>(
    label: string,
    options: readonly T[],
    labelOf: (value: T) => string,
    onChange: (value: string) => void,
): { row: HTMLElement; select: HTMLSelectElement } {
    const row = document.createElement('label')
    row.className = 'vpe-field'
    const labelEl = document.createElement('span')
    labelEl.className = 'vpe-field-label'
    labelEl.textContent = label
    const select = document.createElement('select')
    select.className = 'vpe-input'
    select.style.flex = '1'
    for (const value of options) {
        const opt = document.createElement('option')
        opt.value = value
        opt.textContent = labelOf(value)
        select.appendChild(opt)
    }
    select.onchange = () => onChange(select.value)
    row.append(labelEl, select)
    return { row, select }
}

function syncInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    if (document.activeElement === input || input.value === value) return
    input.value = value
}

function textInput(label: string, placeholder: string, onChange: (value: string) => void): Field {
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

function checkboxInput(label: string, checked: boolean, onChange: (checked: boolean) => void): Field {
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
): Field {
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

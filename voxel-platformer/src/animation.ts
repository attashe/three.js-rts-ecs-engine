// Standalone Animation page — preview + tuning for the character rigs. Kept off
// the editor (which is already feature-dense). Pick a model, drive its state
// machine live with movement params, or scrub individual clips, and try
// equipment on the sockets.

import { AmbientLight, Clock, Color, DirectionalLight, GridHelper, MOUSE, type Object3D } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Renderer } from './engine/render/renderer'
import {
    AnimationController,
    attachToSocket,
    detachFromSocket,
    partRigSource,
    referenceRigSource,
    type ClipSet,
    type ClipSource,
    type EquipSlot,
} from './engine/anim'
import { computeLocomotionParams, type AnimGraphDef } from './engine/anim/core'
import { combatLocomotionGraph, locomotionGraph } from './game/anim/graph-defaults'
import { playerProfile } from './game/anim/character-profiles'
import { partCharacterClips } from './game/anim/part-clips'
import { preloadCharacterModels } from './game/anim/model-registry'
import {
    EQUIPMENT_LABELS,
    HAND_EQUIPMENT_KINDS,
    HEAD_EQUIPMENT_KINDS,
    createEquipment,
    equipmentSocketFrame,
    type EquipmentKind,
} from './game/anim/equipment'
import { createNpcModel } from './game/npcs/npc-models'
import {
    NPC_MODEL_KINDS,
    NPC_MODEL_LABELS,
    TROLL_OUTFIT_KINDS,
    TROLL_OUTFIT_LABELS,
    type NpcModelKind,
    type TrollOutfitKind,
} from './game/npcs/npc-types'
import {
    CHARACTER_BEARD_KINDS,
    CHARACTER_BEARD_LABELS,
    CHARACTER_CLOAK_KINDS,
    CHARACTER_CLOAK_LABELS,
    type CharacterBeardKind,
    type CharacterCloakKind,
} from './game/character-appearance'

interface PreviewProfile {
    id: string
    label: string
    graph: AnimGraphDef
    buildSource: (appearance: PreviewAppearance) => ClipSource
    supportsBeard: boolean
    supportsCloak: boolean
    modelKind?: NpcModelKind
}

interface PreviewAppearance {
    beard: CharacterBeardKind
    cloak: CharacterCloakKind
    trollOutfit: TrollOutfitKind
}

interface SlotSelect {
    slot: EquipSlot
    row: HTMLLabelElement
    input: HTMLSelectElement
}

type SlotValue = EquipmentKind | null

async function main(): Promise<void> {
    const errorEl = el('error')
    try {
        const renderer = new Renderer()
        renderer.scene.background = new Color(0x141b20)
        renderer.iso.setViewMode('orbit')
        await renderer.init()

        renderer.scene.add(new AmbientLight(0xffffff, 0.6))
        const sun = new DirectionalLight(0xfff1d2, 1.5)
        sun.position.set(6, 10, 5)
        sun.castShadow = true
        renderer.scene.add(sun)
        renderer.scene.add(new DirectionalLight(0x8eb6ff, 0.3).translateX(-6))
        const grid = new GridHelper(12, 12, 0x2a3a30, 0x1c2620)
        renderer.scene.add(grid)

        const controls = new OrbitControls(renderer.iso.camera, renderer.webgpu.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.08
        controls.target.set(0, 0.9, 0)
        controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
        renderer.iso.camera.position.set(3.2, 1.6, 3.2)

        await preloadCharacterModels()
        const profiles = buildProfiles()

        // ── live state ──────────────────────────────────────────────────────
        let controller: AnimationController | null = null
        let clipSet: ClipSet | null = null
        let mode: 'drive' | 'clips' = 'drive'
        let activeClip = ''
        let currentProfile: PreviewProfile = profiles[0]!
        const appearance: PreviewAppearance = { beard: 'none', cloak: 'default', trollOutfit: 'wise' }
        const equipState = new Map<EquipSlot, EquipmentKind>()
        const equipped = new Map<EquipSlot, Object3D>()

        function setProfile(p: PreviewProfile): void {
            const previousClip = activeClip
            currentProfile = p
            if (controller) {
                renderer.scene.remove(controller.root)
                controller.dispose()
            }
            equipped.clear()
            clipSet = p.buildSource(effectiveAppearance(p)).instantiate()
            controller = new AnimationController(clipSet, p.graph)
            renderer.scene.add(controller.root)
            for (const [slot, kind] of equipState) attach(slot, kind)
            activeClip = previousClip && clipSet.clips.has(previousClip)
                ? previousClip
                : [...clipSet.clips.keys()][0] ?? ''
            rebuildClipButtons()
            refreshAppearanceControls()
            syncSlotControls()
            if (mode === 'clips' && activeClip) controller.playStateImmediate(activeClip)
        }

        function attach(slot: EquipSlot, kind: EquipmentKind): void {
            if (!controller) return
            const item = createEquipment(kind)
            const frame = equipmentSocketFrame(kind, slot)
            if (attachToSocket(controller.sockets, slot, item, {
                root: controller.root,
                orient: frame.orient,
                offset: frame.offset,
            })) equipped.set(slot, item)
        }

        function clearSlot(slot: EquipSlot): void {
            const item = equipped.get(slot)
            if (item) detachFromSocket(item)
            equipped.delete(slot)
            equipState.delete(slot)
        }
        function setSlot(slot: EquipSlot, kind: SlotValue): void {
            clearSlot(slot)
            if (kind) {
                equipState.set(slot, kind)
                attach(slot, kind)
            }
            syncSlotControls()
        }

        function effectiveAppearance(profile: PreviewProfile): PreviewAppearance {
            return {
                beard: profile.supportsBeard ? appearance.beard : 'none',
                cloak: profile.supportsCloak && !(profile.modelKind === 'large-troll' && appearance.trollOutfit === 'guardian')
                    ? appearance.cloak
                    : 'none',
                trollOutfit: appearance.trollOutfit,
            }
        }

        // ── UI wiring ───────────────────────────────────────────────────────
        const profileSel = el('profile') as HTMLSelectElement
        for (const p of profiles) {
            const opt = document.createElement('option')
            opt.value = p.id
            opt.textContent = p.label
            profileSel.appendChild(opt)
        }
        profileSel.addEventListener('change', () => {
            const p = profiles.find((x) => x.id === profileSel.value)
            if (p) setProfile(p)
        })

        const appearanceWrap = el('appearance')
        const beardField = selectField<CharacterBeardKind>('Beard', CHARACTER_BEARD_KINDS, CHARACTER_BEARD_LABELS, (value) => {
            appearance.beard = value
            setProfile(currentProfile)
        })
        const cloakField = selectField<CharacterCloakKind>('Cloak', CHARACTER_CLOAK_KINDS, CHARACTER_CLOAK_LABELS, (value) => {
            appearance.cloak = value
            setProfile(currentProfile)
        })
        const outfitField = selectField<TrollOutfitKind>('Troll outfit', TROLL_OUTFIT_KINDS, TROLL_OUTFIT_LABELS, (value) => {
            appearance.trollOutfit = value
            setProfile(currentProfile)
        })
        appearanceWrap.append(beardField.row, cloakField.row, outfitField.row)

        const slotControls: SlotSelect[] = [
            slotSelect('head', 'Hat', HEAD_EQUIPMENT_KINDS),
            slotSelect('handR', 'Right hand', HAND_EQUIPMENT_KINDS),
            slotSelect('handL', 'Left hand', HAND_EQUIPMENT_KINDS),
        ]
        const slotsWrap = el('slots')
        for (const control of slotControls) slotsWrap.appendChild(control.row)

        function slotSelect(slot: EquipSlot, label: string, kinds: readonly EquipmentKind[]): SlotSelect {
            const row = document.createElement('label')
            row.className = 'row'
            const text = document.createElement('span')
            text.textContent = label
            const input = document.createElement('select')
            input.appendChild(option('', 'None'))
            for (const kind of kinds) input.appendChild(option(kind, EQUIPMENT_LABELS[kind]))
            input.addEventListener('change', () => {
                setSlot(slot, input.value === '' ? null : input.value as EquipmentKind)
            })
            row.append(text, input)
            return { slot, row, input }
        }

        function syncSlotControls(): void {
            for (const control of slotControls) {
                if (document.activeElement === control.input) continue
                control.input.value = equipState.get(control.slot) ?? ''
            }
        }

        function refreshAppearanceControls(): void {
            const canTrollOutfit = currentProfile.modelKind === 'large-troll'
            const canCloak = currentProfile.supportsCloak && !(canTrollOutfit && appearance.trollOutfit === 'guardian')
            beardField.row.style.display = currentProfile.supportsBeard ? 'flex' : 'none'
            cloakField.row.style.display = currentProfile.supportsCloak ? 'flex' : 'none'
            outfitField.row.style.display = canTrollOutfit ? 'flex' : 'none'
            beardField.input.disabled = !currentProfile.supportsBeard
            cloakField.input.disabled = !canCloak
            outfitField.input.disabled = !canTrollOutfit
            if (document.activeElement !== beardField.input) beardField.input.value = appearance.beard
            if (document.activeElement !== cloakField.input) cloakField.input.value = canCloak ? appearance.cloak : 'none'
            if (document.activeElement !== outfitField.input) outfitField.input.value = appearance.trollOutfit
        }

        const driveEl = el('drive')
        const clipsEl = el('clips')
        const driveTab = el('mode-drive')
        const clipsTab = el('mode-clips')
        function setMode(next: 'drive' | 'clips'): void {
            mode = next
            driveEl.style.display = next === 'drive' ? '' : 'none'
            clipsEl.style.display = next === 'clips' ? '' : 'none'
            driveTab.classList.toggle('active', next === 'drive')
            clipsTab.classList.toggle('active', next === 'clips')
            if (next === 'clips' && controller && activeClip) controller.playStateImmediate(activeClip)
            // Re-arm locomotion: clips mode may have parked the machine in a
            // terminal state (die/dead) that the drive loop can't transition out
            // of, which looked like "stuck falling/collapsed" on switch-back.
            if (next === 'drive' && controller) controller.playStateImmediate('idle')
        }
        driveTab.addEventListener('click', () => setMode('drive'))
        clipsTab.addEventListener('click', () => setMode('clips'))

        const clipBtns = el('clip-btns')
        const scrub = el('scrub') as HTMLInputElement
        function rebuildClipButtons(): void {
            clipBtns.innerHTML = ''
            if (!clipSet) return
            for (const name of clipSet.clips.keys()) {
                const btn = document.createElement('button')
                btn.textContent = name
                btn.classList.toggle('active', name === activeClip)
                btn.addEventListener('click', () => {
                    activeClip = name
                    for (const c of clipBtns.children) c.classList.toggle('active', c === btn)
                    if (controller) controller.playStateImmediate(name)
                    scrub.value = '0'
                })
                clipBtns.appendChild(btn)
            }
        }
        scrub.addEventListener('input', () => {
            if (mode === 'clips' && controller && activeClip) controller.scrub(activeClip, Number(scrub.value))
        })

        const speedEl = el('speed') as HTMLInputElement
        const vyEl = el('vy') as HTMLInputElement
        const groundedEl = el('grounded') as HTMLInputElement
        const blockedEl = el('blocked') as HTMLInputElement
        const stateEl = el('state')
        const blendEl = el('blend')

        setProfile(profiles[0]!)

        // ── loop ────────────────────────────────────────────────────────────
        const clock = new Clock()
        function frame(): void {
            const dt = Math.min(clock.getDelta(), 0.05)
            if (controller) {
                if (mode === 'drive') {
                    const speed = Number(speedEl.value)
                    const vy = Number(vyEl.value)
                    // `grounded` is authoritative: checked → on the ground (vy is
                    // ignored, so it never sticks in jump while grounded). Uncheck
                    // it to go airborne, where vy selects jump (vy ≥ 0.5) vs fall.
                    const grounded = groundedEl.checked
                    controller.setParams(computeLocomotionParams({
                        speedXZ: speed,
                        vy,
                        grounded,
                        blocked: blockedEl.checked,
                        movementState: grounded ? (speed > 0.5 ? 1 : 0) : 2,
                    }))
                    controller.setLocomotionSpeed(speed)
                    controller.update(dt)
                } else {
                    controller.advance(dt)
                }
                stateEl.textContent = controller.machine.currentStateId
                blendEl.textContent = controller.machine.blendAlpha.toFixed(2)
            }
            controls.update()
            renderer.render()
            requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
    } catch (err) {
        errorEl.textContent = `Animation preview failed:\n${err instanceof Error ? err.stack ?? err.message : String(err)}`
    }
}

function buildProfiles(): PreviewProfile[] {
    const profiles: PreviewProfile[] = [
        {
            id: 'player',
            label: 'Player',
            graph: combatLocomotionGraph(),
            buildSource: (appearance) => playerProfile('player', { beard: appearance.beard, cloak: appearance.cloak }).clipSource,
            supportsBeard: true,
            supportsCloak: true,
        },
    ]
    // Every authored NPC model (keeper, player-NPC, large troll), each driven by
    // the part rig + combat graph — so the troll and the full keeper (staff,
    // lantern, beard) preview here, not just the bare player silhouette.
    for (const kind of NPC_MODEL_KINDS) {
        if (kind === 'player') continue // identical to the Player profile above
        profiles.push({
            id: `npc:${kind}`,
            label: NPC_MODEL_LABELS[kind],
            graph: combatLocomotionGraph(),
            buildSource: (appearance) => partRigSource(
                () => createNpcModel(kind, {
                    beard: appearance.beard,
                    variant: kind === 'large-troll' ? appearance.trollOutfit : undefined,
                    cloak: appearance.cloak,
                }),
                partCharacterClips(),
            ),
            supportsBeard: true,
            supportsCloak: kind !== 'keeper-arlen',
            modelKind: kind,
        })
    }
    profiles.push({
        id: 'reference',
        label: 'Reference rig (code)',
        graph: locomotionGraph(),
        buildSource: () => referenceRigSource({}),
        supportsBeard: false,
        supportsCloak: false,
    })
    return profiles
}

function el(id: string): HTMLElement {
    const node = document.getElementById(id)
    if (!node) throw new Error(`missing element #${id}`)
    return node
}

function option(value: string, label: string): HTMLOptionElement {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = label
    return opt
}

function selectField<T extends string>(
    label: string,
    values: readonly T[],
    labels: Record<T, string>,
    onChange: (value: T) => void,
): { row: HTMLLabelElement; input: HTMLSelectElement } {
    const row = document.createElement('label')
    row.className = 'row'
    const text = document.createElement('span')
    text.textContent = label
    const input = document.createElement('select')
    for (const value of values) input.appendChild(option(value, labels[value]))
    input.addEventListener('change', () => onChange(input.value as T))
    row.append(text, input)
    return { row, input }
}

void main()

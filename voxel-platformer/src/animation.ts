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
    referenceRigSource,
    type ClipSet,
    type ClipSource,
    type EquipSlot,
} from './engine/anim'
import { computeLocomotionParams, type AnimGraphDef } from './engine/anim/core'
import { locomotionGraph } from './game/anim/graph-defaults'
import { playerProfile } from './game/anim/character-profiles'
import { preloadCharacterModels } from './game/anim/model-registry'
import { createEquipment, type EquipmentKind } from './game/anim/equipment'

interface PreviewProfile {
    id: string
    label: string
    graph: AnimGraphDef
    source: ClipSource
}

const EQUIP_BUTTONS: Array<{ slot: EquipSlot; kind: EquipmentKind; label: string }> = [
    { slot: 'head', kind: 'hat', label: 'Hat' },
    { slot: 'handR', kind: 'sword', label: 'Sword' },
    { slot: 'handL', kind: 'shield', label: 'Shield' },
]

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
        const equipState = new Map<EquipSlot, EquipmentKind>()
        const equipped = new Map<EquipSlot, Object3D>()

        function setProfile(p: PreviewProfile): void {
            if (controller) {
                renderer.scene.remove(controller.root)
                controller.dispose()
            }
            equipped.clear()
            clipSet = p.source.instantiate()
            controller = new AnimationController(clipSet, p.graph)
            renderer.scene.add(controller.root)
            for (const [slot, kind] of equipState) attach(slot, kind)
            activeClip = [...clipSet.clips.keys()][0] ?? ''
            rebuildClipButtons()
        }

        function attach(slot: EquipSlot, kind: EquipmentKind): void {
            if (!controller) return
            const item = createEquipment(kind)
            if (attachToSocket(controller.sockets, slot, item, { root: controller.root })) equipped.set(slot, item)
        }

        function toggleEquip(slot: EquipSlot, kind: EquipmentKind, btn: HTMLButtonElement): void {
            if (equipState.has(slot)) {
                const item = equipped.get(slot)
                if (item) detachFromSocket(item)
                equipped.delete(slot)
                equipState.delete(slot)
                btn.classList.remove('active')
            } else {
                equipState.set(slot, kind)
                attach(slot, kind)
                btn.classList.add('active')
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

        const equipWrap = el('equip')
        for (const { slot, kind, label } of EQUIP_BUTTONS) {
            const btn = document.createElement('button')
            btn.textContent = label
            btn.addEventListener('click', () => toggleEquip(slot, kind, btn))
            equipWrap.appendChild(btn)
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
                    const grounded = groundedEl.checked
                    controller.setParams(computeLocomotionParams({
                        speedXZ: speed,
                        vy: Number(vyEl.value),
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
    const pp = playerProfile('player')
    const kp = playerProfile('keeper')
    return [
        { id: 'player', label: 'Player (Blender glb)', graph: pp.graph, source: pp.clipSource },
        { id: 'keeper', label: 'Keeper (code rig)', graph: kp.graph, source: kp.clipSource },
        { id: 'reference', label: 'Reference rig (code)', graph: locomotionGraph(), source: referenceRigSource({}) },
    ]
}

function el(id: string): HTMLElement {
    const node = document.getElementById(id)
    if (!node) throw new Error(`missing element #${id}`)
    return node
}

void main()

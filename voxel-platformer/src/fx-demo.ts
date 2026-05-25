import {
    ACESFilmicToneMapping,
    BoxGeometry,
    Clock,
    Color,
    InstancedMesh,
    MathUtils,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Raycaster,
    Scene,
    Vector2,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import {
    WeatherSystem,
    WEATHER_PRESETS,
    type WeatherZone,
    type WeatherZoneParams,
} from './engine/fx'
import { TemplateStore } from './fx-demo/template-store'
import { mountPalette } from './fx-demo/palette-panel'
import { mountConstructor, type ConstructorHandle } from './fx-demo/constructor-panel'

/**
 * Demo orchestrator. Sets up the WebGPU scene, drives the FX system,
 * and wires together three independent UI panels:
 *
 *   - Ambient weather (preset buttons + sliders)
 *   - Templates palette  (clickable cards, custom templates persist)
 *   - Constructor       (form that edits either a template or a live
 *                         zone — same fields, different commit path)
 *   - Active zones list (placed zones with click-to-select)
 *
 * Selecting anywhere — palette card, zones list, viewport raycast —
 * points the constructor at the new target. Edits in zone mode flow
 * straight to `fx.updateZone` for true live editing.
 */

async function main(): Promise<void> {
    if (!('gpu' in navigator) || (navigator as Navigator & { gpu?: GPU }).gpu == null) {
        document.body.innerHTML = '<p style="margin: 24px; color: #ff9090;">WebGPU is not available in this browser. Try recent Chrome / Edge / Firefox.</p>'
        return
    }

    const scene = new Scene()
    const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 400)
    camera.position.set(24, 18, 24)

    const renderer = new WebGPURenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = false
    // ACES is what lets HDR emissive (lava core, sun glints) actually
    // bloom into a "glowing" highlight instead of flat-clipping to
    // white. Without this, anything > 1.0 looks identical to 1.0.
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    document.body.appendChild(renderer.domElement)
    await renderer.init()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 2
    controls.maxDistance = 140
    controls.target.set(0, 1, 0)

    buildReferenceWorld(scene)

    const fx = new WeatherSystem(scene, { maxLights: 8, cullDistance: 120 })
    fx.setAmbient(WEATHER_PRESETS.clear!.apply)

    const transform = new TransformControls(camera, renderer.domElement)
    transform.addEventListener('dragging-changed', (ev) => { controls.enabled = !ev.value })
    scene.add(transform.getHelper())

    const panel = mountUi(fx, () => targetPos(controls), scene, camera, renderer.domElement, transform)

    let paused = false
    window.addEventListener('keydown', (ev) => {
        if (ev.code === 'Space') { paused = !paused; return }
        if (ev.code === 'KeyR') { fx.triggerExplosion(targetPos(controls)); return }
        const numKey = parseInt(ev.key, 10)
        if (!Number.isFinite(numKey)) return
        const presets = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'dawn'] as const
        const id = presets[numKey - 1]
        if (id) panel.applyWeather(id)
    })

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
    })

    const clock = new Clock()
    const frameTimes: number[] = []
    const fpsEl = document.getElementById('fps')!
    const frameEl = document.getElementById('frame')!
    const zoneCountEl = document.getElementById('zoneCount')!

    function frame(): void {
        const dt = Math.min(0.1, clock.getDelta())
        if (!paused) fx.update(dt, camera)
        controls.update()
        try { renderer.render(scene, camera) }
        catch (err) { console.error('Render error:', err) }

        frameTimes.push(dt)
        if (frameTimes.length > 30) frameTimes.shift()
        const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
        fpsEl.textContent = (1 / Math.max(avg, 0.0001)).toFixed(0)
        frameEl.textContent = `${(avg * 1000).toFixed(1)}ms`
        zoneCountEl.textContent = String(panel.activeCount())
        requestAnimationFrame(frame)
    }
    frame()
}

function targetPos(controls: OrbitControls): { x: number; y: number; z: number } {
    return { x: controls.target.x, y: controls.target.y, z: controls.target.z }
}

function buildReferenceWorld(scene: Scene): void {
    const ground = new Mesh(
        new PlaneGeometry(200, 200),
        new MeshStandardMaterial({ color: new Color('#2a3140'), roughness: 0.95 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.5
    scene.add(ground)

    const palette = [new Color('#4a5566'), new Color('#3a4250')]
    const tiles = 12
    const tileSize = 2
    const count = tiles * tiles
    const geo = new BoxGeometry(tileSize, 0.5, tileSize)
    const mat = new MeshStandardMaterial({ vertexColors: false, roughness: 0.8 })
    const mesh = new InstancedMesh(geo, mat, count)
    const dummy = new Object3D()
    const color = new Color()
    for (let i = 0; i < count; i++) {
        const x = (i % tiles) - tiles / 2
        const z = Math.floor(i / tiles) - tiles / 2
        dummy.position.set(x * tileSize + tileSize / 2, 0, z * tileSize + tileSize / 2)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        color.copy(palette[(x + z + 100) % 2]!)
        mesh.setColorAt(i, color)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    scene.add(mesh)

    const pillarMat = new MeshStandardMaterial({ color: new Color('#5d6b80'), roughness: 0.75 })
    for (let i = 0; i < 6; i++) {
        const h = MathUtils.randFloat(3, 7)
        const pillar = new Mesh(new BoxGeometry(2, h, 2), pillarMat)
        const ang = (i / 6) * Math.PI * 2
        pillar.position.set(Math.cos(ang) * 14, h / 2, Math.sin(ang) * 14)
        scene.add(pillar)
    }
}

interface PanelHandle {
    activeCount(): number
    applyWeather(id: keyof typeof WEATHER_PRESETS): void
}

interface DemoZone {
    zone: WeatherZone
    helper: Mesh
}

function mountUi(
    fx: WeatherSystem,
    targetProvider: () => { x: number; y: number; z: number },
    scene: Scene,
    camera: PerspectiveCamera,
    domElement: HTMLElement,
    transform: TransformControls,
): PanelHandle {
    const store = new TemplateStore()

    // ── Ambient weather ──────────────────────────────────────────────
    const weatherRow = document.getElementById('weatherPresets')!
    const tod = document.getElementById('tod') as HTMLInputElement
    const todValue = document.getElementById('todValue')!
    const cloud = document.getElementById('cloud') as HTMLInputElement
    const cloudValue = document.getElementById('cloudValue')!
    const wind = document.getElementById('wind') as HTMLInputElement
    const windValue = document.getElementById('windValue')!
    const boomBtn = document.getElementById('boom')!
    const clearBtn = document.getElementById('clear')!

    const weatherButtons = new Map<string, HTMLButtonElement>()
    let activeWeatherId: keyof typeof WEATHER_PRESETS = 'clear'

    function applyWeather(id: keyof typeof WEATHER_PRESETS): void {
        const preset = WEATHER_PRESETS[id]
        if (!preset) return
        activeWeatherId = id
        fx.setAmbient(preset.apply)
        for (const [pid, btn] of weatherButtons) btn.classList.toggle('active', pid === id)
        const next = fx.ambient.state
        tod.value = String(next.timeOfDay)
        todValue.textContent = next.timeOfDay.toFixed(1)
        cloud.value = String(next.cloudCoverage)
        cloudValue.textContent = next.cloudCoverage.toFixed(2)
        wind.value = String(next.windX)
        windValue.textContent = next.windX.toFixed(1)
    }

    for (const id of Object.keys(WEATHER_PRESETS)) {
        const preset = WEATHER_PRESETS[id]!
        const btn = document.createElement('button')
        btn.textContent = `${preset.icon ?? ''} ${preset.label}`.trim()
        btn.onclick = () => applyWeather(id as keyof typeof WEATHER_PRESETS)
        weatherRow.appendChild(btn)
        weatherButtons.set(id, btn)
    }
    applyWeather(activeWeatherId)

    tod.addEventListener('input', () => {
        const v = parseFloat(tod.value)
        todValue.textContent = v.toFixed(1)
        fx.setAmbient({ timeOfDay: v })
    })
    cloud.addEventListener('input', () => {
        const v = parseFloat(cloud.value)
        cloudValue.textContent = v.toFixed(2)
        fx.setAmbient({ cloudCoverage: v })
    })
    wind.addEventListener('input', () => {
        const v = parseFloat(wind.value)
        windValue.textContent = v.toFixed(1)
        fx.setAmbient({ windX: v })
    })

    // ── Zone management ───────────────────────────────────────────────
    const zones: DemoZone[] = []
    let selectedZone: DemoZone | null = null
    let selectedTemplateId: string | null = null
    const raycaster = new Raycaster()
    const pointer = new Vector2()

    const zoneList = document.getElementById('zones')! as HTMLUListElement
    const constructorRoot = document.getElementById('constructor')!
    const paletteRoot = document.getElementById('palette')!

    function constructorTargetId(): string | null {
        if (selectedZone) return `zone:${selectedZone.zone.runtime.params.id}`
        return selectedTemplateId
    }

    // ── Constructor ───────────────────────────────────────────────────
    let ctor: ConstructorHandle
    ctor = mountConstructor({
        root: constructorRoot,
        store,
        onSpawn: (draft) => {
            const params = withSpawnPosition(draft, targetProvider())
            const zone = fx.addZone(params)
            const record = createDemoZone(zone)
            zones.push(record)
            selectZone(record)
            renderZones()
        },
        onSaveChanges: (draft) => {
            if (selectedTemplateId == null) return
            const t = store.get(selectedTemplateId)
            if (!t || t.builtin) return
            store.updateCustom(t.id, { ...draft, label: draft.name })
        },
        onSaveAsNew: (draft) => {
            const fresh = store.addCustom(draft, draft.name)
            selectedZone = null
            selectedTemplateId = fresh.id
            ctor.setTarget({ kind: 'template', template: fresh })
            palette.refresh()
            renderZones()
        },
        onDeleteTemplate: (template) => {
            store.removeCustom(template.id)
            if (selectedTemplateId === template.id) {
                selectedTemplateId = null
                ctor.setTarget({ kind: 'empty' })
            }
            palette.refresh()
        },
        onRemoveZone: (zone) => {
            const record = zones.find((z) => z.zone === zone)
            if (record) removeZoneRecord(record)
        },
        onZoneEdit: (zone, patch) => {
            fx.updateZone(zone.runtime.params.id!, patch)
            const record = zones.find((z) => z.zone === zone)
            if (record) {
                syncHelper(record)
                renderZones()
            }
        },
    })

    // ── Palette ───────────────────────────────────────────────────────
    const palette = mountPalette({
        store,
        root: paletteRoot,
        activeId: constructorTargetId,
        onSpawn: (template) => {
            const params = withSpawnPosition(template.params, targetProvider())
            // Preserve the template label as the zone's name.
            params.name = template.label
            const zone = fx.addZone(params)
            const record = createDemoZone(zone)
            zones.push(record)
            selectZone(record)
            renderZones()
        },
        onEdit: (template) => {
            selectedZone = null
            selectedTemplateId = template.id
            ctor.setTarget({ kind: 'template', template })
            for (const z of zones) syncHelper(z)
            transform.detach()
            renderZones()
            palette.refresh()
        },
        onNewCustom: () => {
            // Default seed for a brand-new custom: clone the first
            // built-in (which is rain), then immediately rename.
            const source = store.list().find((t) => t.builtin) ?? store.list()[0]
            if (!source) return
            const fresh = store.addCustom(source.params, `${source.label} (custom)`)
            selectedZone = null
            selectedTemplateId = fresh.id
            ctor.setTarget({ kind: 'template', template: fresh })
            palette.refresh()
        },
    })

    // ── Zone list ─────────────────────────────────────────────────────
    function renderZones(): void {
        zoneList.innerHTML = ''
        if (zones.length === 0) {
            const empty = document.createElement('li')
            empty.classList.add('empty')
            empty.textContent = 'No zones — click a template "+" to spawn.'
            zoneList.appendChild(empty)
            return
        }
        for (const record of zones) {
            const zone = record.zone
            const li = document.createElement('li')
            if (record === selectedZone) li.classList.add('selected')
            const name = document.createElement('span')
            name.className = 'name'
            const meta = document.createElement('span')
            meta.className = 'meta'
            meta.textContent = `· ${zone.runtime.params.type}`
            name.append(`${zone.runtime.params.name}`, meta)
            const remove = document.createElement('button')
            remove.className = 'remove danger'
            remove.textContent = '×'
            remove.title = 'Remove zone'
            remove.onclick = (ev) => { ev.stopPropagation(); removeZoneRecord(record) }
            li.onclick = (ev) => { if (ev.target !== remove) selectZone(record) }
            li.append(name, remove)
            zoneList.appendChild(li)
        }
    }

    boomBtn.addEventListener('click', () => { fx.triggerExplosion(targetProvider()) })
    clearBtn.addEventListener('click', () => {
        for (const record of zones.slice()) removeZoneRecord(record)
    })

    // ── Helpers ──────────────────────────────────────────────────────
    function createDemoZone(zone: WeatherZone): DemoZone {
        const helper = new Mesh(
            new BoxGeometry(1, 1, 1),
            new MeshBasicMaterial({
                color: new Color(zone.runtime.params.color),
                wireframe: true,
                transparent: true,
                opacity: 0.24,
                depthWrite: false,
            }),
        )
        helper.name = `FXZoneVolume:${zone.runtime.params.name}`
        scene.add(helper)
        const record = { zone, helper }
        helper.userData.zone = record
        syncHelper(record)
        return record
    }

    function removeZoneRecord(record: DemoZone): void {
        const idx = zones.indexOf(record)
        if (idx >= 0) zones.splice(idx, 1)
        fx.removeZone(record.zone.runtime.params.id!)
        scene.remove(record.helper)
        record.helper.geometry.dispose()
        ;(record.helper.material as MeshBasicMaterial).dispose()
        if (selectedZone === record) selectZone(null)
        renderZones()
    }

    function syncHelper(record: DemoZone): void {
        const p = record.zone.runtime.params
        record.helper.position.set(p.position.x, p.position.y, p.position.z)
        record.helper.scale.set(p.size.x, p.size.y, p.size.z)
        record.helper.name = `FXZoneVolume:${p.name}`
        const mat = record.helper.material as MeshBasicMaterial
        mat.color.set(p.color)
        mat.opacity = record === selectedZone ? 0.55 : 0.24
    }

    function selectZone(record: DemoZone | null): void {
        selectedZone = record
        selectedTemplateId = null
        for (const z of zones) syncHelper(z)
        if (record) {
            transform.attach(record.helper)
            transform.setMode('translate')
            ctor.setTarget({ kind: 'zone', zone: record.zone })
        } else {
            transform.detach()
            ctor.setTarget({ kind: 'empty' })
        }
        renderZones()
        palette.refresh()
    }

    // Viewport raycast — click a wireframe helper to pick the zone.
    domElement.addEventListener('pointerdown', (ev) => {
        if (ev.target !== domElement) return
        if ((transform as TransformControls & { dragging?: boolean }).dragging) return
        const rect = domElement.getBoundingClientRect()
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        const hits = raycaster.intersectObjects(zones.map((z) => z.helper), false)
        if (hits[0]) selectZone((hits[0].object.userData as { zone?: DemoZone }).zone ?? null)
    })

    // TransformControls gizmo → push position/size back into the
    // constructor + the zone params + the helper.
    transform.addEventListener('objectChange', () => {
        if (!selectedZone) return
        const h = selectedZone.helper
        fx.updateZone(selectedZone.zone.runtime.params.id!, {
            position: { x: h.position.x, y: h.position.y, z: h.position.z },
            size: {
                x: Math.max(1, Math.abs(h.scale.x)),
                y: Math.max(1, Math.abs(h.scale.y)),
                z: Math.max(1, Math.abs(h.scale.z)),
            },
        })
        syncHelper(selectedZone)
        ctor.refresh()
    })

    // ── JSON export / import ─────────────────────────────────────────
    const jsonBox = document.getElementById('jsonBox') as HTMLTextAreaElement
    const exportBtn = document.getElementById('exportZones')!
    const importBtn = document.getElementById('importZones')!
    exportBtn.addEventListener('click', () => {
        jsonBox.value = JSON.stringify({
            version: 1,
            ambient: fx.ambient.state,
            zones: zones.map((z) => z.zone.toJSON()),
        }, null, 2)
    })
    importBtn.addEventListener('click', () => {
        const data = JSON.parse(jsonBox.value) as { ambient?: Partial<typeof fx.ambient.state>; zones?: WeatherZoneParams[] }
        for (const record of zones.slice()) removeZoneRecord(record)
        if (data.ambient) fx.setAmbient(data.ambient)
        for (const params of data.zones ?? []) {
            const zone = fx.addZone(params)
            const record = createDemoZone(zone)
            zones.push(record)
        }
        selectZone(zones[0] ?? null)
        renderZones()
    })

    renderZones()

    return {
        activeCount: () => zones.length,
        applyWeather,
    }
}

/** Drop a template's params at the camera target. Strips any inherited
 *  id so the system generates a fresh one. */
function withSpawnPosition(source: WeatherZoneParams, at: { x: number; y: number; z: number }): WeatherZoneParams {
    return {
        ...source,
        id: undefined,
        position: { ...at },
        size: { ...source.size },
    }
}

void main()

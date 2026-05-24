import {
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
    Vector3,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import {
    WeatherSystem,
    WEATHER_PRESETS,
    ZONE_PRESETS,
    applyZonePreset,
    type WeatherZone,
    type WeatherZoneParams,
} from './engine/fx'

/**
 * FX demo entry. Stands up a minimal WebGPU scene with orbit controls,
 * a chequered voxel-style reference floor + a few props, and the
 * `WeatherSystem`. The control panel mounted in `fx-demo.html` drives:
 *
 *  - the ambient weather preset (clear / cloudy / rain / storm / snow /
 *    dawn) plus time-of-day, cloud coverage, and wind sliders;
 *  - one-click spawn of every supported zone preset, dropped where the
 *    OrbitControls target is looking;
 *  - a "Trigger Explosion" button that fires a one-shot burst at the
 *    target;
 *  - a live list of active zones with per-row remove.
 *
 * Pure runtime — no editor / game / playtest dependencies.
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
    document.body.appendChild(renderer.domElement)
    await renderer.init()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 2
    controls.maxDistance = 140
    controls.target.set(0, 1, 0)

    // Reference scenery — a low blocky platform so the FX have something
    // to interact with visually. Cheap, single InstancedMesh.
    buildReferenceWorld(scene)

    const fx = new WeatherSystem(scene, { maxLights: 8, cullDistance: 120 })

    // Apply the "clear" preset on boot so we don't open onto a black
    // sky if the user hasn't picked anything yet.
    fx.setAmbient(WEATHER_PRESETS.clear!.apply)

    // ── Control panel wiring ──────────────────────────────────────────
    const transform = new TransformControls(camera, renderer.domElement)
    transform.addEventListener('dragging-changed', (ev) => {
        controls.enabled = !ev.value
    })
    scene.add(transform.getHelper())

    const panel = mountPanel(fx, () => controls.target, scene, camera, renderer.domElement, transform)

    // Keyboard shortcuts.
    let paused = false
    window.addEventListener('keydown', (ev) => {
        if (ev.code === 'Space') { paused = !paused; return }
        if (ev.code === 'KeyR') { fx.triggerExplosion(controlTargetPos(controls)); return }
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

    // ── Frame loop ────────────────────────────────────────────────────
    const clock = new Clock()
    let frameTimes: number[] = []
    const fpsEl = document.getElementById('fps')!
    const frameEl = document.getElementById('frame')!
    const zoneCountEl = document.getElementById('zoneCount')!

    function frame(): void {
        const dt = Math.min(0.1, clock.getDelta())
        if (!paused) fx.update(dt, camera)
        controls.update()
        try {
            renderer.render(scene, camera)
        } catch (err) {
            console.error('Render error:', err)
        }

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

function controlTargetPos(controls: OrbitControls): { x: number; y: number; z: number } {
    return { x: controls.target.x, y: controls.target.y, z: controls.target.z }
}

function buildReferenceWorld(scene: Scene): void {
    // Ground plane — large, flat, neutral.
    const ground = new Mesh(
        new PlaneGeometry(200, 200),
        new MeshStandardMaterial({ color: new Color('#2a3140'), roughness: 0.95 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.5
    scene.add(ground)

    // Chequered voxel-style pad — InstancedMesh with two colours so the
    // FX have parallax cues without paying for thousands of meshes.
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

    // A few stepped pillars so vertical effects (lightning, fireflies)
    // have something to anchor to.
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

function mountPanel(
    fx: WeatherSystem,
    targetProvider: () => { x: number; y: number; z: number },
    scene: Scene,
    camera: PerspectiveCamera,
    domElement: HTMLElement,
    transform: TransformControls,
): PanelHandle {
    const weatherRow = document.getElementById('weatherPresets')!
    const zoneRow = document.getElementById('zonePresets')!
    const zoneList = document.getElementById('zones')! as HTMLUListElement
    const tod = document.getElementById('tod') as HTMLInputElement
    const todValue = document.getElementById('todValue')!
    const cloud = document.getElementById('cloud') as HTMLInputElement
    const cloudValue = document.getElementById('cloudValue')!
    const wind = document.getElementById('wind') as HTMLInputElement
    const windValue = document.getElementById('windValue')!
    const boomBtn = document.getElementById('boom')!
    const clearBtn = document.getElementById('clear')!
    const zoneEditor = document.getElementById('zoneEditor')!
    const zoneName = document.getElementById('zoneName') as HTMLInputElement
    const zoneColor = document.getElementById('zoneColor') as HTMLInputElement
    const zoneColorValue = document.getElementById('zoneColorValue')!
    const modeTranslate = document.getElementById('modeTranslate')!
    const modeScale = document.getElementById('modeScale')!
    const duplicateZone = document.getElementById('duplicateZone')!
    const deleteZone = document.getElementById('deleteZone')!
    const jsonBox = document.getElementById('jsonBox') as HTMLTextAreaElement
    const exportZones = document.getElementById('exportZones')!
    const importZones = document.getElementById('importZones')!
    const posInputs = ['posX', 'posY', 'posZ'].map((id) => document.getElementById(id) as HTMLInputElement)
    const sizeInputs = ['sizeX', 'sizeY', 'sizeZ'].map((id) => document.getElementById(id) as HTMLInputElement)

    const weatherButtons = new Map<string, HTMLButtonElement>()
    let activeWeatherId: keyof typeof WEATHER_PRESETS = 'clear'

    function applyWeather(id: keyof typeof WEATHER_PRESETS): void {
        const preset = WEATHER_PRESETS[id]
        if (!preset) return
        activeWeatherId = id
        fx.setAmbient(preset.apply)
        for (const [pid, btn] of weatherButtons) btn.classList.toggle('active', pid === id)
        // Sliders snap to whatever the preset specified.
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

    const zones: DemoZone[] = []
    let selected: DemoZone | null = null
    let transformMode: 'translate' | 'scale' = 'translate'
    const raycaster = new Raycaster()
    const pointer = new Vector2()

    transform.addEventListener('objectChange', () => {
        if (!selected) return
        syncSelectedFromHelper()
    })

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

    function renderZones(): void {
        zoneList.innerHTML = ''
        if (zones.length === 0) {
            const empty = document.createElement('li')
            empty.style.justifyContent = 'center'
            empty.style.color = 'rgba(217, 247, 255, 0.4)'
            empty.textContent = 'No zones — click a preset above.'
            zoneList.appendChild(empty)
            return
        }
        for (const record of zones) {
            const zone = record.zone
            const li = document.createElement('li')
            if (record === selected) li.classList.add('selected')
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
            remove.onclick = () => {
                const idx = zones.indexOf(record)
                if (idx >= 0) zones.splice(idx, 1)
                fx.removeZone(zone.runtime.params.id!)
                scene.remove(record.helper)
                record.helper.geometry.dispose()
                ;(record.helper.material as MeshBasicMaterial).dispose()
                if (selected === record) selectZone(null)
                renderZones()
            }
            li.onclick = (ev) => {
                if (ev.target !== remove) selectZone(record)
            }
            li.append(name, remove)
            zoneList.appendChild(li)
        }
    }

    for (const id of Object.keys(ZONE_PRESETS)) {
        const preset = ZONE_PRESETS[id]!
        const btn = document.createElement('button')
        btn.textContent = preset.label
        btn.title = `Spawn ${preset.label} at the camera target`
        btn.onclick = () => {
            const at = targetProvider()
            const params: WeatherZoneParams = applyZonePreset(id as keyof typeof ZONE_PRESETS, { position: { ...at } })
            const zone = fx.addZone(params)
            const record = createDemoZone(zone)
            zones.push(record)
            selectZone(record)
            renderZones()
        }
        zoneRow.appendChild(btn)
    }
    renderZones()

    boomBtn.addEventListener('click', () => {
        fx.triggerExplosion(targetProvider())
    })
    clearBtn.addEventListener('click', () => {
        for (const record of zones.slice()) {
            fx.removeZone(record.zone.runtime.params.id!)
            scene.remove(record.helper)
            record.helper.geometry.dispose()
            ;(record.helper.material as MeshBasicMaterial).dispose()
        }
        zones.length = 0
        selectZone(null)
        renderZones()
    })

    modeTranslate.addEventListener('click', () => setTransformMode('translate'))
    modeScale.addEventListener('click', () => setTransformMode('scale'))
    duplicateZone.addEventListener('click', () => {
        if (!selected) return
        const params = selected.zone.toJSON()
        const copy = fx.addZone({
            ...params,
            id: undefined,
            name: `${params.name} copy`,
            position: {
                x: params.position.x + 2,
                y: params.position.y,
                z: params.position.z + 2,
            },
        })
        const record = createDemoZone(copy)
        zones.push(record)
        selectZone(record)
        renderZones()
    })
    deleteZone.addEventListener('click', () => {
        if (!selected) return
        const record = selected
        const idx = zones.indexOf(record)
        if (idx >= 0) zones.splice(idx, 1)
        fx.removeZone(record.zone.runtime.params.id!)
        scene.remove(record.helper)
        record.helper.geometry.dispose()
        ;(record.helper.material as MeshBasicMaterial).dispose()
        selectZone(zones[0] ?? null)
        renderZones()
    })

    for (const input of [zoneName, zoneColor, ...posInputs, ...sizeInputs]) {
        input.addEventListener('input', syncSelectedFromPanel)
        input.addEventListener('change', syncSelectedFromPanel)
    }
    exportZones.addEventListener('click', () => {
        jsonBox.value = JSON.stringify({
            version: 1,
            ambient: fx.ambient.state,
            zones: zones.map((z) => z.zone.toJSON()),
        }, null, 2)
    })
    importZones.addEventListener('click', () => {
        const data = JSON.parse(jsonBox.value) as { ambient?: Partial<typeof fx.ambient.state>; zones?: WeatherZoneParams[] }
        for (const record of zones.slice()) {
            fx.removeZone(record.zone.runtime.params.id!)
            scene.remove(record.helper)
            record.helper.geometry.dispose()
            ;(record.helper.material as MeshBasicMaterial).dispose()
        }
        zones.length = 0
        if (data.ambient) fx.setAmbient(data.ambient)
        for (const params of data.zones ?? []) {
            const zone = fx.addZone(params)
            const record = createDemoZone(zone)
            zones.push(record)
        }
        selectZone(zones[0] ?? null)
        renderZones()
    })

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

    function selectZone(record: DemoZone | null): void {
        selected = record
        for (const z of zones) syncHelper(z)
        if (selected) {
            transform.attach(selected.helper)
            transform.setMode(transformMode)
            zoneEditor.classList.remove('hidden')
            syncPanelFromSelected()
        } else {
            transform.detach()
            zoneEditor.classList.add('hidden')
        }
        renderZones()
    }

    function setTransformMode(mode: 'translate' | 'scale'): void {
        transformMode = mode
        modeTranslate.classList.toggle('active', mode === 'translate')
        modeScale.classList.toggle('active', mode === 'scale')
        transform.setMode(mode)
    }

    function syncHelper(record: DemoZone): void {
        const p = record.zone.runtime.params
        record.helper.position.set(p.position.x, p.position.y, p.position.z)
        record.helper.scale.set(p.size.x, p.size.y, p.size.z)
        record.helper.name = `FXZoneVolume:${p.name}`
        const mat = record.helper.material as MeshBasicMaterial
        mat.color.set(p.color)
        mat.opacity = record === selected ? 0.55 : 0.24
    }

    function syncSelectedFromHelper(): void {
        if (!selected) return
        const h = selected.helper
        const position = { x: h.position.x, y: h.position.y, z: h.position.z }
        const size = {
            x: Math.max(1, Math.abs(h.scale.x)),
            y: Math.max(1, Math.abs(h.scale.y)),
            z: Math.max(1, Math.abs(h.scale.z)),
        }
        fx.updateZone(selected.zone.runtime.params.id!, { position, size })
        syncHelper(selected)
        syncPanelFromSelected(false)
    }

    function syncPanelFromSelected(updateList = true): void {
        if (!selected) return
        const p = selected.zone.runtime.params
        zoneName.value = p.name
        zoneColor.value = p.color
        zoneColorValue.textContent = p.color
        posInputs[0]!.value = p.position.x.toFixed(2)
        posInputs[1]!.value = p.position.y.toFixed(2)
        posInputs[2]!.value = p.position.z.toFixed(2)
        sizeInputs[0]!.value = p.size.x.toFixed(2)
        sizeInputs[1]!.value = p.size.y.toFixed(2)
        sizeInputs[2]!.value = p.size.z.toFixed(2)
        if (updateList) renderZones()
    }

    function syncSelectedFromPanel(): void {
        if (!selected) return
        const position = {
            x: parseFloat(posInputs[0]!.value),
            y: parseFloat(posInputs[1]!.value),
            z: parseFloat(posInputs[2]!.value),
        }
        const size = {
            x: Math.max(1, parseFloat(sizeInputs[0]!.value)),
            y: Math.max(1, parseFloat(sizeInputs[1]!.value)),
            z: Math.max(1, parseFloat(sizeInputs[2]!.value)),
        }
        if (!Number.isFinite(position.x + position.y + position.z + size.x + size.y + size.z)) return
        fx.updateZone(selected.zone.runtime.params.id!, {
            name: zoneName.value || 'FX zone',
            color: zoneColor.value,
            position,
            size,
        })
        zoneColorValue.textContent = zoneColor.value
        syncHelper(selected)
        renderZones()
    }

    return {
        activeCount: () => zones.length,
        applyWeather,
    }
}

void main()

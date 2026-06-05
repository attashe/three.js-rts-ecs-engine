import { Clock, Raycaster, Vector2, Vector3, Plane } from 'three'
import { AudioEngine, type AudioAnalyser, type AudioAsset, type AudioBusId } from './engine/audio'
import { GAME_AUDIO_MANIFEST } from './game/audio'
import { formatBytes, makeLocalAssetId, type LocalAssetKind, type LocalAssetRecord } from './sound-demo/local-assets'
import { formatDb, meterFromTimeDomain } from './sound-demo/waveform'
import { createDemoScene } from './sound-demo/scene'
import { ListenerAvatar } from './sound-demo/listener'
import { EmitterSource } from './sound-demo/emitter-source'
import { BackgroundDeck, type BackgroundTrack } from './sound-demo/background-deck'

/**
 * Sound demo — a gameplay simulator, not a clip auditioner.
 *
 * Layout: left column is the asset library + active-emitter list;
 * the middle column is a small WebGPU scene with a movable listener
 * avatar and placed emitters drawn as colored discs with falloff
 * rings; right column is the selected-emitter inspector + music deck
 * + mixer / meters / log.
 *
 * The interactive loop: select an asset, click in the scene to place
 * an emitter, drive the listener with WASD+QE, and *see* the spatial
 * relationship match what you hear. Loop emitters keep playing as you
 * move; one-shots fire from the inspector or from the "F" fire key.
 */

type AssetKind = 'sounds' | 'music' | 'stingers'
type AssetTab = AssetKind | 'local'

interface DemoAsset extends AudioAsset {
    kind: AssetKind
    source: 'manifest' | 'local'
    size?: number
    mediaType?: string
}

const EMITTER_COLORS = ['#6ad0ff', '#8ff0aa', '#ffb45e', '#c89cff', '#ff6b9c', '#ffe066', '#7be4ff', '#ff8a5a']

const BUS_IDS: readonly AudioBusId[] = ['master', 'music', 'sfx', 'stinger', 'ui']
const TABS: { id: AssetTab; label: string }[] = [
    { id: 'sounds', label: 'SFX' },
    { id: 'stingers', label: 'Stingers' },
    { id: 'music', label: 'Music' },
    { id: 'local', label: 'Local' },
]

const audio = new AudioEngine({
    spatialDefaults: { refDistance: 2, maxDistance: 30, rolloffFactor: 1, panningModel: 'HRTF' },
})
const localAssets: LocalAssetRecord[] = []
const emitters: EmitterSource[] = []
let selectedAssetId: string | null = GAME_AUDIO_MANIFEST.sounds?.[0]?.id ?? null
let selectedEmitter: EmitterSource | null = null
let activeTab: AssetTab = 'sounds'
let muted = false
let placeMode = true

const ui = wireDom()
const meterRows = new Map<AudioBusId, { root: HTMLElement; fill: HTMLElement; value: HTMLElement; data: Uint8Array; analyser: AudioAnalyser }>()
const backgroundDeck = new BackgroundDeck(audio, { onChange: () => renderBackgroundDeck() })

async function main(): Promise<void> {
    mountTabs()
    mountBusControls()
    mountMeters()
    wireEvents()
    renderAssets()
    renderEmitters()
    renderInspector()

    try {
        await audio.loadManifest(GAME_AUDIO_MANIFEST)
        log('Loaded game audio manifest.')
    } catch (err) {
        log(`Manifest load failed: ${String(err)}`)
    }

    // Seed the background deck once the manifest is loaded — every
    // non-stinger asset becomes a row the user can mix in.
    seedBackgroundDeck()
    renderBackgroundDeck()

    await mountScene()
}

/** ---------------------------------------------------------------- */

async function mountScene(): Promise<void> {
    const canvas = ui.viewportCanvas
    const wrap = ui.viewport
    canvas.width = wrap.clientWidth
    canvas.height = wrap.clientHeight
    const demo = createDemoScene(canvas)
    await demo.ready
    _demoScene = demo.scene

    const listener = new ListenerAvatar(audio)
    listener.setPosition(0, 1.6, 0)
    listener.attach(demo.scene)

    // Click-to-place / click-to-select on the ground.
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const ground = new Plane(new Vector3(0, 1, 0), 0)
    const groundHit = new Vector3()

    function pickEmitter(ev: PointerEvent): EmitterSource | null {
        const rect = canvas.getBoundingClientRect()
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, demo.camera)
        for (const emitter of emitters) {
            const hits = raycaster.intersectObject(emitter.root, true)
            if (hits[0]) return emitter
        }
        return null
    }

    function groundPoint(ev: PointerEvent): Vector3 | null {
        const rect = canvas.getBoundingClientRect()
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, demo.camera)
        return raycaster.ray.intersectPlane(ground, groundHit) ? groundHit.clone() : null
    }

    canvas.addEventListener('pointerdown', (ev) => {
        // Right-click reserved for orbit/pan — only handle LMB.
        if (ev.button !== 0) return
        // Suppress placement / selection while OrbitControls is in a
        // drag (it consumes the events itself).
        if ((demo.controls as { isDragging?: boolean }).isDragging) return
        const picked = pickEmitter(ev)
        if (picked) { selectEmitter(picked); return }
        if (!placeMode) return
        const point = groundPoint(ev)
        if (!point) return
        const asset = currentAsset()
        if (!asset || asset.kind === 'music') {
            log('Pick an SFX or stinger asset first.')
            return
        }
        spawnEmitterAt({ x: point.x, y: 0.45, z: point.z }, asset)
    })

    // F to fire selected emitter; also placed for keyboard testing
    // since the inspector button does the same.
    window.addEventListener('keydown', (ev) => {
        if (ev.code === 'KeyF') fireSelectedAtListener(listener)
    })

    const clock = new Clock()
    function frame(): void {
        const dt = Math.min(0.05, clock.getDelta())
        listener.update(dt)
        demo.controls.update()
        try { demo.renderer.render(demo.scene, demo.camera) }
        catch (err) { console.error('Render error:', err) }
        renderHud(listener)
        renderDiagnostics()
        renderMeters()
        requestAnimationFrame(frame)
    }
    frame()

    window.addEventListener('resize', () => {
        const w = wrap.clientWidth, h = wrap.clientHeight
        canvas.width = w; canvas.height = h
        demo.renderer.setSize(w, h, false)
        demo.camera.aspect = w / h
        demo.camera.updateProjectionMatrix()
    })

    // Hold the demo handle for cleanup hooks.
    window.addEventListener('beforeunload', () => {
        for (const e of emitters) e.dispose()
        for (const a of localAssets) URL.revokeObjectURL(a.url)
        audio.dispose()
    })
}

function fireSelectedAtListener(listener: ListenerAvatar): void {
    const asset = currentAsset()
    if (!asset || asset.kind === 'music') {
        log('Select an SFX or stinger to fire.')
        return
    }
    const pose = listener.pose()
    // Fire from ~2 m ahead of the listener in their forward direction —
    // proves spatial pan + falloff in one motion.
    const aheadDistance = 2.5
    const x = pose.position.x + pose.forward.x * aheadDistance
    const y = pose.position.y
    const z = pose.position.z + pose.forward.z * aheadDistance
    void audio.unlock().then(() => {
        if (asset.kind === 'stingers') audio.playStinger(asset.id)
        else audio.playSpatial(asset.id, { x, y, z })
        log(`Fired ${asset.id} at (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`)
    })
}

function spawnEmitterAt(at: { x: number; y: number; z: number }, asset: DemoAsset): void {
    // Create the emitter SYNCHRONOUSLY so the inspector + Play-once
    // button bind to it immediately. Previously this whole body was
    // inside `audio.unlock().then(...)`, which meant the first
    // Play-once press hit a null `selectedEmitter` if the user clicked
    // before the unlock microtask had drained.
    const emitter = new EmitterSource({
        audio,
        scene: currentDemoScene(),
        assetId: asset.id,
        label: asset.id,
        position: at,
        color: EMITTER_COLORS[emitters.length % EMITTER_COLORS.length]!,
        loop: asset.kind === 'sounds' && (asset.loop ?? false),
        refDistance: 2,
        maxDistance: 30,
        rolloffFactor: 1,
        panningModel: 'HRTF',
    })
    emitters.push(emitter)
    selectEmitter(emitter)
    renderEmitters()
    log(`Placed ${asset.id} at (${at.x.toFixed(1)}, ${at.z.toFixed(1)})`)

    // Only the actual playback waits for unlock — the emitter object
    // is already live, so the inspector + Play-once button work
    // immediately.
    if (emitter.snapshot().loop) {
        void audio.unlock().then(() => emitter.play())
    }
}

let _demoScene: import('three').Scene | null = null
function currentDemoScene(): import('three').Scene {
    if (!_demoScene) throw new Error('Demo scene not initialised yet')
    return _demoScene
}

/** ---------------------------------------------------------------- */

function wireDom() {
    return {
        unlockBtn: byId<HTMLButtonElement>('unlockBtn'),
        muteBtn: byId<HTMLButtonElement>('muteBtn'),
        unlockStatus: byId<HTMLElement>('unlockStatus'),
        assetTabs: byId<HTMLElement>('assetTabs'),
        assetList: byId<HTMLElement>('assetList'),
        localKind: byId<HTMLSelectElement>('localKind'),
        fileInput: byId<HTMLInputElement>('fileInput'),
        emitterList: byId<HTMLElement>('emitterList'),
        clearEmitters: byId<HTMLButtonElement>('clearEmitters'),
        viewport: byId<HTMLElement>('viewport'),
        viewportCanvas: byId<HTMLCanvasElement>('viewportCanvas'),
        hudPos: byId<HTMLElement>('hudPos'),
        hudFwd: byId<HTMLElement>('hudFwd'),
        hudVoices: byId<HTMLElement>('hudVoices'),
        placeBtn: byId<HTMLButtonElement>('placeBtn'),
        fireBtn: byId<HTMLButtonElement>('fireBtn'),
        noSelection: byId<HTMLElement>('noSelection'),
        inspectorBody: byId<HTMLElement>('inspectorBody'),
        inspAsset: byId<HTMLElement>('inspAsset'),
        inspColor: byId<HTMLInputElement>('inspColor'),
        inspLoop: byId<HTMLInputElement>('inspLoop'),
        inspRefDist: byId<HTMLInputElement>('inspRefDist'),
        inspRefDistV: byId<HTMLElement>('inspRefDistV'),
        inspMaxDist: byId<HTMLInputElement>('inspMaxDist'),
        inspMaxDistV: byId<HTMLElement>('inspMaxDistV'),
        inspRolloff: byId<HTMLInputElement>('inspRolloff'),
        inspRolloffV: byId<HTMLElement>('inspRolloffV'),
        inspDelay: byId<HTMLInputElement>('inspDelay'),
        inspDelayV: byId<HTMLElement>('inspDelayV'),
        inspPanHRTF: byId<HTMLButtonElement>('inspPanHRTF'),
        inspPanEqual: byId<HTMLButtonElement>('inspPanEqual'),
        inspPlay: byId<HTMLButtonElement>('inspPlay'),
        inspRemove: byId<HTMLButtonElement>('inspRemove'),
        backgroundList: byId<HTMLElement>('backgroundList'),
        stopAllBg: byId<HTMLButtonElement>('stopAllBg'),
        busControls: byId<HTMLElement>('busControls'),
        metersRoot: byId<HTMLElement>('meters'),
        logRoot: byId<HTMLElement>('log'),
        activeVoices: byId<HTMLElement>('activeVoices'),
        pendingSounds: byId<HTMLElement>('pendingSounds'),
        currentMusic: byId<HTMLElement>('currentMusic'),
    }
}

function wireEvents(): void {
    ui.unlockBtn.onclick = () => {
        void audio.unlock().then(() => log('Audio context unlocked.')).catch((err) => log(`Unlock failed: ${err}`))
    }
    ui.muteBtn.onclick = () => {
        muted = !muted
        audio.mute(muted)
        ui.muteBtn.textContent = muted ? 'Unmute' : 'Mute'
    }
    ui.fileInput.onchange = () => { void importLocalFiles() }
    ui.placeBtn.onclick = () => {
        placeMode = !placeMode
        ui.placeBtn.classList.toggle('active', placeMode)
    }
    ui.fireBtn.onclick = () => {
        // Synth keyboard event so the user gets identical behaviour
        // from the button as from the F key.
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }))
    }
    ui.stopAllBg.onclick = () => {
        backgroundDeck.stopAll()
        log('Stopped all backgrounds.')
    }

    ui.clearEmitters.onclick = () => {
        for (const e of emitters.slice()) removeEmitter(e)
        log('Cleared all emitters.')
    }

    // Inspector wiring.
    ui.inspColor.addEventListener('input', () => selectedEmitter?.setColor(ui.inspColor.value))
    ui.inspLoop.addEventListener('change', () => selectedEmitter?.setLoop(ui.inspLoop.checked))
    ui.inspRefDist.addEventListener('input', () => {
        const v = readNumber(ui.inspRefDist.value, 2)
        ui.inspRefDistV.textContent = v.toFixed(1)
        selectedEmitter?.setRefDistance(v)
    })
    ui.inspMaxDist.addEventListener('input', () => {
        const v = readNumber(ui.inspMaxDist.value, 30)
        ui.inspMaxDistV.textContent = v.toFixed(0)
        selectedEmitter?.setMaxDistance(v)
    })
    ui.inspRolloff.addEventListener('input', () => {
        const v = readNumber(ui.inspRolloff.value, 1)
        ui.inspRolloffV.textContent = v.toFixed(2)
        selectedEmitter?.setRolloffFactor(v)
    })
    ui.inspDelay.addEventListener('input', () => {
        const v = readNumber(ui.inspDelay.value, 0)
        ui.inspDelayV.textContent = `${v.toFixed(2)}s`
        selectedEmitter?.setPlayDelay(v)
    })
    ui.inspPanHRTF.onclick = () => switchPanner('HRTF')
    ui.inspPanEqual.onclick = () => switchPanner('equalpower')
    ui.inspPlay.onclick = () => {
        if (!selectedEmitter) return
        void audio.unlock().then(() => selectedEmitter?.play())
    }
    ui.inspRemove.onclick = () => {
        if (!selectedEmitter) return
        removeEmitter(selectedEmitter)
    }
}

function switchPanner(model: 'HRTF' | 'equalpower'): void {
    if (!selectedEmitter) return
    selectedEmitter.setPanningModel(model)
    ui.inspPanHRTF.classList.toggle('active', model === 'HRTF')
    ui.inspPanEqual.classList.toggle('active', model === 'equalpower')
}

/** ---------------------------------------------------------------- */

function mountTabs(): void {
    ui.assetTabs.replaceChildren()
    for (const tab of TABS) {
        const btn = document.createElement('button')
        btn.textContent = tab.label
        btn.onclick = () => { activeTab = tab.id; renderAssets() }
        ui.assetTabs.appendChild(btn)
    }
}

function mountBusControls(): void {
    ui.busControls.replaceChildren()
    for (const bus of BUS_IDS) {
        const row = document.createElement('div')
        row.className = 'field'
        const label = document.createElement('label')
        label.textContent = bus
        const input = document.createElement('input')
        input.type = 'range'; input.min = '0'; input.max = '1'; input.step = '0.01'; input.value = '1'
        const value = document.createElement('span')
        value.className = 'value'; value.textContent = '1.00'
        input.addEventListener('input', () => {
            const v = readNumber(input.value, 1)
            value.textContent = v.toFixed(2)
            audio.setBusVolume(bus, v, 0.03)
        })
        row.append(label, input, value)
        ui.busControls.appendChild(row)
    }
}

function mountMeters(): void {
    ui.metersRoot.replaceChildren()
    for (const bus of BUS_IDS) {
        const analyser = audio.createAnalyser(bus)
        const root = document.createElement('div'); root.className = 'meter'
        const head = document.createElement('div'); head.className = 'meter-head'
        const name = document.createElement('span'); name.textContent = bus
        const value = document.createElement('span'); value.textContent = '-∞'
        const track = document.createElement('div'); track.className = 'meter-track'
        const fill = document.createElement('div'); fill.className = 'meter-fill'
        track.appendChild(fill); head.append(name, value); root.append(head, track)
        ui.metersRoot.appendChild(root)
        meterRows.set(bus, { root, fill, value, analyser, data: new Uint8Array(analyser.frequencyBinCount) })
    }
}

/** ---------------------------------------------------------------- */

function renderAssets(): void {
    ui.assetList.replaceChildren()
    for (const btn of [...ui.assetTabs.children] as HTMLButtonElement[]) {
        const tab = TABS[[...ui.assetTabs.children].indexOf(btn)]
        btn.classList.toggle('active', tab?.id === activeTab)
    }
    const list = assetsForTab(activeTab)
    if (list.length === 0) {
        const p = document.createElement('p')
        p.textContent = activeTab === 'local' ? 'No local files imported.' : 'No assets.'
        p.style.fontSize = '11px'
        ui.assetList.appendChild(p)
        return
    }
    for (const asset of list) {
        const row = document.createElement('div')
        row.className = `asset${asset.id === selectedAssetId ? ' active' : ''}`
        const name = document.createElement('span'); name.className = 'name'; name.textContent = asset.id
        const tag = document.createElement('span'); tag.className = 'tag'
        tag.textContent = asset.kind === 'sounds' ? 'sfx' : asset.kind.slice(0, -1)
        row.onclick = () => { selectedAssetId = asset.id; renderAssets() }
        row.append(name, tag)
        if (asset.source === 'local') {
            const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = '×'
            remove.style.padding = '1px 6px'; remove.style.fontSize = '11px'
            remove.onclick = (ev) => { ev.stopPropagation(); removeLocalAsset(asset.id) }
            row.appendChild(remove)
        }
        // Mute the size on local rows — keep the row terse.
        void formatBytes
        ui.assetList.appendChild(row)
    }
}

function renderEmitters(): void {
    ui.emitterList.replaceChildren()
    if (emitters.length === 0) {
        const p = document.createElement('p')
        p.textContent = 'Click in the scene to place an emitter using the selected asset.'
        p.style.fontSize = '11px'; p.style.color = 'var(--dim)'
        ui.emitterList.appendChild(p)
        return
    }
    for (const e of emitters) {
        const snap = e.snapshot()
        const row = document.createElement('div')
        row.className = `emitter-row${e === selectedEmitter ? ' active' : ''}`
        const swatch = document.createElement('span'); swatch.className = 'swatch'
        const c = (ui.inspColor.value && e === selectedEmitter) ? ui.inspColor.value : EMITTER_COLORS[emitters.indexOf(e) % EMITTER_COLORS.length]!
        swatch.style.background = c
        const name = document.createElement('span'); name.className = 'name'
        name.textContent = `${snap.label} · ${snap.position.x.toFixed(1)}, ${snap.position.z.toFixed(1)}`
        const removeBtn = document.createElement('button'); removeBtn.className = 'danger'; removeBtn.textContent = '×'
        removeBtn.onclick = (ev) => { ev.stopPropagation(); removeEmitter(e) }
        row.onclick = () => selectEmitter(e)
        row.append(swatch, name, removeBtn)
        ui.emitterList.appendChild(row)
    }
}

function renderInspector(): void {
    if (!selectedEmitter) {
        ui.noSelection.style.display = ''
        ui.inspectorBody.style.display = 'none'
        return
    }
    const snap = selectedEmitter.snapshot()
    ui.noSelection.style.display = 'none'
    ui.inspectorBody.style.display = ''
    ui.inspAsset.textContent = snap.label
    ui.inspLoop.checked = snap.loop
    ui.inspRefDist.value = String(snap.refDistance)
    ui.inspRefDistV.textContent = snap.refDistance.toFixed(1)
    ui.inspMaxDist.value = String(snap.maxDistance)
    ui.inspMaxDistV.textContent = snap.maxDistance.toFixed(0)
    ui.inspRolloff.value = String(snap.rolloffFactor)
    ui.inspRolloffV.textContent = snap.rolloffFactor.toFixed(2)
    // Delay slider keeps the per-emitter setting between re-selects.
    // (`snapshot` doesn't expose delay yet — see emitter-source for
    // why the field stays write-only via setPlayDelay. Reset to 0
    // when a new emitter is selected, otherwise leave the slider as
    // the user left it.)
    ui.inspDelay.value = '0'
    ui.inspDelayV.textContent = '0.00s'
    selectedEmitter.setPlayDelay(0)
    ui.inspPanHRTF.classList.toggle('active', snap.panningModel === 'HRTF')
    ui.inspPanEqual.classList.toggle('active', snap.panningModel === 'equalpower')
}

function seedBackgroundDeck(): void {
    // Every non-stinger asset is a candidate bg track. Loop-flagged
    // assets default to looping; everything else defaults to one-shot
    // so the user can fire them at intervals via Play+stop.
    const tracks: BackgroundTrack[] = []
    for (const asset of allAssets()) {
        if (asset.kind === 'stingers') continue
        tracks.push({
            assetId: asset.id,
            label: asset.id,
            volume: 0.6,
            loop: asset.kind === 'music' || (asset.loop ?? false),
            delay: 0,
            bus: asset.kind === 'music' ? 'music' : 'sfx',
            isPlaying: false,
        })
    }
    backgroundDeck.setTracks(tracks)
}

function renderBackgroundDeck(): void {
    ui.backgroundList.replaceChildren()
    const tracks = backgroundDeck.list()
    if (tracks.length === 0) {
        const p = document.createElement('p')
        p.textContent = 'No tracks — load the manifest first.'
        p.style.fontSize = '11px'; p.style.color = 'var(--dim)'
        ui.backgroundList.appendChild(p)
        return
    }
    for (const t of tracks) {
        const row = document.createElement('div')
        row.className = `bg-row${t.isPlaying ? ' playing' : ''}`

        const play = document.createElement('button')
        play.className = 'bg-play'
        play.textContent = t.isPlaying ? '■' : '▶'
        play.title = t.isPlaying ? 'Stop' : 'Play'
        play.onclick = () => backgroundDeck.toggle(t.assetId)

        const nameWrap = document.createElement('div')
        const name = document.createElement('span')
        name.className = 'bg-name'
        name.textContent = t.label
        const tag = document.createElement('span')
        tag.className = 'bg-tag'
        tag.textContent = `· ${t.bus}${t.loop ? ' · loop' : ''}`
        nameWrap.append(name, tag)

        const volRange = document.createElement('input')
        volRange.type = 'range'; volRange.min = '0'; volRange.max = '1'; volRange.step = '0.01'
        volRange.value = String(t.volume); volRange.title = `Volume ${t.volume.toFixed(2)}`
        volRange.oninput = () => backgroundDeck.update(t.assetId, { volume: readNumber(volRange.value, t.volume) })

        const delayInput = document.createElement('input')
        delayInput.type = 'number'; delayInput.min = '0'; delayInput.max = '20'; delayInput.step = '0.1'
        delayInput.value = String(t.delay); delayInput.title = 'Delay (s) before play'
        delayInput.onchange = () => backgroundDeck.update(t.assetId, { delay: readNumber(delayInput.value, 0) })

        row.append(play, nameWrap, volRange, delayInput)

        // Loop toggle in a sub-row to keep the main row compact.
        const sub = document.createElement('div')
        sub.className = 'bg-sub'
        const loopLabel = document.createElement('label')
        loopLabel.className = 'bg-sub-label'
        loopLabel.style.display = 'flex'; loopLabel.style.alignItems = 'center'; loopLabel.style.gap = '4px'
        const loopBox = document.createElement('input')
        loopBox.type = 'checkbox'; loopBox.checked = t.loop
        loopBox.onchange = () => backgroundDeck.update(t.assetId, { loop: loopBox.checked })
        loopLabel.append(loopBox, document.createTextNode('loop'))
        const status = document.createElement('span')
        status.className = 'bg-sub-label'
        status.style.textAlign = 'right'
        status.textContent = t.isPlaying ? 'playing' : 'idle'
        sub.append(loopLabel, status)

        row.appendChild(sub)
        ui.backgroundList.appendChild(row)
    }
}

function renderHud(listener: ListenerAvatar): void {
    const p = listener.pose().position
    ui.hudPos.textContent = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`
    ui.hudFwd.textContent = `${listener.yawDegrees.toFixed(0)}°`
}

function renderDiagnostics(): void {
    const snap = audio.snapshot()
    ui.unlockStatus.textContent = snap.unlocked ? 'unlocked' : 'locked'
    ui.unlockBtn.disabled = snap.unlocked
    ui.hudVoices.textContent = String(snap.activeVoices)
    ui.activeVoices.textContent = String(snap.activeVoices)
    ui.pendingSounds.textContent = String(snap.pendingSounds)
    ui.currentMusic.textContent = snap.currentMusicId ?? '-'
}

function renderMeters(): void {
    for (const row of meterRows.values()) {
        row.analyser.getByteTimeDomainData(row.data)
        const meter = meterFromTimeDomain(row.data)
        row.root.classList.toggle('clip', meter.clipping)
        row.fill.style.width = `${Math.min(100, meter.peak * 100).toFixed(1)}%`
        row.value.textContent = formatDb(meter.db)
    }
}

/** ---------------------------------------------------------------- */

function selectEmitter(emitter: EmitterSource | null): void {
    for (const e of emitters) e.setSelected(e === emitter)
    selectedEmitter = emitter
    if (emitter) {
        ui.inspColor.value = '#6ad0ff' // baseline; user can recolor
    }
    renderEmitters()
    renderInspector()
}

function removeEmitter(emitter: EmitterSource): void {
    const idx = emitters.indexOf(emitter)
    if (idx < 0) return
    emitters.splice(idx, 1)
    emitter.dispose()
    if (selectedEmitter === emitter) selectEmitter(null)
    renderEmitters()
}

async function importLocalFiles(): Promise<void> {
    const files = [...(ui.fileInput.files ?? [])]
    if (files.length === 0) return
    const kind = ui.localKind.value as LocalAssetKind
    const existing = new Set(allAssets().map((a) => a.id))
    for (const file of files) {
        const id = makeLocalAssetId(file.name, existing)
        existing.add(id)
        const url = URL.createObjectURL(file)
        const record: LocalAssetRecord = { id, kind, fileName: file.name, url, size: file.size, type: file.type }
        const asset: AudioAsset = { id, url, volume: 1, loop: kind === 'music', maxInstances: 4, priority: 2 }
        try {
            await audio.addAssets(manifestFor(kind, asset))
            localAssets.push(record)
            log(`Imported ${file.name} as ${id}.`)
        } catch (err) {
            URL.revokeObjectURL(url)
            log(`Import failed for ${file.name}: ${String(err)}`)
        }
    }
    ui.fileInput.value = ''
    activeTab = 'local'
    renderAssets()
    // Local imports expand the asset pool — rebuild the bg deck so
    // they're available as background tracks.
    seedBackgroundDeck()
    renderBackgroundDeck()
}

function removeLocalAsset(id: string): void {
    const idx = localAssets.findIndex((a) => a.id === id)
    if (idx < 0) return
    const [asset] = localAssets.splice(idx, 1)
    audio.removeAsset(id)
    URL.revokeObjectURL(asset!.url)
    if (selectedAssetId === id) selectedAssetId = allAssets()[0]?.id ?? null
    renderAssets()
    seedBackgroundDeck()
    renderBackgroundDeck()
    log(`Removed ${id}.`)
}

/** ---------------------------------------------------------------- */

function manifestFor(kind: LocalAssetKind, asset: AudioAsset) {
    if (kind === 'sounds') return { sounds: [asset] }
    if (kind === 'stingers') return { stingers: [asset] }
    return { music: [asset] }
}

function allAssets(): DemoAsset[] {
    const out: DemoAsset[] = []
    for (const asset of GAME_AUDIO_MANIFEST.sounds ?? []) out.push({ ...asset, kind: 'sounds', source: 'manifest' })
    for (const asset of GAME_AUDIO_MANIFEST.stingers ?? []) out.push({ ...asset, kind: 'stingers', source: 'manifest' })
    for (const asset of GAME_AUDIO_MANIFEST.music ?? []) out.push({ ...asset, kind: 'music', source: 'manifest' })
    for (const local of localAssets) {
        out.push({
            id: local.id, url: local.url, kind: local.kind, source: 'local',
            size: local.size, mediaType: local.type, loop: local.kind === 'music',
        })
    }
    return out
}

function assetsForTab(tab: AssetTab): DemoAsset[] {
    const list = allAssets()
    if (tab === 'local') return list.filter((a) => a.source === 'local')
    return list.filter((a) => a.kind === tab && a.source === 'manifest')
}

function currentAsset(): DemoAsset | null {
    if (!selectedAssetId) return null
    return allAssets().find((a) => a.id === selectedAssetId) ?? null
}

/** ---------------------------------------------------------------- */

function readNumber(raw: string, fallback: number): number {
    const v = Number(raw)
    return Number.isFinite(v) ? v : fallback
}

function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id)
    if (!el) throw new Error(`Missing #${id}`)
    return el as T
}

function log(message: string): void {
    const line = document.createElement('div')
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`
    ui.logRoot.prepend(line)
    while (ui.logRoot.children.length > 24) ui.logRoot.lastChild?.remove()
}

void main()

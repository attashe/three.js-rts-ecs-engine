import { AmbientLight, Color, DirectionalLight, GridHelper, MOUSE, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Renderer, WebGPUUnavailableError } from './engine/render/renderer'
import { BLOCK, ChunkManager, ChunkRenderer, DEFAULT_PALETTE, type VoxelEdit } from './engine/voxel'
import {
    generateStructureScene,
    normalizeStructureOptions,
    type HouseStyle,
    type PartialStructureGenerationOptions,
    type RoofStyle,
    type StructureBounds,
    type StructureGenerationResult,
    type StructureGenerationOptions,
    type StructureKind,
    type StructureScale,
    type TowerStyle,
    type TreeSeason,
    type TreeStyle,
    type WallGateMode,
    type WallStyle,
    type WallTerrainMode,
} from './procedural-structures/generator'
import { HOUSE_SCALE_DEFAULTS, TOWER_SCALE_DEFAULTS, WALL_SCALE_DEFAULTS } from './procedural-structures/options'

const RANGE_IDS = [
    'variants',
    'spacing',
    'detail',
    'variation',
    'trunkHeight',
    'trunkRadius',
    'crownRadius',
    'branchDensity',
    'leafNoise',
    'fruitChance',
    'houseWidth',
    'houseDepth',
    'floors',
    'floorHeight',
    'towerRadius',
    'towerHeight',
    'wallThickness',
    'taper',
    'windowEvery',
    'ruinAmount',
    'wallLength',
    'castleWallHeight',
    'castleWallThickness',
    'wallFoundation',
    'wallRuinAmount',
    'terrainSize',
    'terrainNoise',
] as const

const ALL_INPUT_IDS = [
    'kind',
    'seed',
    'cleanLoose',
    'treeStyle',
    'treeSeason',
    'houseScale',
    'houseStyle',
    'roofStyle',
    'sideWing',
    'porch',
    'chimney',
    'landmarkScale',
    'towerScale',
    'towerStyle',
    'spire',
    'wallScale',
    'wallStyle',
    'wallGate',
    'wallTerrainMode',
    'wallBattlements',
    'wallWalkway',
    'showTerrain',
    'showGrid',
    ...RANGE_IDS,
] as const

type VisualStructureScenario = 'house-troll' | 'house-folk' | 'market-troll' | 'stable-troll' | 'church-troll' | 'temple-troll' | 'tower-troll' | 'tower-folk' | 'wall-troll'

interface ProceduralStructuresVisualState {
    scenario: string
    kind: StructureKind
    seed: number
    scale?: StructureScale
    bounds: StructureBounds
    voxelCount: number
    removed: number
    topMaterials: string[]
    statsText: string
}

interface ProceduralStructuresVisualTestApi {
    ready(): Promise<ProceduralStructuresVisualState>
    scenario(): string
    state(): ProceduralStructuresVisualState
    run(command: string, payload?: unknown): Promise<ProceduralStructuresVisualState>
}

declare global {
    interface Window {
        __visualTest?: ProceduralStructuresVisualTestApi
    }
}

async function main(): Promise<void> {
    const errorEl = el('error')
    try {
        const renderer = new Renderer()
        renderer.scene.background = new Color(0xb4c3bd)
        renderer.iso.setViewMode('orbit')

        const ambient = new AmbientLight(0xffffff, 0.56)
        renderer.scene.add(ambient)

        const sun = new DirectionalLight(0xfff1d2, 1.55)
        sun.position.set(38, 62, 28)
        sun.castShadow = true
        sun.shadow.camera.left = -80
        sun.shadow.camera.right = 80
        sun.shadow.camera.top = 80
        sun.shadow.camera.bottom = -80
        sun.shadow.camera.near = 1
        sun.shadow.camera.far = 220
        sun.shadow.mapSize.set(1536, 1536)
        renderer.scene.add(sun)

        const fill = new DirectionalLight(0x8eb6ff, 0.34)
        fill.position.set(-30, 22, -24)
        renderer.scene.add(fill)

        const chunks = new ChunkManager(DEFAULT_PALETTE)
        const chunkRenderer = new ChunkRenderer(renderer.scene, chunks)
        const controls = new OrbitControls(renderer.iso.camera, renderer.webgpu.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.06
        controls.minZoom = 0.18
        controls.maxZoom = 4
        controls.minDistance = 2
        controls.maxDistance = 240
        controls.screenSpacePanning = false
        controls.mouseButtons = {
            LEFT: MOUSE.ROTATE,
            MIDDLE: MOUSE.DOLLY,
            RIGHT: MOUSE.PAN,
        }

        let grid: GridHelper | null = null
        let currentVoxels = new Set<string>()
        let lastVisualState: ProceduralStructuresVisualState | null = null
        let frameCount = 0

        function setGrid(size: number, visible: boolean): void {
            if (grid) {
                renderer.scene.remove(grid)
                grid.geometry.dispose()
                grid.material.dispose()
                grid = null
            }
            if (!visible) return
            grid = new GridHelper(size, size, 0x355049, 0x4c6a60)
            grid.position.y = 0.04
            grid.material.transparent = true
            grid.material.opacity = 0.34
            renderer.scene.add(grid)
        }

        function replaceVoxels(result: StructureGenerationResult): void {
            const edits: VoxelEdit[] = []
            for (const k of currentVoxels) {
                const [x, y, z] = k.split(',').map(Number)
                edits.push({ x: x!, y: y!, z: z!, value: BLOCK.air })
            }
            const next = new Set<string>()
            for (const voxel of result.voxels) {
                edits.push({ x: voxel.x, y: voxel.y, z: voxel.z, value: voxel.block })
                next.add(voxelKey(voxel.x, voxel.y, voxel.z))
            }
            chunks.applyBulk(edits)
            currentVoxels = next
            chunkRenderer.update()
        }

        function regenerate(reframe = true): void {
            try {
                errorEl.style.display = 'none'
                updateValueLabels()
                updateSectionVisibility()
                const opts = readOptions()
                const normalized = normalizeStructureOptions(opts)
                const result = generateStructureScene(normalized, chunks.palette)
                replaceVoxels(result)
                setGrid(normalized.terrainSize, checked('showGrid'))
                updateStats(result)
                lastVisualState = visualState(normalized, result)
                if (reframe) frameCamera(renderer, controls, result.bounds)
            } catch (err) {
                console.error(err)
                errorEl.textContent = err instanceof Error ? err.stack ?? err.message : String(err)
                errorEl.style.display = 'block'
            }
        }

        mountUi(regenerate)
        const urlScenario = visualScenarioFromUrl()
        if (urlScenario) setVisualScenario(urlScenario)
        regenerate()

        await renderer.init()

        let disposed = false
        window.addEventListener('beforeunload', () => {
            if (disposed) return
            disposed = true
            controls.dispose()
            chunkRenderer.dispose()
            renderer.dispose()
        })

        let lastFrame = performance.now()
        function frame(now = performance.now()): void {
            const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000))
            lastFrame = now
            controls.update()
            chunkRenderer.update()
            renderer.update(dt)
            renderer.render()
            frameCount++
            requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
        window.__visualTest = {
            ready: async () => {
                await waitForVisualSettle(() => frameCount, 2)
                return requireVisualState(lastVisualState)
            },
            scenario: () => visualScenarioLabel(),
            state: () => requireVisualState(lastVisualState),
            run: async (command: string, payload?: unknown) => {
                if (command !== 'setScenario') throw new Error(`Unknown visual test command: ${command}`)
                setVisualScenario(readScenarioPayload(payload))
                regenerate(true)
                await waitForVisualSettle(() => frameCount, 4)
                return requireVisualState(lastVisualState)
            },
        }
    } catch (err) {
        if (err instanceof WebGPUUnavailableError) {
            document.body.innerHTML = `<p style="margin:24px;color:#ff9090">${err.message}</p>`
            return
        }
        throw err
    }
}

function mountUi(regenerate: (reframe?: boolean) => void): void {
    const debounced = debounce(() => regenerate(false), 80)
    for (const id of ALL_INPUT_IDS) {
        const node = el(id) as HTMLInputElement | HTMLSelectElement
        node.addEventListener('input', debounced)
        node.addEventListener('change', debounced)
    }
    el('kind').addEventListener('change', () => regenerate(true))
    el('houseScale').addEventListener('change', () => {
        applyHouseScaleDefaults(select('houseScale') as StructureScale)
        regenerate(true)
    })
    el('towerScale').addEventListener('change', () => {
        applyTowerScaleDefaults(select('towerScale') as StructureScale)
        regenerate(true)
    })
    el('wallScale').addEventListener('change', () => {
        applyWallScaleDefaults(select('wallScale') as StructureScale)
        regenerate(true)
    })
    el('regen').addEventListener('click', () => regenerate(true))
    el('randomSeed').addEventListener('click', () => {
        input('seed').value = String(Math.floor(Math.random() * 999999))
        regenerate(true)
    })
    updateValueLabels()
    updateSectionVisibility()
}

function readOptions(): PartialStructureGenerationOptions {
    return {
        kind: select('kind') as StructureKind,
        seed: numberValue('seed'),
        variants: numberValue('variants'),
        spacing: numberValue('spacing'),
        detail: numberValue('detail'),
        variation: numberValue('variation'),
        cleanLoose: checked('cleanLoose'),
        showTerrain: checked('showTerrain'),
        terrainSize: numberValue('terrainSize'),
        terrainNoise: numberValue('terrainNoise'),
        tree: {
            style: select('treeStyle') as TreeStyle,
            season: select('treeSeason') as TreeSeason,
            trunkHeight: numberValue('trunkHeight'),
            trunkRadius: numberValue('trunkRadius'),
            crownRadius: numberValue('crownRadius'),
            branchDensity: numberValue('branchDensity'),
            leafNoise: numberValue('leafNoise'),
            fruitChance: numberValue('fruitChance'),
        },
        house: {
            scale: select('houseScale') as StructureScale,
            style: select('houseStyle') as HouseStyle,
            width: numberValue('houseWidth'),
            depth: numberValue('houseDepth'),
            floors: numberValue('floors'),
            floorHeight: numberValue('floorHeight'),
            roofStyle: select('roofStyle') as RoofStyle,
            sideWing: checked('sideWing'),
            porch: checked('porch'),
            chimney: checked('chimney'),
        },
        landmark: {
            scale: select('landmarkScale') as StructureScale,
        },
        tower: {
            scale: select('towerScale') as StructureScale,
            style: select('towerStyle') as TowerStyle,
            radius: numberValue('towerRadius'),
            height: numberValue('towerHeight'),
            wallThickness: numberValue('wallThickness'),
            taper: numberValue('taper'),
            windowEvery: numberValue('windowEvery'),
            ruinAmount: numberValue('ruinAmount'),
            spire: checked('spire'),
        },
        wall: {
            scale: select('wallScale') as StructureScale,
            style: select('wallStyle') as WallStyle,
            length: numberValue('wallLength'),
            height: numberValue('castleWallHeight'),
            thickness: numberValue('castleWallThickness'),
            foundationDepth: numberValue('wallFoundation'),
            battlements: checked('wallBattlements'),
            walkway: checked('wallWalkway'),
            gate: select('wallGate') as WallGateMode,
            terrainMode: select('wallTerrainMode') as WallTerrainMode,
            ruinAmount: numberValue('wallRuinAmount'),
        },
    }
}

function visualState(options: StructureGenerationOptions, result: StructureGenerationResult): ProceduralStructuresVisualState {
    return {
        scenario: visualScenarioLabel(),
        kind: options.kind,
        seed: options.seed,
        scale: options.kind === 'house' ? options.house.scale : isScalableLandmarkKind(options.kind) ? options.landmark.scale : options.kind === 'temple' ? 'troll' : options.kind === 'tower' ? options.tower.scale : options.kind === 'wall' ? options.wall.scale : undefined,
        bounds: result.bounds,
        voxelCount: result.voxels.length,
        removed: result.removed,
        topMaterials: Object.entries(result.materialCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([block, count]) => `${result.materialNames[Number(block)] ?? block}:${count}`),
        statsText: el('stats').textContent ?? '',
    }
}

function visualScenarioLabel(): string {
    const kind = select('kind') as StructureKind
    if (kind === 'house') return `house-${select('houseScale')}`
    if (isScalableLandmarkKind(kind)) return `${kind}-${select('landmarkScale')}`
    if (kind === 'temple') return 'temple-troll'
    if (kind === 'tower') return `tower-${select('towerScale')}`
    if (kind === 'wall') return `wall-${select('wallScale')}`
    return kind
}

function requireVisualState(state: ProceduralStructuresVisualState | null): ProceduralStructuresVisualState {
    if (!state) throw new Error('Procedural structures visual state is not ready')
    return state
}

function waitForFrames(frame: () => number, count: number): Promise<void> {
    const start = frame()
    return new Promise((resolve) => {
        const tick = () => {
            if (frame() - start >= count) {
                resolve()
                return
            }
            requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
    })
}

function waitForVisualSettle(frame: () => number, count: number): Promise<void> {
    return Promise.race([
        waitForFrames(frame, count),
        new Promise<void>((resolve) => window.setTimeout(resolve, 180)),
    ])
}

function visualScenarioFromUrl(): VisualStructureScenario | null {
    const value = new URLSearchParams(window.location.search).get('visualTest')
    if (!value) return null
    if (value === 'procedural-structures') return null
    const scenario = value.replace(/^structure-/, '')
    return isVisualScenario(scenario) ? scenario : null
}

function readScenarioPayload(payload: unknown): VisualStructureScenario {
    const value = typeof payload === 'string'
        ? payload
        : typeof payload === 'object' && payload !== null && 'id' in payload && typeof payload.id === 'string'
            ? payload.id
            : ''
    if (isVisualScenario(value)) return value
    throw new Error(`Unknown procedural structure visual scenario: ${value}`)
}

function isVisualScenario(value: string): value is VisualStructureScenario {
    return value === 'house-troll'
        || value === 'house-folk'
        || value === 'market-troll'
        || value === 'stable-troll'
        || value === 'church-troll'
        || value === 'temple-troll'
        || value === 'tower-troll'
        || value === 'tower-folk'
        || value === 'wall-troll'
}

function setVisualScenario(scenario: VisualStructureScenario): void {
    setNumber('seed', scenario.startsWith('house') ? 2024 : 2025)
    setNumber('variants', 1)
    setNumber('spacing', 34)
    setNumber('detail', 0.78)
    setNumber('variation', 0)
    setBoolean('cleanLoose', true)
    setBoolean('showTerrain', false)
    setBoolean('showGrid', true)
    setNumber('terrainSize', 48)
    setNumber('terrainNoise', 0)
    if (scenario.startsWith('house')) {
        const scale: StructureScale = scenario === 'house-folk' ? 'folk' : 'troll'
        setSelectValue('kind', 'house')
        setSelectValue('houseScale', scale)
        applyHouseScaleDefaults(scale)
        setSelectValue('houseStyle', 'cottage')
        setSelectValue('roofStyle', 'gable')
        setBoolean('sideWing', false)
        setBoolean('porch', true)
        setBoolean('chimney', true)
        return
    }
    if (scenario.startsWith('wall')) {
        setSelectValue('kind', 'wall')
        setSelectValue('wallScale', 'troll')
        applyWallScaleDefaults('troll')
        setSelectValue('wallStyle', 'curtain')
        setSelectValue('wallGate', 'center')
        setSelectValue('wallTerrainMode', 'flat')
        setBoolean('wallBattlements', true)
        setBoolean('wallWalkway', true)
        setNumber('wallRuinAmount', 0)
        return
    }
    if (scenario.startsWith('temple')) {
        setSelectValue('kind', 'temple')
        setSelectValue('landmarkScale', 'troll')
        setNumber('detail', 0.9)
        setNumber('spacing', 56)
        return
    }
    if (scenario.startsWith('market') || scenario.startsWith('stable') || scenario.startsWith('church')) {
        const kind = scenario.split('-')[0] as StructureKind
        setSelectValue('kind', kind)
        setSelectValue('landmarkScale', scenario.endsWith('folk') ? 'folk' : 'troll')
        setNumber('detail', 0.85)
        setNumber('spacing', 44)
        return
    }
    const scale: StructureScale = scenario === 'tower-folk' ? 'folk' : 'troll'
    setSelectValue('kind', 'tower')
    setSelectValue('towerScale', scale)
    applyTowerScaleDefaults(scale)
    setSelectValue('towerStyle', 'round')
    setNumber('taper', 0)
    setNumber('ruinAmount', 0)
    setBoolean('spire', false)
}

function updateValueLabels(): void {
    for (const id of RANGE_IDS) {
        const out = document.getElementById(`${id}Val`)
        if (!out) continue
        const node = input(id)
        const value = Number(node.value)
        const isFloat = node.step.includes('.') || ['detail', 'variation', 'branchDensity', 'leafNoise', 'fruitChance', 'taper', 'ruinAmount', 'wallRuinAmount', 'terrainNoise'].includes(id)
        out.textContent = isFloat ? value.toFixed(id === 'fruitChance' || id === 'ruinAmount' || id === 'wallRuinAmount' || id === 'terrainNoise' || id === 'taper' ? 2 : 1) : String(value)
    }
}

function applyHouseScaleDefaults(scale: StructureScale): void {
    const d = HOUSE_SCALE_DEFAULTS[scale]
    input('houseWidth').value = String(d.width)
    input('houseDepth').value = String(d.depth)
    input('floors').value = String(d.floors)
    input('floorHeight').value = String(d.floorHeight)
    updateValueLabels()
}

function applyTowerScaleDefaults(scale: StructureScale): void {
    const d = TOWER_SCALE_DEFAULTS[scale]
    input('towerRadius').value = String(d.radius)
    input('towerHeight').value = String(d.height)
    input('wallThickness').value = String(d.wallThickness)
    input('windowEvery').value = String(d.windowEvery)
    input('spire').checked = d.spire
    updateValueLabels()
}

function applyWallScaleDefaults(scale: StructureScale): void {
    const d = WALL_SCALE_DEFAULTS[scale]
    input('wallLength').value = String(d.length)
    input('castleWallHeight').value = String(d.height)
    input('castleWallThickness').value = String(d.thickness)
    input('wallFoundation').value = String(d.foundationDepth)
    updateValueLabels()
}

function updateSectionVisibility(): void {
    const kind = select('kind') as StructureKind
    el('treeSection').classList.toggle('hidden', kind !== 'tree')
    el('houseSection').classList.toggle('hidden', kind !== 'house')
    el('landmarkSection').classList.toggle('hidden', !hasBuildingParams(kind))
    el('landmarkScaleField').classList.toggle('hidden', !isScalableLandmarkKind(kind))
    el('towerSection').classList.toggle('hidden', kind !== 'tower')
    el('wallSection').classList.toggle('hidden', kind !== 'wall')
}

function hasBuildingParams(kind: StructureKind): boolean {
    return isScalableLandmarkKind(kind) || kind === 'temple'
}

function isScalableLandmarkKind(kind: StructureKind): boolean {
    return kind === 'market' || kind === 'stable' || kind === 'church'
}

function updateStats(result: StructureGenerationResult): void {
    const stats = el('stats')
    const bounds = result.bounds
    const entries = Object.entries(result.materialCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([block, count]) => `${result.materialNames[Number(block)] ?? block} ${count}`)
        .join(', ')
    stats.innerHTML = [
        `<b>${result.voxels.length.toLocaleString()} voxels</b>`,
        `Bounds <b>${bounds.width} x ${bounds.height} x ${bounds.depth}</b>`,
        `Removed <b>${result.removed}</b> loose voxels`,
        `Top <b>${entries || 'none'}</b>`,
    ].join('<br>')
}

function frameCamera(renderer: Renderer, controls: OrbitControls, bounds: StructureBounds): void {
    const target = new Vector3(
        (bounds.minX + bounds.maxX + 1) / 2,
        Math.max(2, (bounds.minY + bounds.maxY + 1) / 2),
        (bounds.minZ + bounds.maxZ + 1) / 2,
    )
    const extent = Math.max(bounds.width, bounds.height, bounds.depth, 16)
    const distance = Math.max(72, extent * 2.4)
    const camera = renderer.iso.camera
    controls.target.copy(target)
    renderer.iso.target.copy(target)
    camera.position.set(target.x + distance * 0.72, target.y + distance * 0.52, target.z + distance * 0.82)
    camera.near = 0.1
    camera.far = Math.max(420, distance * 5)
    camera.zoom = Math.max(0.18, Math.min(2.6, 54 / extent))
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    controls.update()
}

function voxelKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

function debounce(fn: () => void, ms: number): () => void {
    let t = 0
    return () => {
        window.clearTimeout(t)
        t = window.setTimeout(fn, ms)
    }
}

function numberValue(id: string): number {
    return Number(input(id).value)
}

function checked(id: string): boolean {
    return input(id).checked
}

function select(id: string): string {
    return (el(id) as HTMLSelectElement).value
}

function setNumber(id: string, value: number): void {
    input(id).value = String(value)
}

function setBoolean(id: string, value: boolean): void {
    input(id).checked = value
}

function setSelectValue(id: string, value: string): void {
    ;(el(id) as HTMLSelectElement).value = value
}

function input(id: string): HTMLInputElement {
    return el(id) as HTMLInputElement
}

function el(id: string): HTMLElement {
    const node = document.getElementById(id)
    if (!node) throw new Error(`Missing #${id}`)
    return node
}

void main()

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
    type StructureKind,
    type TowerStyle,
    type TreeStyle,
} from './procedural-structures/generator'

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
    'terrainSize',
    'terrainNoise',
] as const

const ALL_INPUT_IDS = [
    'kind',
    'seed',
    'cleanLoose',
    'treeStyle',
    'houseStyle',
    'roofStyle',
    'sideWing',
    'porch',
    'chimney',
    'towerStyle',
    'spire',
    'showTerrain',
    'showGrid',
    ...RANGE_IDS,
] as const

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
                if (reframe) frameCamera(renderer, controls, result.bounds)
            } catch (err) {
                console.error(err)
                errorEl.textContent = err instanceof Error ? err.stack ?? err.message : String(err)
                errorEl.style.display = 'block'
            }
        }

        mountUi(regenerate)
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
            requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
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
            trunkHeight: numberValue('trunkHeight'),
            trunkRadius: numberValue('trunkRadius'),
            crownRadius: numberValue('crownRadius'),
            branchDensity: numberValue('branchDensity'),
            leafNoise: numberValue('leafNoise'),
            fruitChance: numberValue('fruitChance'),
        },
        house: {
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
        tower: {
            style: select('towerStyle') as TowerStyle,
            radius: numberValue('towerRadius'),
            height: numberValue('towerHeight'),
            wallThickness: numberValue('wallThickness'),
            taper: numberValue('taper'),
            windowEvery: numberValue('windowEvery'),
            ruinAmount: numberValue('ruinAmount'),
            spire: checked('spire'),
        },
    }
}

function updateValueLabels(): void {
    for (const id of RANGE_IDS) {
        const out = document.getElementById(`${id}Val`)
        if (!out) continue
        const node = input(id)
        const value = Number(node.value)
        const isFloat = node.step.includes('.') || ['detail', 'variation', 'branchDensity', 'leafNoise', 'fruitChance', 'taper', 'ruinAmount', 'terrainNoise'].includes(id)
        out.textContent = isFloat ? value.toFixed(id === 'fruitChance' || id === 'ruinAmount' || id === 'terrainNoise' || id === 'taper' ? 2 : 1) : String(value)
    }
}

function updateSectionVisibility(): void {
    const kind = select('kind') as StructureKind
    el('treeSection').classList.toggle('hidden', !(kind === 'tree' || kind === 'mixed'))
    el('houseSection').classList.toggle('hidden', !(kind === 'house' || kind === 'mixed'))
    el('towerSection').classList.toggle('hidden', !(kind === 'tower' || kind === 'mixed'))
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

function input(id: string): HTMLInputElement {
    return el(id) as HTMLInputElement
}

function el(id: string): HTMLElement {
    const node = document.getElementById(id)
    if (!node) throw new Error(`Missing #${id}`)
    return node
}

void main()

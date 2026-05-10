import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    LineSegments,
    Sprite,
    SpriteMaterial,
    Texture,
    Vector3,
    type Scene,
} from 'three'
import { hasComponent, query } from 'bitecs'
import { Behaviour, BoxCollider, Faction, Health, MovementState, Position } from '../components'
import { behaviourStateName, getBehaviourTarget } from '../behaviour'
import { movementStateName } from '../movement-state'
import type { System } from './system'
import { RenderOrder } from './orders'
import type { Input } from '../../input/input'
import { UiLogPanel } from '../../../ui'

export interface DebugOverlayOptions {
    enabled?: boolean
    updateHz?: number
}

interface LabelState {
    sprite: Sprite
    text: string
}

interface PathState {
    line: Line
    pointCount: number
}

interface BoxBatchState {
    lines: LineSegments
    capacity: number
    count: number
}

export function createDebugOverlaySystem(scene: Scene, input: Input, opts: DebugOverlayOptions = {}): System {
    let enabled = opts.enabled ?? true
    const updateDt = 1 / (opts.updateHz ?? 6)
    const root = new Group()
    root.name = 'DebugOverlay'
    const boxMaterial = new LineBasicMaterial({ color: 0x9cff57 })
    const lineMaterial = new LineBasicMaterial({ color: 0x55d6ff })
    const boxBatch = createBoxBatch(boxMaterial)
    const textTextureByKey = new Map<string, Texture>()
    const labelByEid = new Map<number, LabelState>()
    const pathByEid = new Map<number, PathState>()
    let logPanel: UiLogPanel | null = null
    let metricsPanel: UiLogPanel | null = null
    let lastLogLength = -1
    let accumulator = 0

    return {
        order: RenderOrder.debug,
        init() {
            scene.add(root)
            root.add(boxBatch.lines)
            root.visible = enabled
            logPanel = new UiLogPanel()
            logPanel.setVisible(enabled)
            metricsPanel = new UiLogPanel()
            metricsPanel.element.classList.add('ui-metrics-panel')
            metricsPanel.setVisible(enabled)
        },
        update(world, dt) {
            if (input.consumeKeyPressed('Backquote')) {
                enabled = !enabled
                root.visible = enabled
                logPanel?.setVisible(enabled)
                metricsPanel?.setVisible(enabled)
            }
            if (!enabled) return
            accumulator += dt
            const refreshHeavyDebug = accumulator >= updateDt
            if (refreshHeavyDebug) accumulator %= updateDt

            const eids = query(world, [Behaviour, Position, BoxCollider])
            const live = new Set<number>()
            updateBoxes(boxBatch, eids)
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                live.add(eid)
                updateLabel(world, root, labelByEid, textTextureByKey, eid, refreshHeavyDebug)
                if (refreshHeavyDebug) {
                    updatePath(root, pathByEid, lineMaterial, eid, world.pathByEid.get(eid)?.points)
                } else {
                    updatePathOrigin(pathByEid, eid)
                }
            }
            pruneLabels(root, labelByEid, live)
            if (refreshHeavyDebug) {
                prunePaths(root, pathByEid, live)
                world.metrics.setGauge('debug.boxes', boxBatch.count)
                world.metrics.setGauge('debug.labels', labelByEid.size)
                world.metrics.setGauge('debug.paths', pathByEid.size)
                updateLog(logPanel, world.log, lastLogLength)
                updateMetrics(metricsPanel, world.metrics.summaryLines({ systemCount: 5, gaugeCount: 20 }))
                lastLogLength = world.log.length
            }
        },
        dispose() {
            for (const state of pathByEid.values()) disposePath(state)
            for (const state of labelByEid.values()) disposeLabel(state)
            for (const texture of textTextureByKey.values()) texture.dispose()
            pathByEid.clear()
            labelByEid.clear()
            textTextureByKey.clear()
            root.clear()
            scene.remove(root)
            boxBatch.lines.geometry.dispose()
            boxMaterial.dispose()
            lineMaterial.dispose()
            logPanel?.dispose()
            metricsPanel?.dispose()
            logPanel = null
            metricsPanel = null
        },
    }
}

function createBoxBatch(material: LineBasicMaterial): BoxBatchState {
    const lines = new LineSegments(new BufferGeometry(), material)
    lines.name = 'DebugBoxBatch'
    lines.frustumCulled = false
    return { lines, capacity: 0, count: 0 }
}

function updateBoxes(batch: BoxBatchState, eids: ArrayLike<number>): void {
    const count = eids.length
    ensureBoxCapacity(batch, count)
    batch.count = count
    batch.lines.geometry.setDrawRange(0, count * 24)
    const attribute = batch.lines.geometry.getAttribute('position') as Float32BufferAttribute | undefined
    if (!attribute) return
    const coords = attribute.array
    for (let i = 0; i < count; i++) {
        writeBox(coords, i * 72, eids[i]!)
    }
    attribute.needsUpdate = true
}

function ensureBoxCapacity(batch: BoxBatchState, count: number): void {
    if (count <= batch.capacity) return
    let capacity = Math.max(8, batch.capacity)
    while (capacity < count) capacity *= 2
    batch.lines.geometry.dispose()
    batch.lines.geometry = new BufferGeometry()
    batch.lines.geometry.setAttribute('position', new Float32BufferAttribute(capacity * 72, 3))
    batch.capacity = capacity
}

function writeBox(coords: ArrayLike<number>, offset: number, eid: number): void {
    const out = coords as unknown as number[]
    const minX = Position.x[eid] - BoxCollider.x[eid]
    const minY = Position.y[eid]
    const minZ = Position.z[eid] - BoxCollider.z[eid]
    const maxX = Position.x[eid] + BoxCollider.x[eid]
    const maxY = Position.y[eid] + BoxCollider.y[eid] * 2
    const maxZ = Position.z[eid] + BoxCollider.z[eid]

    writeEdge(out, offset, minX, minY, minZ, maxX, minY, minZ)
    writeEdge(out, offset + 6, maxX, minY, minZ, maxX, minY, maxZ)
    writeEdge(out, offset + 12, maxX, minY, maxZ, minX, minY, maxZ)
    writeEdge(out, offset + 18, minX, minY, maxZ, minX, minY, minZ)
    writeEdge(out, offset + 24, minX, maxY, minZ, maxX, maxY, minZ)
    writeEdge(out, offset + 30, maxX, maxY, minZ, maxX, maxY, maxZ)
    writeEdge(out, offset + 36, maxX, maxY, maxZ, minX, maxY, maxZ)
    writeEdge(out, offset + 42, minX, maxY, maxZ, minX, maxY, minZ)
    writeEdge(out, offset + 48, minX, minY, minZ, minX, maxY, minZ)
    writeEdge(out, offset + 54, maxX, minY, minZ, maxX, maxY, minZ)
    writeEdge(out, offset + 60, maxX, minY, maxZ, maxX, maxY, maxZ)
    writeEdge(out, offset + 66, minX, minY, maxZ, minX, maxY, maxZ)
}

function writeEdge(
    coords: number[],
    offset: number,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
): void {
    coords[offset] = ax
    coords[offset + 1] = ay
    coords[offset + 2] = az
    coords[offset + 3] = bx
    coords[offset + 4] = by
    coords[offset + 5] = bz
}

function updatePath(
    root: Group,
    map: Map<number, PathState>,
    material: LineBasicMaterial,
    eid: number,
    points: Vector3[] | undefined,
): void {
    let state = map.get(eid)
    if (!points || points.length === 0) {
        if (state) {
            root.remove(state.line)
            disposePath(state)
            map.delete(eid)
        }
        return
    }
    if (!state) {
        const line = new Line(new BufferGeometry(), material)
        line.name = `PathDebug${eid}`
        state = { line, pointCount: 0 }
        map.set(eid, state)
        root.add(line)
    }
    const pointCount = points.length + 1
    if (state.pointCount !== pointCount) {
        state.line.geometry.setAttribute('position', new Float32BufferAttribute(pointCount * 3, 3))
        state.pointCount = pointCount
    }

    const attribute = state.line.geometry.getAttribute('position') as Float32BufferAttribute
    const coords = attribute.array
    coords[0] = Position.x[eid]
    coords[1] = Position.y[eid] + 0.08
    coords[2] = Position.z[eid]
    for (let i = 0; i < points.length; i++) {
        const offset = (i + 1) * 3
        const p = points[i]
        coords[offset] = p.x
        coords[offset + 1] = p.y + 0.08
        coords[offset + 2] = p.z
    }
    attribute.needsUpdate = true
    state.line.geometry.computeBoundingSphere()
}

function updatePathOrigin(map: Map<number, PathState>, eid: number): void {
    const state = map.get(eid)
    if (!state) return
    const attribute = state.line.geometry.getAttribute('position') as Float32BufferAttribute | undefined
    if (!attribute) return
    const coords = attribute.array
    coords[0] = Position.x[eid]
    coords[1] = Position.y[eid] + 0.08
    coords[2] = Position.z[eid]
    attribute.needsUpdate = true
}

function updateLabel(
    world: Parameters<System['update']>[0],
    root: Group,
    map: Map<number, LabelState>,
    textureCache: Map<string, Texture>,
    eid: number,
    refreshText: boolean,
): void {
    const faction = hasComponent(world, eid, Faction) ? Faction.id[eid] : 0
    const target = getBehaviourTarget(eid)
    const hp = hasComponent(world, eid, Health)
        ? `${Math.max(0, Math.round(Health.current[eid]))}/${Math.round(Health.max[eid] || 0)}`
        : '--'
    const top = `F${faction} ${behaviourStateName(Behaviour.state[eid])}/${movementStateName(MovementState.value[eid])}`
    const bottom = `tgt:${target ?? '--'} hp:${hp}`
    const text = `${top}\n${bottom}`
    let state = map.get(eid)
    if (!state) {
        const sprite = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false }))
        sprite.name = `DebugLabel${eid}`
        sprite.scale.set(1.7, 0.55, 1)
        state = { sprite, text: '' }
        map.set(eid, state)
        root.add(sprite)
    }
    if (state.text !== text && (refreshText || state.text.length === 0)) {
        const material = state.sprite.material as SpriteMaterial
        material.map = cachedTextTexture(textureCache, text)
        material.needsUpdate = true
        state.text = text
    }
    state.sprite.position.set(Position.x[eid], Position.y[eid] + BoxCollider.y[eid] * 2 + 0.45, Position.z[eid])
}

function cachedTextTexture(cache: Map<string, Texture>, text: string): Texture {
    const existing = cache.get(text)
    if (existing) return existing
    const texture = makeTextTexture(text)
    cache.set(text, texture)
    return texture
}

function makeTextTexture(text: string): Texture {
    const lines = text.split('\n')
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = lines.length > 1 ? 96 : 64
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(8, 12, 16, 0.72)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#d9f7ff'
    ctx.font = '22px ui-monospace, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const lineHeight = 30
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i] ?? '', canvas.width / 2, startY + i * lineHeight)
    }
    const texture = new Texture(canvas)
    texture.needsUpdate = true
    return texture
}

function pruneLabels(root: Group, map: Map<number, LabelState>, live: Set<number>): void {
    for (const [eid, state] of map) {
        if (live.has(eid)) continue
        root.remove(state.sprite)
        disposeLabel(state)
        map.delete(eid)
    }
}

function prunePaths(root: Group, map: Map<number, PathState>, live: Set<number>): void {
    for (const [eid, state] of map) {
        if (live.has(eid)) continue
        root.remove(state.line)
        disposePath(state)
        map.delete(eid)
    }
}

function updateLog(panel: UiLogPanel | null, log: { message: string }[], lastLength: number): void {
    if (!panel || log.length === lastLength) return
    panel.setLines(log.slice(-6).map((entry) => entry.message))
}

function updateMetrics(panel: UiLogPanel | null, lines: string[]): void {
    if (!panel) return
    panel.setLines(lines, 12)
}

function disposePath(state: PathState): void {
    state.line.geometry.dispose()
}

function disposeLabel(state: LabelState): void {
    state.sprite.material.dispose()
}

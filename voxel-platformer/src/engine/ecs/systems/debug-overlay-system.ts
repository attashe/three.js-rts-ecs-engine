import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    Vector3,
    type Camera,
    type Scene,
} from 'three'
import { query } from 'bitecs'
import { BoxCollider, Position } from '../components'
import type { System } from './system'
import { RenderOrder } from './orders'
import { DebugPerfPanel } from './debug-perf-panel'
import type { Input } from '../../input/input'
import { getDebugInfoEnabled, setDebugInfoEnabled, subscribeDebugInfo } from '../../render/render-settings'
import { isTriggerZone, isZoneActive, type Zone } from '../zones'
import { colliderAabbForEntity } from '../collider-bounds'
import type { DebugHitbox } from '../world'
import type { AABB } from '../../voxel/voxel-collide'

/** CSS positioning hints for the floating panels. Each accepts any subset of
 *  the standard offset properties (top / bottom / left / right) so callers
 *  can pin the panel to any corner without dealing with raw CSSStyle. */
export interface PanelPosition {
    top?: string
    bottom?: string
    left?: string
    right?: string
    maxWidth?: string
}

export interface DebugOverlayOptions {
    enabled?: boolean
    updateHz?: number
    /** Where the metrics/inventory panel docks. Default top-left. */
    metricsPosition?: PanelPosition
    /** Where the always-on log panel docks. Default top-right. */
    logPosition?: PanelPosition
    /** Camera used to project world-space debug labels to screen space. */
    cameraProvider?: () => Camera
    /** Viewport element for label projection. Defaults to the full window. */
    renderElement?: HTMLElement
    /** Show DOM labels at zone top centres when a camera is provided. */
    zoneLabels?: boolean
}

interface BoxBatchState {
    lines: LineSegments
    capacity: number
    count: number
}

interface ColoredBoxBatchState extends BoxBatchState {}

interface LineBatchState {
    lines: LineSegments
    vertexCapacity: number
    vertexCount: number
}

/**
 * Minimal debug overlay for the platformer foundation:
 *  - Backtick toggles a Box3 outline for every entity with Position + BoxCollider
 *    (player, stones, arrows, anything physical).
 *  - A DOM perf panel shows stable metric cells plus rolling plots.
 *
 * Re-add visualisation layers (paths, zones, etc) as the project grows.
 */
export function createDebugOverlaySystem(scene: Scene, input: Input, opts: DebugOverlayOptions = {}): System {
    // Default to ON — this is a development-focused project, so we want the
    // player AABB and the metric/log panels visible right away. Backquote
    // toggles when you want a clean view.
    let enabled = opts.enabled ?? getDebugInfoEnabled()
    const updateDt = 1 / (opts.updateHz ?? 4)
    const root = new Group()
    root.name = 'DebugOverlay'
    const boxMaterial = new LineBasicMaterial({
        color: 0x9cff57,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    })
    const hitboxMaterial = new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
    })
    const zoneMaterial = new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
    })
    const boxBatch = createBoxBatch(boxMaterial)
    const hitboxBatch = createLineBatch(hitboxMaterial, 'DebugHitboxBatch')
    const zoneBatch = createColoredBoxBatch(zoneMaterial)
    const zoneLabels = new Map<string, HTMLDivElement>()
    const labelWorldPos = new Vector3()
    let metricsPanel: DebugPerfPanel | null = null
    let logPanel: HTMLDivElement | null = null
    let accumulator = 0
    let lastLogLength = -1
    let unsubscribeDebug: (() => void) | null = null

    function applyVisibility(): void {
        root.visible = enabled
        metricsPanel?.setVisible(enabled)
        if (logPanel) logPanel.style.display = enabled ? 'block' : 'none'
        for (const label of zoneLabels.values()) label.style.display = enabled ? 'block' : 'none'
    }

    return {
        order: RenderOrder.debug,
        init() {
            scene.add(root)
            root.add(boxBatch.lines)
            root.add(hitboxBatch.lines)
            root.add(zoneBatch.lines)

            metricsPanel = new DebugPerfPanel(opts.metricsPosition ?? { top: '8px', left: '8px' })
            document.body.appendChild(metricsPanel.element)

            logPanel = makePanel('voxel-platformer-log', opts.logPosition ?? { top: '8px', right: '8px', maxWidth: '320px' })
            document.body.appendChild(logPanel)
            applyVisibility()
            unsubscribeDebug = subscribeDebugInfo((next) => {
                enabled = next
                applyVisibility()
            })
        },
        update(world, dt) {
            if (input.consumeKeyPressed('Backquote')) {
                setDebugInfoEnabled(!enabled)
            }

            if (enabled) {
                const eids = query(world, [Position, BoxCollider])
                updateBoxes(boxBatch, world, eids)
                updateDebugHitboxes(hitboxBatch, world.debugHitboxes, dt)
                updateZoneBoxes(zoneBatch, world.zones.values())
                updateZoneLabels(zoneLabels, world.zones.values(), opts, labelWorldPos)
            } else if (world.debugHitboxes.length > 0) {
                world.debugHitboxes.length = 0
                hitboxBatch.lines.geometry.setDrawRange(0, 0)
            }

            accumulator += dt
            if (accumulator < updateDt) {
                if (world.log.length !== lastLogLength) renderLog(logPanel, world.log)
                lastLogLength = world.log.length
                return
            }
            accumulator %= updateDt

            if (enabled && metricsPanel) metricsPanel.update(world.metrics.snapshot(), world.inventory.gold, world.inventory.arrows)
            if (world.log.length !== lastLogLength) renderLog(logPanel, world.log)
            lastLogLength = world.log.length
        },
        dispose() {
            scene.remove(root)
            boxBatch.lines.geometry.dispose()
            hitboxBatch.lines.geometry.dispose()
            zoneBatch.lines.geometry.dispose()
            boxMaterial.dispose()
            hitboxMaterial.dispose()
            zoneMaterial.dispose()
            for (const label of zoneLabels.values()) label.remove()
            zoneLabels.clear()
            metricsPanel?.dispose()
            logPanel?.remove()
            unsubscribeDebug?.()
            metricsPanel = null
            logPanel = null
            unsubscribeDebug = null
        },
    }
}

function makePanel(id: string, position: PanelPosition): HTMLDivElement {
    const panel = document.createElement('div')
    panel.id = id
    Object.assign(panel.style, {
        position: 'fixed',
        font: '11px ui-monospace, monospace',
        padding: '6px 8px',
        background: 'rgba(8, 12, 16, 0.72)',
        color: '#d9f7ff',
        pointerEvents: 'none',
        whiteSpace: 'pre',
        lineHeight: '1.5',
        zIndex: '1000',
        ...position,
    } as Partial<CSSStyleDeclaration>)
    return panel
}

function renderLog(panel: HTMLDivElement | null, log: readonly string[]): void {
    if (!panel) return
    panel.textContent = log.slice(-8).join('\n')
}

function updateZoneLabels(
    labels: Map<string, HTMLDivElement>,
    zonesIterable: Iterable<Zone>,
    opts: DebugOverlayOptions,
    tmp: Vector3,
): void {
    if (opts.zoneLabels === false || !opts.cameraProvider) {
        for (const label of labels.values()) label.style.display = 'none'
        return
    }

    const zones = Array.from(zonesIterable)
    const liveIds = new Set(zones.map((zone) => zone.id))
    for (const [id, label] of labels) {
        if (liveIds.has(id)) continue
        label.remove()
        labels.delete(id)
    }

    const camera = opts.cameraProvider()
    const rect = opts.renderElement?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
    }

    for (const zone of zones) {
        const label = labels.get(zone.id) ?? createZoneLabel(zone)
        if (!labels.has(zone.id)) {
            labels.set(zone.id, label)
            document.body.appendChild(label)
        }
        const text = zone.label || zone.id
        if (label.textContent !== text) label.textContent = text
        const [r, g, b] = zoneDebugColor(zone)
        label.style.borderColor = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.72)`
        label.style.color = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`

        tmp.set(
            (zone.min.x + zone.max.x) * 0.5,
            zone.max.y + 0.12,
            (zone.min.z + zone.max.z) * 0.5,
        )
        tmp.project(camera)
        const visible = tmp.z >= -1 && tmp.z <= 1
        label.style.display = visible ? 'block' : 'none'
        if (!visible) continue
        label.style.left = `${rect.left + (tmp.x * 0.5 + 0.5) * rect.width}px`
        label.style.top = `${rect.top + (-tmp.y * 0.5 + 0.5) * rect.height}px`
    }
}

function createZoneLabel(zone: Zone): HTMLDivElement {
    const label = document.createElement('div')
    label.className = 'voxel-platformer-zone-label'
    label.textContent = zone.label || zone.id
    Object.assign(label.style, {
        position: 'fixed',
        transform: 'translate(-50%, -100%)',
        zIndex: '1001',
        padding: '2px 5px',
        border: '1px solid rgba(255,255,255,0.65)',
        borderRadius: '3px',
        background: 'rgba(8, 12, 16, 0.72)',
        font: '10px ui-monospace, monospace',
        lineHeight: '1.2',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        textShadow: '0 1px 2px rgba(0,0,0,0.85)',
    } as Partial<CSSStyleDeclaration>)
    return label
}

function createBoxBatch(material: LineBasicMaterial): BoxBatchState {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(0, 3))
    const lines = new LineSegments(geometry, material)
    lines.name = 'DebugBoxBatch'
    lines.frustumCulled = false
    return { lines, capacity: 0, count: 0 }
}

function createColoredBoxBatch(material: LineBasicMaterial): ColoredBoxBatchState {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(0, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(0, 3))
    const lines = new LineSegments(geometry, material)
    lines.name = 'DebugZoneBatch'
    lines.frustumCulled = false
    lines.renderOrder = 1000
    return { lines, capacity: 0, count: 0 }
}

function createLineBatch(material: LineBasicMaterial, name: string): LineBatchState {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(0, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(0, 3))
    const lines = new LineSegments(geometry, material)
    lines.name = name
    lines.frustumCulled = false
    lines.renderOrder = 10_002
    return { lines, vertexCapacity: 0, vertexCount: 0 }
}

const tmpEntityAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }

function updateBoxes(batch: BoxBatchState, world: Parameters<System['update']>[0], eids: ArrayLike<number>): void {
    const count = eids.length
    ensureBoxCapacity(batch, count)
    batch.count = count
    batch.lines.geometry.setDrawRange(0, count * 24)
    const attribute = batch.lines.geometry.getAttribute('position') as Float32BufferAttribute | undefined
    if (!attribute) return
    const coords = attribute.array as Float32Array
    for (let i = 0; i < count; i++) {
        writeEntityBox(coords, i * 72, world, eids[i]!)
    }
    attribute.needsUpdate = true
}

function updateZoneBoxes(batch: ColoredBoxBatchState, zonesIterable: Iterable<Zone>): void {
    const zones = Array.from(zonesIterable)
    const count = zones.length
    ensureColoredBoxCapacity(batch, count)
    batch.count = count
    batch.lines.geometry.setDrawRange(0, count * 24)
    const position = batch.lines.geometry.getAttribute('position') as Float32BufferAttribute | undefined
    const color = batch.lines.geometry.getAttribute('color') as Float32BufferAttribute | undefined
    if (!position || !color) return
    const coords = position.array as Float32Array
    const colors = color.array as Float32Array
    for (let i = 0; i < count; i++) {
        const zone = zones[i]!
        const offset = i * 72
        writeBoxEdges(
            coords,
            offset,
            zone.min.x, zone.min.y, zone.min.z,
            zone.max.x, zone.max.y, zone.max.z,
        )
        const [r, g, b] = zoneDebugColor(zone)
        writeBoxColor(colors, offset, r, g, b)
    }
    position.needsUpdate = true
    color.needsUpdate = true
}

function updateDebugHitboxes(batch: LineBatchState, hitboxes: DebugHitbox[], dt: number): void {
    for (let i = hitboxes.length - 1; i >= 0; i--) {
        hitboxes[i]!.ttl -= dt
        if (hitboxes[i]!.ttl <= 0) hitboxes.splice(i, 1)
    }
    let vertexCount = 0
    for (const hitbox of hitboxes) vertexCount += hitboxVertexCount(hitbox)
    ensureLineVertexCapacity(batch, vertexCount)
    batch.vertexCount = vertexCount
    batch.lines.geometry.setDrawRange(0, vertexCount)
    if (vertexCount === 0) return

    const position = batch.lines.geometry.getAttribute('position') as Float32BufferAttribute | undefined
    const color = batch.lines.geometry.getAttribute('color') as Float32BufferAttribute | undefined
    if (!position || !color) return
    const coords = position.array as Float32Array
    const colors = color.array as Float32Array
    let offset = 0
    for (const hitbox of hitboxes) {
        const start = offset
        offset = writeDebugHitbox(coords, offset, hitbox)
        const [r, g, b] = hitbox.color
        writeLineColor(colors, start, offset - start, r, g, b)
    }
    position.needsUpdate = true
    color.needsUpdate = true
}

function hitboxVertexCount(hitbox: DebugHitbox): number {
    switch (hitbox.kind) {
        case 'aabb': return 24
        case 'circle': return circleVertexCount()
        case 'wedge': return wedgeVertexCount()
    }
}

function ensureLineVertexCapacity(batch: LineBatchState, vertexCount: number): void {
    if (vertexCount <= batch.vertexCapacity) return
    let capacity = Math.max(64, batch.vertexCapacity)
    while (capacity < vertexCount) capacity *= 2
    batch.lines.geometry.dispose()
    batch.lines.geometry = new BufferGeometry()
    batch.lines.geometry.setAttribute('position', new Float32BufferAttribute(capacity * 3, 3))
    batch.lines.geometry.setAttribute('color', new Float32BufferAttribute(capacity * 3, 3))
    batch.vertexCapacity = capacity
}

function writeDebugHitbox(coords: Float32Array, vertexOffset: number, hitbox: DebugHitbox): number {
    if (hitbox.kind === 'aabb') {
        const o = vertexOffset * 3
        writeBoxEdges(
            coords,
            o,
            hitbox.aabb.minX, hitbox.aabb.minY, hitbox.aabb.minZ,
            hitbox.aabb.maxX, hitbox.aabb.maxY, hitbox.aabb.maxZ,
        )
        return vertexOffset + 24
    }
    if (hitbox.kind === 'circle') return writeCircleEdges(coords, vertexOffset, hitbox)
    return writeWedgeEdges(coords, vertexOffset, hitbox)
}

const WEDGE_STEPS = 10
const CIRCLE_STEPS = 32

function circleVertexCount(): number {
    return CIRCLE_STEPS * 2
}

function writeCircleEdges(coords: Float32Array, vertexOffset: number, hitbox: Extract<DebugHitbox, { kind: 'circle' }>): number {
    let v = vertexOffset
    const cx = hitbox.center.x
    const cy = hitbox.center.y
    const cz = hitbox.center.z
    for (let i = 0; i < CIRCLE_STEPS; i++) {
        const a0 = (Math.PI * 2 * i) / CIRCLE_STEPS
        const a1 = (Math.PI * 2 * (i + 1)) / CIRCLE_STEPS
        v = writeLineVertex(
            coords,
            v,
            cx + Math.sin(a0) * hitbox.radius,
            cy,
            cz + Math.cos(a0) * hitbox.radius,
            cx + Math.sin(a1) * hitbox.radius,
            cy,
            cz + Math.cos(a1) * hitbox.radius,
        )
    }
    return v
}

function wedgeVertexCount(): number {
    // Bottom/top left + right radii (4 segments), two arcs (WEDGE_STEPS each),
    // and three verticals (left, origin, right).
    return (4 + WEDGE_STEPS * 2 + 3) * 2
}

function writeWedgeEdges(coords: Float32Array, vertexOffset: number, hitbox: Extract<DebugHitbox, { kind: 'wedge' }>): number {
    const ox = hitbox.origin.x
    const oz = hitbox.origin.z
    const minY = hitbox.origin.y + hitbox.minY
    const maxY = hitbox.origin.y + hitbox.maxY
    const half = hitbox.arcRadians * 0.5
    const leftYaw = hitbox.yaw - half
    const rightYaw = hitbox.yaw + half
    const leftX = ox + Math.sin(leftYaw) * hitbox.range
    const leftZ = oz + Math.cos(leftYaw) * hitbox.range
    const rightX = ox + Math.sin(rightYaw) * hitbox.range
    const rightZ = oz + Math.cos(rightYaw) * hitbox.range

    let v = vertexOffset
    v = writeLineVertex(coords, v, ox, minY, oz, leftX, minY, leftZ)
    v = writeLineVertex(coords, v, ox, minY, oz, rightX, minY, rightZ)
    v = writeLineVertex(coords, v, ox, maxY, oz, leftX, maxY, leftZ)
    v = writeLineVertex(coords, v, ox, maxY, oz, rightX, maxY, rightZ)
    for (let i = 0; i < WEDGE_STEPS; i++) {
        const a0 = leftYaw + (hitbox.arcRadians * i) / WEDGE_STEPS
        const a1 = leftYaw + (hitbox.arcRadians * (i + 1)) / WEDGE_STEPS
        const x0 = ox + Math.sin(a0) * hitbox.range
        const z0 = oz + Math.cos(a0) * hitbox.range
        const x1 = ox + Math.sin(a1) * hitbox.range
        const z1 = oz + Math.cos(a1) * hitbox.range
        v = writeLineVertex(coords, v, x0, minY, z0, x1, minY, z1)
        v = writeLineVertex(coords, v, x0, maxY, z0, x1, maxY, z1)
    }
    v = writeLineVertex(coords, v, leftX, minY, leftZ, leftX, maxY, leftZ)
    v = writeLineVertex(coords, v, ox, minY, oz, ox, maxY, oz)
    v = writeLineVertex(coords, v, rightX, minY, rightZ, rightX, maxY, rightZ)
    return v
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

function ensureColoredBoxCapacity(batch: ColoredBoxBatchState, count: number): void {
    if (count <= batch.capacity) return
    let capacity = Math.max(8, batch.capacity)
    while (capacity < count) capacity *= 2
    batch.lines.geometry.dispose()
    batch.lines.geometry = new BufferGeometry()
    batch.lines.geometry.setAttribute('position', new Float32BufferAttribute(capacity * 72, 3))
    batch.lines.geometry.setAttribute('color', new Float32BufferAttribute(capacity * 72, 3))
    batch.capacity = capacity
}

function writeEntityBox(coords: Float32Array, offset: number, world: Parameters<System['update']>[0], eid: number): void {
    const aabb = colliderAabbForEntity(world, eid, tmpEntityAabb)
    writeBoxEdges(coords, offset, aabb.minX, aabb.minY, aabb.minZ, aabb.maxX, aabb.maxY, aabb.maxZ)
}

function writeBoxEdges(
    coords: Float32Array,
    offset: number,
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
): void {
    writeEdge(coords, offset + 0,  minX, minY, minZ,  maxX, minY, minZ)
    writeEdge(coords, offset + 6,  maxX, minY, minZ,  maxX, minY, maxZ)
    writeEdge(coords, offset + 12, maxX, minY, maxZ,  minX, minY, maxZ)
    writeEdge(coords, offset + 18, minX, minY, maxZ,  minX, minY, minZ)
    writeEdge(coords, offset + 24, minX, maxY, minZ,  maxX, maxY, minZ)
    writeEdge(coords, offset + 30, maxX, maxY, minZ,  maxX, maxY, maxZ)
    writeEdge(coords, offset + 36, maxX, maxY, maxZ,  minX, maxY, maxZ)
    writeEdge(coords, offset + 42, minX, maxY, maxZ,  minX, maxY, minZ)
    writeEdge(coords, offset + 48, minX, minY, minZ,  minX, maxY, minZ)
    writeEdge(coords, offset + 54, maxX, minY, minZ,  maxX, maxY, minZ)
    writeEdge(coords, offset + 60, maxX, minY, maxZ,  maxX, maxY, maxZ)
    writeEdge(coords, offset + 66, minX, minY, maxZ,  minX, maxY, maxZ)
}

function writeBoxColor(colors: Float32Array, offset: number, r: number, g: number, b: number): void {
    for (let i = 0; i < 24; i++) {
        const j = offset + i * 3
        colors[j + 0] = r
        colors[j + 1] = g
        colors[j + 2] = b
    }
}

function writeLineColor(colors: Float32Array, vertexOffset: number, vertexCount: number, r: number, g: number, b: number): void {
    const end = vertexOffset + vertexCount
    for (let i = vertexOffset; i < end; i++) {
        const j = i * 3
        colors[j + 0] = r
        colors[j + 1] = g
        colors[j + 2] = b
    }
}

function zoneDebugColor(zone: Zone): readonly [number, number, number] {
    if (!isZoneActive(zone)) return [0.44, 0.44, 0.48]
    if (zone.kind === 'arrival') return [0.35, 1.0, 0.62]
    if (zone.kind === 'interact' || zone.interaction) return [1.0, 0.82, 0.28]
    if (zone.kind === 'killzone') return [1.0, 0.24, 0.24]
    if (zone.kind === 'portal' || zone.portal) return [0.55, 0.62, 1.0]
    if (isTriggerZone(zone)) return [0.0, 0.88, 1.0]
    return [1.0, 0.4, 0.8]
}

function writeEdge(
    coords: Float32Array,
    offset: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
): void {
    coords[offset + 0] = ax; coords[offset + 1] = ay; coords[offset + 2] = az
    coords[offset + 3] = bx; coords[offset + 4] = by; coords[offset + 5] = bz
}

function writeLineVertex(
    coords: Float32Array,
    vertexOffset: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
): number {
    const offset = vertexOffset * 3
    writeEdge(coords, offset, ax, ay, az, bx, by, bz)
    return vertexOffset + 2
}

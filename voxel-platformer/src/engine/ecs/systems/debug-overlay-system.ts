import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineSegments,
    type Scene,
} from 'three'
import { query } from 'bitecs'
import { BoxCollider, Position } from '../components'
import type { System } from './system'
import { RenderOrder } from './orders'
import type { Input } from '../../input/input'

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
}

interface BoxBatchState {
    lines: LineSegments
    capacity: number
    count: number
}

/**
 * Minimal debug overlay for the platformer foundation:
 *  - Backtick toggles a Box3 outline for every entity with Position + BoxCollider
 *    (player, stones, arrows, anything physical).
 *  - A small DOM panel in the top-left shows the metric summary lines.
 *
 * Re-add visualisation layers (paths, zones, etc) as the project grows.
 */
export function createDebugOverlaySystem(scene: Scene, input: Input, opts: DebugOverlayOptions = {}): System {
    // Default to ON — this is a development-focused project, so we want the
    // player AABB and the metric/log panels visible right away. Backquote
    // toggles when you want a clean view.
    let enabled = opts.enabled ?? true
    const updateDt = 1 / (opts.updateHz ?? 6)
    const root = new Group()
    root.name = 'DebugOverlay'
    const boxMaterial = new LineBasicMaterial({ color: 0x9cff57 })
    const boxBatch = createBoxBatch(boxMaterial)
    let metricsPanel: HTMLDivElement | null = null
    let logPanel: HTMLDivElement | null = null
    let accumulator = 0
    let lastLogLength = -1

    return {
        order: RenderOrder.debug,
        init() {
            scene.add(root)
            root.add(boxBatch.lines)
            root.visible = enabled

            metricsPanel = makePanel('voxel-platformer-debug', opts.metricsPosition ?? { top: '8px', left: '8px' })
            metricsPanel.style.display = enabled ? 'block' : 'none'
            document.body.appendChild(metricsPanel)

            // The log panel stays always-visible — it's the primary
            // feedback channel for pickups and spell casts, which players
            // want regardless of whether they're inspecting metrics.
            logPanel = makePanel('voxel-platformer-log', opts.logPosition ?? { top: '8px', right: '8px', maxWidth: '320px' })
            document.body.appendChild(logPanel)
        },
        update(world, dt) {
            if (input.consumeKeyPressed('Backquote')) {
                enabled = !enabled
                root.visible = enabled
                if (metricsPanel) metricsPanel.style.display = enabled ? 'block' : 'none'
            }

            if (enabled) {
                const eids = query(world, [Position, BoxCollider])
                updateBoxes(boxBatch, eids)
            }

            accumulator += dt
            if (accumulator < updateDt) {
                if (world.log.length !== lastLogLength) renderLog(logPanel, world.log)
                lastLogLength = world.log.length
                return
            }
            accumulator %= updateDt

            if (enabled && metricsPanel) {
                const inv = `inventory  gold:${world.inventory.gold}  arrows:${world.inventory.arrows}`
                const metrics = world.metrics.summaryLines({
                    systemCount: 6,
                    gaugeCount: 10,
                })
                metricsPanel.textContent = [inv, ...metrics].join('\n')
            }
            if (world.log.length !== lastLogLength) renderLog(logPanel, world.log)
            lastLogLength = world.log.length
        },
        dispose() {
            scene.remove(root)
            boxBatch.lines.geometry.dispose()
            boxMaterial.dispose()
            metricsPanel?.remove()
            logPanel?.remove()
            metricsPanel = null
            logPanel = null
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
    const coords = attribute.array as Float32Array
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

function writeBox(coords: Float32Array, offset: number, eid: number): void {
    const minX = Position.x[eid] - BoxCollider.x[eid]
    const minY = Position.y[eid]
    const minZ = Position.z[eid] - BoxCollider.z[eid]
    const maxX = Position.x[eid] + BoxCollider.x[eid]
    const maxY = Position.y[eid] + BoxCollider.y[eid] * 2
    const maxZ = Position.z[eid] + BoxCollider.z[eid]

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

function writeEdge(
    coords: Float32Array,
    offset: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
): void {
    coords[offset + 0] = ax; coords[offset + 1] = ay; coords[offset + 2] = az
    coords[offset + 3] = bx; coords[offset + 4] = by; coords[offset + 5] = bz
}


import { MetricHistory, type MetricHistoryStats } from '../../perf-history'
import type { MetricsSnapshot, TimingSnapshot } from '../../metrics'

export interface DebugPerfPanelPosition {
    top?: string
    bottom?: string
    left?: string
    right?: string
    maxWidth?: string
}

interface MetricCell {
    value: HTMLSpanElement
    sub: HTMLSpanElement
}

interface SystemRow {
    name: HTMLSpanElement
    avg: HTMLSpanElement
    last: HTMLSpanElement
    max: HTMLSpanElement
}

interface BandOptions {
    label: string
    color: string
    max: number
    markers: number[]
    unit: string
}

interface MemoryDisplay {
    valueMb: number | null
    valueText: string
    subText: string
}

export class DebugPerfPanel {
    readonly element: HTMLDivElement
    private readonly canvas: HTMLCanvasElement
    private readonly ctx: CanvasRenderingContext2D | null
    private readonly cells: Record<string, MetricCell>
    private readonly systemRows: SystemRow[]
    private readonly fpsHistory = new MetricHistory(120)
    private readonly frameHistory = new MetricHistory(120)
    private readonly fixedHistory = new MetricHistory(120)
    private readonly drawHistory = new MetricHistory(120)
    private readonly triangleHistory = new MetricHistory(120)
    private readonly heapHistory = new MetricHistory(120)
    private readonly plotWidth = 320
    private readonly plotHeight = 126

    constructor(position: DebugPerfPanelPosition) {
        this.element = document.createElement('div')
        this.element.id = 'voxel-platformer-debug'
        Object.assign(this.element.style, {
            position: 'fixed',
            width: '340px',
            maxWidth: 'calc(100vw - 16px)',
            padding: '8px',
            background: 'rgba(7, 10, 14, 0.86)',
            color: '#d9f7ff',
            border: '1px solid rgba(145, 188, 210, 0.28)',
            borderRadius: '6px',
            boxShadow: '0 8px 22px rgba(0,0,0,0.28)',
            pointerEvents: 'none',
            font: '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            lineHeight: '1.35',
            zIndex: '1000',
            ...position,
        } as Partial<CSSStyleDeclaration>)

        const header = document.createElement('div')
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '6px',
        } as Partial<CSSStyleDeclaration>)
        const title = document.createElement('span')
        title.textContent = 'Perf'
        Object.assign(title.style, {
            color: '#ffffff',
            fontWeight: '700',
            letterSpacing: '0',
        } as Partial<CSSStyleDeclaration>)
        const hint = document.createElement('span')
        hint.textContent = 'rolling 30s'
        Object.assign(hint.style, {
            color: 'rgba(217,247,255,0.62)',
            fontSize: '10px',
        } as Partial<CSSStyleDeclaration>)
        header.append(title, hint)

        const grid = document.createElement('div')
        Object.assign(grid.style, {
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '5px',
            marginBottom: '7px',
        } as Partial<CSSStyleDeclaration>)

        this.cells = {
            fps: createMetricCell(grid, 'FPS'),
            frame: createMetricCell(grid, 'Frame'),
            fixed: createMetricCell(grid, 'Fixed'),
            calls: createMetricCell(grid, 'Calls'),
            triangles: createMetricCell(grid, 'Tris'),
            visible: createMetricCell(grid, 'Visible'),
            instanced: createMetricCell(grid, 'Inst'),
            heap: createMetricCell(grid, 'Mem'),
            inventory: createMetricCell(grid, 'Inventory'),
        }

        this.canvas = document.createElement('canvas')
        this.canvas.width = this.plotWidth
        this.canvas.height = this.plotHeight
        Object.assign(this.canvas.style, {
            display: 'block',
            width: '100%',
            height: `${this.plotHeight}px`,
            border: '1px solid rgba(145, 188, 210, 0.18)',
            borderRadius: '4px',
            background: 'rgba(0,0,0,0.18)',
            marginBottom: '7px',
        } as Partial<CSSStyleDeclaration>)
        this.ctx = this.canvas.getContext('2d')
        this.resizeCanvas()

        const systems = document.createElement('div')
        Object.assign(systems.style, {
            display: 'grid',
            gap: '2px',
        } as Partial<CSSStyleDeclaration>)
        const systemHeader = createSystemRow()
        systemHeader.name.textContent = 'system'
        systemHeader.avg.textContent = 'avg'
        systemHeader.last.textContent = 'last'
        systemHeader.max.textContent = 'max'
        styleSystemHeader(systemHeader)
        systems.appendChild(systemHeader.name.parentElement!)

        this.systemRows = []
        for (let i = 0; i < 5; i++) {
            const row = createSystemRow()
            this.systemRows.push(row)
            systems.appendChild(row.name.parentElement!)
        }

        this.element.append(header, grid, this.canvas, systems)
    }

    setVisible(visible: boolean): void {
        this.element.style.display = visible ? 'block' : 'none'
    }

    update(snapshot: MetricsSnapshot, gold: number, arrows: number): void {
        const drawCalls = gauge(snapshot, 'render.drawCalls')
        const renderPasses = gauge(snapshot, 'render.frameCalls')
        const triangles = gauge(snapshot, 'render.infoTriangles') ?? gauge(snapshot, 'render.triangles')
        const memory = memoryDisplay(snapshot)

        this.fpsHistory.push(snapshot.fps > 0 ? snapshot.fps : null)
        this.frameHistory.push(snapshot.lastRenderMs)
        this.fixedHistory.push(snapshot.fixedHz > 0 ? snapshot.fixedHz : null)
        this.drawHistory.push(drawCalls)
        this.triangleHistory.push(triangles)
        this.heapHistory.push(memory.valueMb)

        setCell(this.cells.fps, formatNumber(snapshot.fps, 0), statsSuffix(this.fpsHistory.stats(), 'avg', 0))
        setCell(this.cells.frame, formatMs(snapshot.lastRenderMs), statsSuffix(this.frameHistory.stats(), 'avg', 1))
        setCell(this.cells.fixed, `${formatNumber(snapshot.fixedHz, 0)} hz`, statsSuffix(this.fixedHistory.stats(), 'avg', 0))
        setCell(this.cells.calls, drawCalls === null ? 'n/a' : formatCompact(drawCalls), drawCallSuffix(this.drawHistory.stats(), renderPasses))
        setCell(this.cells.triangles, triangles === null ? 'n/a' : formatCompact(triangles), statsSuffix(this.triangleHistory.stats(), 'max', 0))
        setCell(this.cells.visible, formatCompact(gauge(snapshot, 'render.visible') ?? 0), `obj ${formatCompact(gauge(snapshot, 'render.objects') ?? 0)}`)
        setCell(this.cells.instanced, formatCompact(gauge(snapshot, 'render.instanced') ?? 0), `mesh ${formatCompact(gauge(snapshot, 'render.meshes') ?? 0)}`)
        setCell(this.cells.heap, memory.valueText, memory.subText)
        setCell(this.cells.inventory, `${gold}g ${arrows}a`, 'gold arrows')

        const systems = snapshot.timings
            .slice()
            .sort((a, b) => b.avgMs - a.avgMs)
            .slice(0, this.systemRows.length)
        for (let i = 0; i < this.systemRows.length; i++) {
            writeSystemRow(this.systemRows[i]!, systems[i])
        }

        this.drawPlots()
    }

    dispose(): void {
        this.element.remove()
    }

    private resizeCanvas(): void {
        const dpr = typeof window !== 'undefined' ? Math.max(1, Math.min(window.devicePixelRatio || 1, 2)) : 1
        const width = Math.floor(this.plotWidth * dpr)
        const height = Math.floor(this.plotHeight * dpr)
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width
            this.canvas.height = height
        }
        if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    private drawPlots(): void {
        if (!this.ctx) return
        this.resizeCanvas()
        const ctx = this.ctx
        const width = this.plotWidth
        const height = this.plotHeight
        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = 'rgba(4, 8, 12, 0.78)'
        ctx.fillRect(0, 0, width, height)

        const bandHeight = height / 3
        drawBand(ctx, 0, bandHeight, width, this.frameHistory, {
            label: 'frame ms',
            color: '#7fffb0',
            max: Math.max(34, roundUp(this.frameHistory.stats().max ?? 34)),
            markers: [16.7, 33.3],
            unit: 'ms',
        })
        drawBand(ctx, bandHeight, bandHeight, width, this.drawHistory, {
            label: 'draw calls',
            color: '#79c7ff',
            max: Math.max(1, roundUp(this.drawHistory.stats().max ?? 1)),
            markers: [],
            unit: '',
        })
        drawBand(ctx, bandHeight * 2, bandHeight, width, this.heapHistory, {
            label: 'memory MB',
            color: '#ffd166',
            max: Math.max(1, roundUp(this.heapHistory.stats().max ?? 1)),
            markers: [],
            unit: 'MB',
        })
    }
}

function createMetricCell(parent: HTMLElement, labelText: string): MetricCell {
    const cell = document.createElement('div')
    Object.assign(cell.style, {
        minWidth: '0',
        padding: '4px 5px',
        border: '1px solid rgba(145, 188, 210, 0.13)',
        borderRadius: '4px',
        background: 'rgba(255,255,255,0.035)',
    } as Partial<CSSStyleDeclaration>)

    const label = document.createElement('div')
    label.textContent = labelText
    Object.assign(label.style, {
        color: 'rgba(217,247,255,0.58)',
        fontSize: '9px',
        textTransform: 'uppercase',
    } as Partial<CSSStyleDeclaration>)

    const value = document.createElement('span')
    value.textContent = 'n/a'
    Object.assign(value.style, {
        display: 'block',
        color: '#ffffff',
        fontSize: '13px',
        fontWeight: '700',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    } as Partial<CSSStyleDeclaration>)

    const sub = document.createElement('span')
    sub.textContent = ''
    Object.assign(sub.style, {
        display: 'block',
        color: 'rgba(217,247,255,0.54)',
        fontSize: '9px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    } as Partial<CSSStyleDeclaration>)

    cell.append(label, value, sub)
    parent.appendChild(cell)
    return { value, sub }
}

function createSystemRow(): SystemRow {
    const row = document.createElement('div')
    Object.assign(row.style, {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 44px 44px 44px',
        columnGap: '6px',
        alignItems: 'baseline',
        minHeight: '15px',
    } as Partial<CSSStyleDeclaration>)

    const name = document.createElement('span')
    const avg = document.createElement('span')
    const last = document.createElement('span')
    const max = document.createElement('span')
    for (const el of [name, avg, last, max]) {
        Object.assign(el.style, {
            minWidth: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
        } as Partial<CSSStyleDeclaration>)
    }
    Object.assign(name.style, { color: 'rgba(217,247,255,0.78)' } as Partial<CSSStyleDeclaration>)
    for (const el of [avg, last, max]) {
        Object.assign(el.style, {
            color: 'rgba(217,247,255,0.66)',
            textAlign: 'right',
        } as Partial<CSSStyleDeclaration>)
    }
    row.append(name, avg, last, max)
    return { name, avg, last, max }
}

function styleSystemHeader(row: SystemRow): void {
    for (const el of [row.name, row.avg, row.last, row.max]) {
        Object.assign(el.style, {
            color: 'rgba(217,247,255,0.48)',
            fontSize: '9px',
            textTransform: 'uppercase',
        } as Partial<CSSStyleDeclaration>)
    }
}

function setCell(cell: MetricCell, value: string, sub: string): void {
    if (cell.value.textContent !== value) cell.value.textContent = value
    if (cell.sub.textContent !== sub) cell.sub.textContent = sub
}

function writeSystemRow(row: SystemRow, stat: TimingSnapshot | undefined): void {
    const name = stat ? `${stat.phase}.${stat.name}` : ''
    const avg = stat ? stat.avgMs.toFixed(stat.avgMs >= 10 ? 1 : 2) : ''
    const last = stat ? stat.lastMs.toFixed(stat.lastMs >= 10 ? 1 : 2) : ''
    const max = stat ? stat.maxMs.toFixed(stat.maxMs >= 10 ? 1 : 2) : ''
    if (row.name.textContent !== name) row.name.textContent = name
    if (row.avg.textContent !== avg) row.avg.textContent = avg
    if (row.last.textContent !== last) row.last.textContent = last
    if (row.max.textContent !== max) row.max.textContent = max
}

function drawBand(
    ctx: CanvasRenderingContext2D,
    y: number,
    height: number,
    width: number,
    history: MetricHistory,
    opts: BandOptions,
): void {
    const left = 42
    const right = 6
    const top = y + 6
    const bottom = y + height - 7
    const plotWidth = width - left - right
    const plotHeight = bottom - top
    const stats = history.stats()
    const max = Math.max(opts.max, 1)

    ctx.fillStyle = y === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.012)'
    ctx.fillRect(0, y, width, height)
    ctx.strokeStyle = 'rgba(145,188,210,0.12)'
    ctx.beginPath()
    ctx.moveTo(0, y + height)
    ctx.lineTo(width, y + height)
    ctx.stroke()

    ctx.font = '9px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(217,247,255,0.58)'
    ctx.fillText(opts.label, 7, y + 13)
    const latest = stats.latest === null ? 'n/a' : `${formatNumber(stats.latest, opts.unit === 'ms' ? 1 : 0)}${opts.unit}`
    ctx.fillText(latest, 7, y + 26)

    for (const marker of opts.markers) {
        if (marker > max) continue
        const markerY = bottom - (marker / max) * plotHeight
        ctx.strokeStyle = marker <= 17 ? 'rgba(127,255,176,0.24)' : 'rgba(255,209,102,0.28)'
        ctx.beginPath()
        ctx.moveTo(left, markerY)
        ctx.lineTo(width - right, markerY)
        ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(145,188,210,0.16)'
    ctx.strokeRect(left, top, plotWidth, plotHeight)
    ctx.strokeStyle = opts.color
    ctx.lineWidth = 1.4
    ctx.beginPath()
    let started = false
    let pointCount = 0
    history.forEachSample((value, index, count) => {
        if (value === null) {
            started = false
            return
        }
        const x = count <= 1 ? left + plotWidth : left + (index / (count - 1)) * plotWidth
        const clamped = Math.max(0, Math.min(max, value))
        const py = bottom - (clamped / max) * plotHeight
        if (!started) {
            ctx.moveTo(x, py)
            started = true
        } else {
            ctx.lineTo(x, py)
        }
        pointCount++
    })
    if (pointCount > 1) ctx.stroke()
    ctx.lineWidth = 1
}

function gauge(snapshot: MetricsSnapshot, name: string): number | null {
    for (const [key, value] of snapshot.gauges) {
        if (key === name) return Number.isFinite(value) ? value : null
    }
    return null
}

function memoryDisplay(snapshot: MetricsSnapshot): MemoryDisplay {
    const heap = gauge(snapshot, 'memory.jsHeapUsedMB')
    if (heap !== null) {
        return {
            valueMb: heap,
            valueText: `${formatNumber(heap, 1)} MB`,
            subText: heapLimitText(snapshot),
        }
    }

    const gpu = gauge(snapshot, 'memory.gpuTotalMB')
    if (gpu !== null && gpu > 0) {
        const textures = gauge(snapshot, 'memory.gpuTexturesMB')
        const attributes = gauge(snapshot, 'memory.gpuAttributesMB')
        const detail = textures !== null || attributes !== null
            ? `GPU tex ${formatNumber(textures ?? 0, 1)} attr ${formatNumber(attributes ?? 0, 1)}`
            : 'GPU tracked'
        return {
            valueMb: gpu,
            valueText: `${formatNumber(gpu, 1)} MB`,
            subText: detail,
        }
    }

    const sceneGeometry = gauge(snapshot, 'memory.sceneGeometryMB')
    if (sceneGeometry !== null) {
        return {
            valueMb: sceneGeometry,
            valueText: `${formatNumber(sceneGeometry, 1)} MB`,
            subText: 'geometry est.',
        }
    }

    if (gpu !== null) {
        return {
            valueMb: gpu,
            valueText: `${formatNumber(gpu, 1)} MB`,
            subText: 'GPU tracked',
        }
    }

    return { valueMb: null, valueText: 'n/a', subText: 'memory n/a' }
}

function heapLimitText(snapshot: MetricsSnapshot): string {
    const total = gauge(snapshot, 'memory.jsHeapTotalMB')
    const limit = gauge(snapshot, 'memory.jsHeapLimitMB')
    if (total === null && limit === null) return 'JS heap'
    if (total !== null && limit !== null && limit > 0) return `JS ${formatNumber(total, 0)}/${formatNumber(limit, 0)}`
    if (total !== null) return `JS ${formatNumber(total, 0)} total`
    return `JS ${formatNumber(limit ?? 0, 0)} limit`
}

function drawCallSuffix(stats: MetricHistoryStats, renderPasses: number | null): string {
    const max = stats.max === null ? 'n/a' : formatNumber(stats.max, 0)
    if (renderPasses === null) return `max ${max}`
    return `pass ${formatNumber(renderPasses, 0)} max ${max}`
}

function statsSuffix(stats: MetricHistoryStats, kind: 'avg' | 'max', digits: number): string {
    const value = kind === 'avg' ? stats.avg : stats.max
    if (value === null) return `${kind} n/a`
    return `${kind} ${formatNumber(value, digits)}`
}

function formatMs(value: number): string {
    return `${value.toFixed(value >= 10 ? 1 : 2)}ms`
}

function formatNumber(value: number, digits = 1): string {
    if (!Number.isFinite(value)) return 'n/a'
    return value.toFixed(digits)
}

function formatCompact(value: number): string {
    if (!Number.isFinite(value)) return 'n/a'
    const abs = Math.abs(value)
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
    if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}k`
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
    return value.toFixed(0)
}

function roundUp(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 1
    const pow = Math.pow(10, Math.floor(Math.log10(value)))
    return Math.ceil(value / pow) * pow
}

export type MetricsPhase = 'fixed' | 'render'

export interface TimingSnapshot {
    phase: MetricsPhase
    name: string
    calls: number
    lastMs: number
    avgMs: number
    maxMs: number
}

interface TimingStat extends TimingSnapshot {
    totalMs: number
}

export interface MetricsSummaryOptions {
    systemCount?: number
    gaugeCount?: number
    counterCount?: number
}

const DEFAULT_SYSTEM_COUNT = 7
const DEFAULT_GAUGE_COUNT = 5
const DEFAULT_COUNTER_COUNT = 5
const AVG_ALPHA = 0.12

const defaultNow = (): number => {
    if (typeof performance !== 'undefined') return performance.now()
    return Date.now()
}

export class EngineMetrics {
    private readonly timings = new Map<string, TimingStat>()
    private readonly gauges = new Map<string, number>()
    private readonly counters = new Map<string, number>()
    private renderFrames = 0
    private fixedSteps = 0
    private sampleSeconds = 0
    private fps = 0
    private fixedHz = 0
    private lastRenderMs = 0

    constructor(private readonly now: () => number = defaultNow) {}

    timeSystem<T>(phase: MetricsPhase, name: string, fn: () => T): T {
        const startedAt = this.now()
        try {
            return fn()
        } finally {
            this.recordTiming(phase, name, Math.max(0, this.now() - startedAt))
        }
    }

    recordRenderFrame(dt: number): void {
        this.renderFrames++
        this.sampleSeconds += dt
        this.lastRenderMs = dt * 1000

        if (this.sampleSeconds < 0.5) return
        this.fps = this.renderFrames / this.sampleSeconds
        this.fixedHz = this.fixedSteps / this.sampleSeconds
        this.renderFrames = 0
        this.fixedSteps = 0
        this.sampleSeconds = 0
    }

    recordFixedStep(): void {
        this.fixedSteps++
    }

    setGauge(name: string, value: number): void {
        this.gauges.set(name, value)
    }

    incrementCounter(name: string, by = 1): void {
        this.counters.set(name, (this.counters.get(name) ?? 0) + by)
    }

    timingSnapshot(): TimingSnapshot[] {
        return Array.from(this.timings.values(), (stat) => ({
            phase: stat.phase,
            name: stat.name,
            calls: stat.calls,
            lastMs: stat.lastMs,
            avgMs: stat.avgMs,
            maxMs: stat.maxMs,
        }))
    }

    summaryLines(opts: MetricsSummaryOptions = {}): string[] {
        const systemCount = opts.systemCount ?? DEFAULT_SYSTEM_COUNT
        const gaugeCount = opts.gaugeCount ?? DEFAULT_GAUGE_COUNT
        const counterCount = opts.counterCount ?? DEFAULT_COUNTER_COUNT
        const lines = [
            `perf fps:${formatNumber(this.fps)} render:${formatMs(this.lastRenderMs)} fixed:${formatNumber(this.fixedHz)}hz`,
        ]

        const systems = this.timingSnapshot()
            .sort((a, b) => b.avgMs - a.avgMs)
            .slice(0, systemCount)
        for (const stat of systems) {
            lines.push(`${stat.phase} ${stat.name}: avg ${formatMs(stat.avgMs)} last ${formatMs(stat.lastMs)}`)
        }

        const gauges = firstEntries(this.gauges, gaugeCount).sort(([a], [b]) => a.localeCompare(b))
        for (let i = 0; i < gauges.length; i += 5) {
            const chunk = gauges.slice(i, i + 5)
            lines.push(`gauges ${chunk.map(([key, value]) => `${key}:${formatNumber(value)}`).join(' ')}`)
        }

        const counters = firstEntries(this.counters, counterCount)
        if (counters.length > 0) {
            lines.push(`counters ${counters.map(([key, value]) => `${key}:${formatNumber(value)}`).join(' ')}`)
        }

        return lines
    }

    private recordTiming(phase: MetricsPhase, name: string, ms: number): void {
        const key = `${phase}:${name}`
        let stat = this.timings.get(key)
        if (!stat) {
            stat = {
                phase,
                name,
                calls: 0,
                totalMs: 0,
                lastMs: 0,
                avgMs: 0,
                maxMs: 0,
            }
            this.timings.set(key, stat)
        }

        stat.calls++
        stat.totalMs += ms
        stat.lastMs = ms
        stat.avgMs = stat.calls === 1 ? ms : stat.avgMs * (1 - AVG_ALPHA) + ms * AVG_ALPHA
        stat.maxMs = Math.max(stat.maxMs, ms)
    }
}

function firstEntries(map: Map<string, number>, count: number): Array<[string, number]> {
    const entries: Array<[string, number]> = []
    for (const entry of map) {
        entries.push(entry)
        if (entries.length >= count) break
    }
    return entries
}

function formatMs(value: number): string {
    return `${value.toFixed(value >= 10 ? 1 : 2)}ms`
}

function formatNumber(value: number): string {
    if (value >= 100) return value.toFixed(0)
    if (value >= 10) return value.toFixed(1)
    return value.toFixed(2)
}

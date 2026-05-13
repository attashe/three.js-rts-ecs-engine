export interface SchedulerCallbacks {
    fixed: (dt: number) => void
    render: (dt: number) => void
}

// Fixed + render scheduler. Drains the accumulator at a fixed step (default
// 60 Hz) before each render frame. Caps frame delta at 100 ms so a paused tab
// resuming doesn't spiral the simulation.
export class Scheduler {
    private readonly fixedDt: number
    private readonly maxFrameDt: number
    private accumulator = 0
    private last = 0
    private running = false
    private rafId = 0

    constructor(opts: { fixedHz?: number; maxFrameDt?: number } = {}) {
        const fixedHz = opts.fixedHz ?? 60
        const maxFrameDt = opts.maxFrameDt ?? 0.1
        if (!Number.isFinite(fixedHz) || fixedHz <= 0) {
            throw new Error(`Scheduler: fixedHz must be a positive finite number, got ${fixedHz}`)
        }
        if (!Number.isFinite(maxFrameDt) || maxFrameDt <= 0) {
            throw new Error(`Scheduler: maxFrameDt must be a positive finite number, got ${maxFrameDt}`)
        }
        this.fixedDt = 1 / fixedHz
        this.maxFrameDt = maxFrameDt
    }

    start(callbacks: SchedulerCallbacks): void {
        if (this.running) return
        this.running = true
        this.accumulator = 0
        this.last = performance.now()
        const tick = (now: number) => {
            if (!this.running) return
            this.rafId = requestAnimationFrame(tick)
            const renderDt = Math.min((now - this.last) / 1000, this.maxFrameDt)
            this.last = now
            this.accumulator += renderDt
            while (this.accumulator >= this.fixedDt) {
                callbacks.fixed(this.fixedDt)
                this.accumulator -= this.fixedDt
            }
            callbacks.render(renderDt)
        }
        this.rafId = requestAnimationFrame(tick)
    }

    stop(): void {
        this.running = false
        this.accumulator = 0
        cancelAnimationFrame(this.rafId)
    }
}

import { Renderer } from './render/renderer'
import { Scheduler } from './scheduler'
import Signals from './signals'
import { createGameWorld, type GameWorld } from './ecs/world'
import type { System } from './ecs/systems/system'
import { Input } from './input/input'
import type { MetricsPhase } from './metrics'

export interface EngineOptions {
    fixedHz?: number
}

export class Engine {
    readonly world: GameWorld
    readonly renderer: Renderer
    readonly scheduler: Scheduler
    readonly signals: Signals
    readonly input: Input

    private readonly fixedSystems: System[] = []
    private readonly renderSystems: System[] = []
    private readonly systemLabels = new WeakMap<System, string>()
    private started = false
    private disposed = false

    constructor(opts: EngineOptions = {}) {
        this.world = createGameWorld()
        this.renderer = new Renderer()
        this.scheduler = new Scheduler({ fixedHz: opts.fixedHz })
        this.signals = new Signals()
        this.input = new Input(this.renderer.webgpu.domElement)
    }

    addSystem(system: System, name?: string): this {
        if (this.disposed) {
            throw new Error('Engine.addSystem: cannot register a system after stop()')
        }
        if (this.started) {
            throw new Error('Engine.addSystem: cannot register a system after start()')
        }
        const bucket = system.fixed ? this.fixedSystems : this.renderSystems
        bucket.push(system)
        this.systemLabels.set(system, name ?? system.name ?? fallbackSystemLabel(system, bucket.length - 1))
        this.fixedSystems.sort(compareSystems)
        this.renderSystems.sort(compareSystems)
        return this
    }

    /** Initialise the WebGPU device and begin the simulation loop. */
    async start(): Promise<void> {
        if (this.disposed) {
            throw new Error('Engine.start: cannot restart a stopped engine')
        }
        if (this.started) return

        await this.renderer.init()

        const initialized: System[] = []
        try {
            for (const s of this.fixedSystems) {
                s.init?.(this.world)
                initialized.push(s)
            }
            for (const s of this.renderSystems) {
                s.init?.(this.world)
                initialized.push(s)
            }
        } catch (err) {
            for (let i = initialized.length - 1; i >= 0; i--) initialized[i]?.dispose?.()
            throw err
        }

        this.started = true
        this.scheduler.start({
            fixed: (dt) => {
                this.world.metrics.recordFixedStep()
                for (const s of this.fixedSystems) this.updateSystem('fixed', s, dt)
            },
            render: (dt) => {
                this.world.metrics.recordRenderFrame(dt)
                for (const s of this.renderSystems) this.updateSystem('render', s, dt)
                this.world.metrics.timeSystem('render', 'renderer.update', () => this.renderer.update(dt))
                this.world.metrics.timeSystem('render', 'renderer.render', () => this.renderer.render())
            },
        })
    }

    stop(): void {
        if (this.disposed) return
        this.scheduler.stop()
        for (const s of this.fixedSystems) s.dispose?.()
        for (const s of this.renderSystems) s.dispose?.()
        this.input.dispose()
        this.renderer.dispose()
        this.started = false
        this.disposed = true
    }

    private updateSystem(phase: MetricsPhase, system: System, dt: number): void {
        const label = this.systemLabels.get(system) ?? fallbackSystemLabel(system, 0)
        this.world.metrics.timeSystem(phase, label, () => system.update(this.world, dt))
    }
}

function compareSystems(a: System, b: System): number {
    return (a.order ?? 0) - (b.order ?? 0)
}

function fallbackSystemLabel(system: System, index: number): string {
    if (system.update.name && system.update.name !== 'update') return system.update.name
    return `${system.fixed ? 'fixed' : 'render'}:${system.order ?? 0}:${index}`
}

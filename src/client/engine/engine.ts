import { Renderer } from './render/renderer'
import { Scheduler } from './scheduler'
import Signals from './signals'
import { createGameWorld, type GameWorld } from './ecs/world'
import type { System } from './ecs/systems/system'
import { Input } from './input/input'

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
    private started = false
    private disposed = false

    constructor(opts: EngineOptions = {}) {
        this.world = createGameWorld()
        this.renderer = new Renderer()
        this.scheduler = new Scheduler({ fixedHz: opts.fixedHz })
        this.signals = new Signals()
        this.input = new Input(this.renderer.webgpu.domElement)
    }

    addSystem(system: System): this {
        if (this.disposed) {
            throw new Error('Engine.addSystem: cannot register a system after stop()')
        }
        if (this.started) {
            throw new Error('Engine.addSystem: cannot register a system after start()')
        }
        if (system.fixed) this.fixedSystems.push(system)
        else this.renderSystems.push(system)
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
                for (const s of this.fixedSystems) s.update(this.world, dt)
            },
            render: (dt) => {
                for (const s of this.renderSystems) s.update(this.world, dt)
                this.renderer.update(dt)
                this.renderer.render()
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
}

function compareSystems(a: System, b: System): number {
    return (a.order ?? 0) - (b.order ?? 0)
}

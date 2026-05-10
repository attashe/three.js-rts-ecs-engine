import type { GameWorld } from '../world'

// A System is a plain function bag. Setting `fixed: true` schedules it on the
// fixed-timestep loop (default 60 Hz); otherwise it runs once per render frame.
// Subscribe to entity lifecycle (gained / lost a component set) via bitecs
// `observe(world, onAdd(C), cb)` directly inside `init()` if you need it.
export interface System {
    readonly name?: string
    readonly fixed?: boolean
    /** Lower orders run first inside the fixed/render bucket. Default 0. */
    readonly order?: number
    init?(world: GameWorld): void
    update(world: GameWorld, dt: number): void
    dispose?(): void
}

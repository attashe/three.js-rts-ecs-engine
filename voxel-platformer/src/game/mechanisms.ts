import type { GameWorld, PistonMechanism, VoxelCoord } from '../engine/ecs/world'

export interface PistonMechanismConfig {
    from: VoxelCoord
    to: VoxelCoord
    /** Palette index of the moving block. */
    block: number
    /** Seconds between flip attempts. Default 2. */
    interval?: number
    /** How to handle a character occupying the target cell. Default 'block'. */
    characterPolicy?: PistonMechanism['characterPolicy']
    /** Which cell holds the block at level load. Default `'from'`. */
    initial?: 'from' | 'to'
}

/**
 * Register a moving-platform piston. The system in `piston-system.ts` ticks
 * `world.pistons` every fixed step and toggles the block between the two
 * cells once the timer hits zero.
 */
export function registerPistonMechanism(world: GameWorld, config: PistonMechanismConfig): PistonMechanism {
    const interval = config.interval ?? 2
    const piston: PistonMechanism = {
        from: { ...config.from },
        to: { ...config.to },
        block: config.block,
        occupied: config.initial ?? 'from',
        interval,
        timer: interval,
        characterPolicy: config.characterPolicy ?? 'block',
    }
    world.pistons.push(piston)
    return piston
}

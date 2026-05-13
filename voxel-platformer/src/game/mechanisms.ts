import type { ChunkManager } from '../engine/voxel/chunk-manager'
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
 * Register a moving-platform piston AND seed its initial voxel into the
 * world. Pistons mutate `chunks` on flip but they don't auto-populate the
 * initial cell — without this seeding the player has nothing to stand on
 * (elevators) or sees the block "appear out of nowhere" on the first tick.
 *
 * Past the initial cell, `piston-system.ts` owns all voxel writes via
 * `chunks.applyBulk` so the renderer remeshes once per flip.
 */
export function registerPistonMechanism(
    world: GameWorld,
    chunks: ChunkManager,
    config: PistonMechanismConfig,
): PistonMechanism {
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
    const initialCell = piston.occupied === 'from' ? piston.from : piston.to
    chunks.setVoxel(initialCell.x, initialCell.y, initialCell.z, piston.block)
    world.pistons.push(piston)
    return piston
}

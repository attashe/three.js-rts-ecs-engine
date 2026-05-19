import type { VoxelCoord } from '../engine/ecs/world'

export type PistonDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

export interface PistonDirectionDef {
    readonly id: PistonDirection
    readonly label: string
    readonly axis: 'x' | 'y' | 'z'
    /** Unit step along the axis. */
    readonly step: 1 | -1
}

/** World-axis convention: north = -Z, south = +Z, east = +X, west = -X. */
export const PISTON_DIRECTIONS: readonly PistonDirectionDef[] = [
    { id: 'north', label: 'N (-Z)', axis: 'z', step: -1 },
    { id: 'south', label: 'S (+Z)', axis: 'z', step: 1 },
    { id: 'east',  label: 'E (+X)', axis: 'x', step: 1 },
    { id: 'west',  label: 'W (-X)', axis: 'x', step: -1 },
    { id: 'up',    label: 'Up (+Y)', axis: 'y', step: 1 },
    { id: 'down',  label: 'Down (-Y)', axis: 'y', step: -1 },
]

const BY_ID = new Map(PISTON_DIRECTIONS.map((def) => [def.id, def]))

export function pistonDirectionDef(id: PistonDirection): PistonDirectionDef {
    const def = BY_ID.get(id)
    if (!def) throw new Error(`Unknown piston direction: ${id}`)
    return def
}

/**
 * Map (direction, distance) → integer voxel offset. Pure function — easy to
 * unit-test, no engine deps. Distance is the number of cells the piston
 * travels; the offset is direction.step × distance along its axis.
 */
export function pistonOffset(dir: PistonDirection, distance: number): VoxelCoord {
    const def = pistonDirectionDef(dir)
    const d = def.step * Math.max(1, Math.floor(distance))
    return {
        x: def.axis === 'x' ? d : 0,
        y: def.axis === 'y' ? d : 0,
        z: def.axis === 'z' ? d : 0,
    }
}

export function addOffset(cell: VoxelCoord, offset: VoxelCoord): VoxelCoord {
    return { x: cell.x + offset.x, y: cell.y + offset.y, z: cell.z + offset.z }
}

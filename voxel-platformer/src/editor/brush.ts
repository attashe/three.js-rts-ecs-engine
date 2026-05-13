import type { VoxelCoord } from '../engine/ecs/world'

export type BrushKind = 'single' | 'cube3' | 'cube5' | 'disk3' | 'disk5'

export interface BrushDef {
    readonly kind: BrushKind
    readonly label: string
    readonly hint: string
}

export const BRUSHES: readonly BrushDef[] = [
    { kind: 'single', label: 'Single',     hint: '1 voxel at the cursor' },
    { kind: 'cube3',  label: '3×3×3 cube', hint: '3×3×3 cube centred on the cursor' },
    { kind: 'cube5',  label: '5×5×5 cube', hint: '5×5×5 cube centred on the cursor' },
    { kind: 'disk3',  label: 'Flat 3×3',   hint: '3×3 horizontal disk at the cursor Y' },
    { kind: 'disk5',  label: 'Flat 5×5',   hint: '5×5 horizontal disk at the cursor Y' },
]

const BRUSH_BY_KIND = new Map(BRUSHES.map((def) => [def.kind, def]))

export function getBrushDef(kind: BrushKind): BrushDef {
    const def = BRUSH_BY_KIND.get(kind)
    if (!def) throw new Error(`Unknown brush kind: ${kind}`)
    return def
}

/**
 * Build the set of voxel coordinates a brush affects when centred on
 * `center`. Pure function — no engine state, easy to unit-test.
 *
 * Cube brushes are full 3D cubes (3³ = 27, 5³ = 125). Disk brushes are
 * flat XZ rectangles at the cursor's Y, useful for painting whole floor
 * tiles without changing height.
 */
export function brushFootprint(kind: BrushKind, center: VoxelCoord): VoxelCoord[] {
    switch (kind) {
        case 'single': return [{ ...center }]
        case 'cube3':  return cubeFootprint(center, 1)
        case 'cube5':  return cubeFootprint(center, 2)
        case 'disk3':  return diskFootprint(center, 1)
        case 'disk5':  return diskFootprint(center, 2)
    }
}

function cubeFootprint(center: VoxelCoord, radius: number): VoxelCoord[] {
    const out: VoxelCoord[] = []
    for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dx = -radius; dx <= radius; dx++) {
                out.push({ x: center.x + dx, y: center.y + dy, z: center.z + dz })
            }
        }
    }
    return out
}

function diskFootprint(center: VoxelCoord, radius: number): VoxelCoord[] {
    const out: VoxelCoord[] = []
    for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
            out.push({ x: center.x + dx, y: center.y, z: center.z + dz })
        }
    }
    return out
}

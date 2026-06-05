import type { VoxelBuffer } from '../buffer'
import { STRUCTURE_MATERIALS as M } from '../materials'
import { BLOCK } from '../../engine/voxel/palette'
import type { StructurePrefab } from './prefab-types'

/**
 * A village well — a square stone curb around a water shaft, two corner
 * posts, and a little gable canopy. Footprint 5 × 5, 6 tall. Reads as a
 * gathering point and gives a clean vertical landmark.
 */
function build(buf: VoxelBuffer): void {
    // Curb walls (hollow ring) two blocks tall.
    buf.hollowBox(-2, 0, -2, 2, 1, 2, 1, M.stone, 'well-curb')
    // Cap the curb top with a darker trim course.
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            if (Math.max(Math.abs(x), Math.abs(z)) === 2) buf.set(x, 2, z, M.stone2, 'well-curb-cap')
        }
    }
    // Water in the shaft.
    buf.fillBox(-1, 0, -1, 1, 0, 1, BLOCK.water, 'well-water')

    // Two posts on the +x / -x curb, carrying a ridge beam.
    for (const x of [-2, 2]) {
        buf.fillBox(x, 2, 0, x, 4, 0, M.woodDark, 'well-post')
    }
    buf.fillBox(-2, 5, 0, 2, 5, 0, M.woodDark, 'well-ridge')

    // Small gable canopy over the shaft.
    for (let z = -2; z <= 2; z++) {
        const drop = Math.abs(z)
        buf.fillBox(-2, 5 - drop, z, 2, 5 - drop, z, M.roof, 'well-roof')
    }

    // Bucket rope hint hanging from the ridge.
    buf.set(0, 4, 0, M.metal, 'well-pulley')
    buf.set(0, 3, 0, M.woodDark, 'well-bucket')
}

export const WELL: StructurePrefab = {
    id: 'well',
    label: 'Well',
    description: 'Stone curb, water shaft, and a little gabled canopy — a village landmark.',
    build,
}

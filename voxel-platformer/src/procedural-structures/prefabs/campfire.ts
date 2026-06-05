import type { VoxelBuffer } from '../buffer'
import { STRUCTURE_MATERIALS as M } from '../materials'
import { BLOCK } from '../../engine/voxel/palette'
import type { StructurePrefab } from './prefab-types'

/**
 * A small ringed campfire — a circle of stones around crossed logs with
 * a live flame. Tiny footprint (5 × 5, 2 tall) so it slots into camps,
 * clearings, and quest hubs as a warm focal point / save-point marker.
 */
function build(buf: VoxelBuffer): void {
    // Stone ring (radius 2, leaving the centre open for the fire).
    for (let x = -2; x <= 2; x++) {
        for (let z = -2; z <= 2; z++) {
            const d = x * x + z * z
            if (d >= 3 && d <= 5) buf.set(x, 0, z, (x + z) % 2 === 0 ? M.stone : M.darkStone, 'campfire-ring')
        }
    }
    // Crossed logs.
    buf.fillBox(-1, 0, 0, 1, 0, 0, M.woodDark, 'campfire-log')
    buf.fillBox(0, 0, -1, 0, 0, 1, M.wood, 'campfire-log')
    // Flame + a wisp of smoke.
    buf.set(0, 1, 0, BLOCK.fire, 'campfire-flame')
    buf.set(0, 2, 0, BLOCK.smoke, 'campfire-smoke')
}

export const CAMPFIRE: StructurePrefab = {
    id: 'campfire',
    label: 'Campfire',
    description: 'Stone-ringed fire with crossed logs — a cosy camp / rest marker.',
    build,
}

import type { VoxelBuffer } from '../buffer'
import { STRUCTURE_MATERIALS as M } from '../materials'
import type { StructurePrefab } from './prefab-types'

/**
 * A ceremonial banner arch — two timber posts joined by a beam with
 * three hanging banners and metal finials. Footprint 7 × 1, 6 tall.
 * Use it to frame a path, a gate, or the entrance to an arena.
 */
function build(buf: VoxelBuffer): void {
    const halfW = 3
    const beamY = 5

    // Posts with stone footings.
    for (const x of [-halfW, halfW]) {
        buf.set(x, 0, 0, M.stone, 'arch-footing')
        buf.fillBox(x, 1, 0, x, beamY - 1, 0, M.woodDark, 'arch-post')
        buf.set(x, beamY, 0, M.metal, 'arch-finial')
    }

    // Cross beam.
    buf.fillBox(-halfW, beamY, 0, halfW, beamY, 0, M.wood, 'arch-beam')
    buf.fillBox(-halfW - 1, beamY, 0, halfW + 1, beamY, 0, M.woodDark, 'arch-beam-overhang')

    // Three banners hanging from the beam.
    for (const x of [-2, 0, 2]) {
        for (let y = beamY - 1; y >= beamY - 3; y--) buf.set(x, y, 0, M.banner, 'arch-banner')
    }
}

export const BANNER_ARCH: StructurePrefab = {
    id: 'banner-arch',
    label: 'Banner Arch',
    description: 'Timber posts, a beam, and three hanging banners — frames a path or entrance.',
    build,
}

import type { VoxelBuffer } from '../buffer'
import { BLOCK } from '../../engine/voxel/palette'
import type { StructurePrefab } from './prefab-types'

/**
 * Compact pine for dense worldgen scatter. The general procedural tree
 * generator intentionally creates broad roots and crowns; this fixed 5x5
 * silhouette matches the old DSL's small pine footprint for surface MVP tests.
 */
function build(buf: VoxelBuffer): void {
    for (let y = 0; y <= 5; y += 1) buf.set(0, y, 0, BLOCK.bark, 'compact-pine-trunk')

    pineLayer(buf, 3, 2)
    pineLayer(buf, 4, 2)
    pineLayer(buf, 5, 1)
    pineLayer(buf, 6, 1)
    buf.set(0, 7, 0, BLOCK.deepLeaf, 'compact-pine-tip')
}

function pineLayer(buf: VoxelBuffer, y: number, radius: number): void {
    for (let x = -radius; x <= radius; x += 1) {
        for (let z = -radius; z <= radius; z += 1) {
            const d = Math.abs(x) + Math.abs(z)
            if (d > radius + 1) continue
            const edge = d >= radius
            buf.set(x, y, z, edge ? BLOCK.leafDark : BLOCK.deepLeaf, 'compact-pine-crown')
        }
    }
}

export const COMPACT_PINE: StructurePrefab = {
    id: 'compact-pine',
    label: 'Compact Pine',
    description: 'Small fixed pine with a 5x5 footprint for dense deterministic scatter.',
    build,
}

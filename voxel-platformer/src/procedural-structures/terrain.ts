import { BLOCK } from '../engine/voxel/palette'
import type { StructureGenerationOptions, StructureVoxel } from './types'
import { VoxelBuffer, neighbors6 } from './buffer'
import { hash2 } from './math'
import { LEAF_BLOCKS, STRUCTURAL_BLOCKS, STRUCTURE_MATERIALS } from './materials'

export function addTerrain(buf: VoxelBuffer, opts: StructureGenerationOptions): void {
    const half = Math.floor(opts.terrainSize / 2)
    const seed = (opts.seed | 0) % 9999
    for (let x = -half; x <= half; x++) {
        for (let z = -half; z <= half; z++) {
            const noise = hash2(x, z, seed)
            const block = noise < opts.terrainNoise * 0.22
                ? STRUCTURE_MATERIALS.dirt
                : noise > 0.78
                    ? STRUCTURE_MATERIALS.grass2
                    : STRUCTURE_MATERIALS.grass
            buf.set(x, 0, z, block, 'terrain')
        }
    }
}

export function variantSpots(opts: StructureGenerationOptions): Array<{ x: number; z: number; i: number }> {
    const n = opts.variants
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const sx = -((cols - 1) * opts.spacing) / 2
    const sz = -((rows - 1) * opts.spacing) / 2
    const spots: Array<{ x: number; z: number; i: number }> = []
    for (let i = 0; i < n; i++) {
        const c = i % cols
        const r = Math.floor(i / cols)
        spots.push({ x: Math.round(sx + c * opts.spacing), z: Math.round(sz + r * opts.spacing), i })
    }
    return spots
}

export function cleanupLooseVoxels(buf: VoxelBuffer): void {
    const toDelete: StructureVoxel[] = []
    for (const v of buf.values()) {
        if (v.y <= 0) continue
        const neighborCount = neighbors6(v.x, v.y, v.z).filter(([x, y, z]) => buf.has(x, y, z)).length
        const detachedDecoration = v.block === BLOCK.flower
            || v.block === BLOCK.mushroom
            || v.block === BLOCK.fruit
            || v.block === BLOCK.smoke
        const loose = !isStructuralVoxel(v) && neighborCount === 0
        const detached = (LEAF_BLOCKS.has(v.block) || detachedDecoration) && neighborCount < 1
        if (loose || detached) toDelete.push(v)
    }
    for (const v of toDelete) buf.del(v.x, v.y, v.z)
}

function isStructuralVoxel(v: StructureVoxel): boolean {
    return STRUCTURAL_BLOCKS.has(v.block)
        || v.block === BLOCK.fire
        || v.tag.includes('trunk')
        || v.tag.includes('wall')
        || v.tag.includes('roof')
        || v.tag.includes('tower')
        || v.tag.includes('root')
        || v.tag.includes('branch')
}

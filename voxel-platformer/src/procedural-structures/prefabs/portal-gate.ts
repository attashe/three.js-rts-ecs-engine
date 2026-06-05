import type { VoxelBuffer } from '../buffer'
import { STRUCTURE_MATERIALS as M } from '../materials'
import { BLOCK } from '../../engine/voxel/palette'
import type { StructurePrefab } from './prefab-types'

/**
 * A standing stone portal gate. Two rune-carved pillars carry a heavy
 * lintel; the gap between them is filled with a translucent shimmer
 * plane and capped by an emissive keystone, so it reads as an active
 * gateway. Pairs naturally with the editor's `portal` zone kind — drop
 * a portal-trigger zone in the archway to wire travel.
 *
 * Footprint: 7 (x) × 2 (z), 8 tall. Walk-through axis is +Z (the
 * shimmer plane sits on the z = 0 face, the threshold runs into +z).
 */
function build(buf: VoxelBuffer): void {
    const halfW = 3        // pillars at x = ±3
    const top = 6          // lintel row
    const depth = 1        // z spans 0..1

    // Threshold / base plinth tying both feet together.
    buf.fillBox(-halfW, 0, 0, halfW, 0, depth, M.stone, 'portal-base')
    buf.fillBox(-halfW - 1, 0, 0, -halfW - 1, 0, depth, M.darkStone, 'portal-base-step')
    buf.fillBox(halfW + 1, 0, 0, halfW + 1, 0, depth, M.darkStone, 'portal-base-step')

    // Pillars — dark-stone core with a lighter trim front face.
    for (const x of [-halfW, halfW]) {
        buf.fillBox(x, 1, 0, x, top - 1, depth, M.darkStone, 'portal-pillar')
        buf.fillBox(x, 1, 0, x, top - 1, 0, M.stone2, 'portal-pillar-face')
        // Glowing runes climbing the inner face.
        for (let y = 2; y <= top - 2; y += 2) buf.set(x, y, 0, BLOCK.glow, 'portal-rune')
    }

    // Lintel + keystone.
    buf.fillBox(-halfW - 1, top, 0, halfW + 1, top, depth, M.darkStone, 'portal-lintel')
    buf.fillBox(-halfW - 1, top + 1, 0, halfW + 1, top + 1, 0, M.stone2, 'portal-lintel-crown')
    buf.set(0, top + 1, 0, BLOCK.glow, 'portal-keystone')

    // Shimmer field across the opening (front face only — thin gateway).
    for (let x = -halfW + 1; x <= halfW - 1; x++) {
        for (let y = 1; y <= top - 1; y++) buf.set(x, y, 0, BLOCK.glass, 'portal-field')
    }

    // Mossy weathering near the feet so it sits in nature, not a vacuum.
    buf.set(-halfW, 1, depth, M.moss, 'portal-moss')
    buf.set(halfW, 1, depth, M.moss, 'portal-moss')
}

export const PORTAL_GATE: StructurePrefab = {
    id: 'portal-gate',
    label: 'Portal Gate',
    description: 'Rune-carved stone archway with a shimmer field — drop a portal zone in the opening.',
    build,
}

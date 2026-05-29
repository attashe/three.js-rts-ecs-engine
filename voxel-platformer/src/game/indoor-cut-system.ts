import { query } from 'bitecs'
import { BoxCollider, PlayerControlled, Position } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK, occludesFaces } from '../engine/voxel/palette'

/**
 * Foliage occludes faces but isn't a "roof" — without this exclusion,
 * walking under a tree canopy would read as indoors and slice the world.
 */
const FOLIAGE_BLOCKS = new Set<number>([
    BLOCK.leaf,
    BLOCK.leafDark,
    BLOCK.leafLight,
    BLOCK.deepLeaf,
])

/** Whether a block counts as a ceiling for indoor detection: it hides the
 *  view from above (occludes faces) and isn't leafy foliage. */
function isCeilingBlock(chunks: ChunkManager, block: number): boolean {
    return !FOLIAGE_BLOCKS.has(block) && occludesFaces(chunks.palette, block)
}

/**
 * Hides the roof (and any floors above the player) when they step indoors,
 * so the iso camera keeps a clear line to the character instead of staring
 * at a rooftop. Implemented entirely on top of the existing world cut:
 * `ChunkRenderer.setCutY(y)` remeshes treating voxels above `y` as air, so
 * the ceiling slab and everything over it simply stops being built.
 *
 * Detection is a cheap vertical scan up the player's column for the first
 * face-occluding block (the ceiling). When one is found within reach we cut
 * just below it; when the player is back under open sky we clear the cut.
 * Hysteresis on the exit avoids flicker while walking through doorways, and
 * the cut value is only re-applied when it actually changes (so the
 * streaming renderer only re-queues meshes on a real transition).
 */
export interface IndoorCutOptions {
    /** Apply the cut — wire to `chunkRenderer.setCutY`. */
    setCutY: (y: number | null) => void
    /** Blocks scanned upward from the player's head for a ceiling. Default 16. */
    scanHeight?: number
    /** Seconds between checks. Default 0.15 (the cut doesn't need per-frame precision). */
    checkInterval?: number
    /** Consecutive "no ceiling" checks before clearing an active cut. Default 3. */
    exitGraceChecks?: number
    /** Optional master toggle (e.g. a player setting). */
    enabled?: () => boolean
}

const DEFAULT_SCAN_HEIGHT = 16
const DEFAULT_INTERVAL = 0.15
const DEFAULT_EXIT_GRACE = 3

/**
 * First ceiling block (face-occluding, non-foliage) strictly above `fromY`
 * in the column (x, z), scanning up to `scanHeight` blocks, or `null` if the
 * column is open / only foliage. Pure — drives both the system and its tests.
 */
export function findCeilingY(
    chunks: ChunkManager,
    x: number,
    z: number,
    fromY: number,
    scanHeight: number,
): number | null {
    for (let y = fromY + 1; y <= fromY + scanHeight; y++) {
        if (isCeilingBlock(chunks, chunks.getVoxel(x, y, z))) return y
    }
    return null
}

export function createIndoorCutSystem(chunks: ChunkManager, opts: IndoorCutOptions): System {
    const scanHeight = opts.scanHeight ?? DEFAULT_SCAN_HEIGHT
    const interval = opts.checkInterval ?? DEFAULT_INTERVAL
    const exitGrace = opts.exitGraceChecks ?? DEFAULT_EXIT_GRACE

    let accumulator = 0
    let indoors = false
    let noCeilingStreak = 0
    let appliedCutY: number | null = null

    function apply(cutY: number | null): void {
        if (cutY === appliedCutY) return
        appliedCutY = cutY
        opts.setCutY(cutY)
    }

    return {
        // Run just before the chunk renderer so a transition this frame is
        // picked up by the same frame's mesh pass.
        order: RenderOrder.worldRender - 1,
        update(world, dt) {
            if (opts.enabled && !opts.enabled()) {
                indoors = false
                noCeilingStreak = 0
                apply(null)
                return
            }
            accumulator += dt
            if (accumulator < interval) return
            accumulator = 0

            const eids = query(world, [PlayerControlled, Position, BoxCollider])
            if (eids.length === 0) return
            const eid = eids[0]!
            const x = Math.floor(Position.x[eid]!)
            const z = Math.floor(Position.z[eid]!)
            // Position is the player's feet; head ≈ feet + full capsule height.
            const headY = Math.floor(Position.y[eid]! + BoxCollider.y[eid]! * 2)

            const ceilingY = findCeilingY(chunks, x, z, headY, scanHeight)
            if (ceilingY !== null) {
                indoors = true
                noCeilingStreak = 0
                // Cut just below the ceiling so the slab + everything above it
                // (upper floors, roof) is removed, leaving the room readable.
                apply(ceilingY - 1)
            } else if (indoors) {
                noCeilingStreak += 1
                if (noCeilingStreak >= exitGrace) {
                    indoors = false
                    apply(null)
                }
            }
        },
    }
}

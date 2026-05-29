import { Vector3 } from 'three'
import { query } from 'bitecs'
import { BoxCollider, PlayerControlled, Position } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK, occludesFaces, type Palette } from '../engine/voxel/palette'
import { voxelRaycast } from '../engine/voxel/voxel-raycast'

/**
 * Reveals the player when world geometry would hide them from the camera —
 * the roof and floors of a building, an overhang, etc. Implemented on top of
 * the existing world cut: `ChunkRenderer.setCutY(y)` remeshes treating voxels
 * above `y` as air, so whatever is between the camera and the character stops
 * being drawn while they're under cover.
 *
 * Detection tracks *visibility*, not a fixed ceiling: it casts a ray from the
 * character toward the camera viewpoint and checks whether a face-occluding
 * block blocks the line of sight within a short distance. This is robust where
 * a straight-up probe fails — e.g. a tower with an open shaft directly above
 * the player but a wall/roof between them and the camera. Because the cut only
 * changes *meshing* (not the voxel data the ray reads), revealing the
 * character never changes what the ray sees, so there's no cut/uncut
 * oscillation.
 *
 * Foliage is excluded so walking under a tree canopy doesn't slice the world.
 * Grace counters on enter/exit smooth transient occlusions (passing behind a
 * thin post) without flicker.
 */
const FOLIAGE_BLOCKS = new Set<number>([
    BLOCK.leaf,
    BLOCK.leafDark,
    BLOCK.leafLight,
    BLOCK.deepLeaf,
])

/** A block that blocks the camera's view of the character: opaque (occludes
 *  faces) and not leafy foliage. */
function isViewOccluder(palette: Palette, block: number): boolean {
    return !FOLIAGE_BLOCKS.has(block) && occludesFaces(palette, block)
}

/**
 * Whether a view-occluding block lies between `target` (a point on the
 * character) and `viewpoint` (the camera), within `maxDistance` world units of
 * the character. Pure over the voxel data — drives the system and its tests.
 */
export function isViewpointBlocked(
    chunks: ChunkManager,
    target: { x: number; y: number; z: number },
    viewpoint: { x: number; y: number; z: number },
    maxDistance: number,
): boolean {
    const dx = viewpoint.x - target.x
    const dy = viewpoint.y - target.y
    const dz = viewpoint.z - target.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-3) return false
    const dir = new Vector3(dx / len, dy / len, dz / len)
    const origin = new Vector3(target.x, target.y, target.z)
    const reach = Math.min(maxDistance, len)
    return voxelRaycast(chunks, origin, dir, reach, isViewOccluder) !== null
}

export interface IndoorCutOptions {
    /** Apply the cut — wire to `chunkRenderer.setCutY`. */
    setCutY: (y: number | null) => void
    /** Camera world position the character's visibility is tested against. */
    viewpoint: () => { x: number; y: number; z: number }
    /** Blocks of headroom kept above the player's feet when revealing. Default 3. */
    revealHeadroom?: number
    /** Only occluders within this distance of the character count (keeps far
     *  hills from triggering a cut). Default 28. */
    maxOccluderDistance?: number
    /** Seconds between checks. Default 0.12. */
    checkInterval?: number
    /** Consecutive "occluded" checks before cutting (smooths walking past posts). Default 2. */
    enterGraceChecks?: number
    /** Consecutive "visible" checks before clearing the cut. Default 4. */
    exitGraceChecks?: number
    /** Optional master toggle (e.g. a player setting). */
    enabled?: () => boolean
}

const DEFAULT_HEADROOM = 3
const DEFAULT_MAX_OCCLUDER = 28
const DEFAULT_INTERVAL = 0.12
const DEFAULT_ENTER_GRACE = 2
const DEFAULT_EXIT_GRACE = 4

export function createIndoorCutSystem(chunks: ChunkManager, opts: IndoorCutOptions): System {
    const headroom = opts.revealHeadroom ?? DEFAULT_HEADROOM
    const maxOccluder = opts.maxOccluderDistance ?? DEFAULT_MAX_OCCLUDER
    const interval = opts.checkInterval ?? DEFAULT_INTERVAL
    const enterGrace = opts.enterGraceChecks ?? DEFAULT_ENTER_GRACE
    const exitGrace = opts.exitGraceChecks ?? DEFAULT_EXIT_GRACE

    let accumulator = 0
    let occludedStreak = 0
    let visibleStreak = 0
    let cutActive = false
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
                occludedStreak = 0
                visibleStreak = 0
                cutActive = false
                apply(null)
                return
            }
            accumulator += dt
            if (accumulator < interval) return
            accumulator = 0

            const eids = query(world, [PlayerControlled, Position, BoxCollider])
            if (eids.length === 0) return
            const eid = eids[0]!
            const footY = Position.y[eid]!
            const height = BoxCollider.y[eid]! * 2
            // Test a point near the top of the character — if the head is
            // hidden the character reads as obscured.
            const head = { x: Position.x[eid]!, y: footY + height, z: Position.z[eid]! }

            const occluded = isViewpointBlocked(chunks, head, opts.viewpoint(), maxOccluder)
            if (occluded) {
                occludedStreak += 1
                visibleStreak = 0
                if (!cutActive && occludedStreak >= enterGrace) cutActive = true
                if (cutActive) apply(Math.floor(footY) + headroom)
            } else {
                visibleStreak += 1
                occludedStreak = 0
                if (cutActive && visibleStreak >= exitGrace) {
                    cutActive = false
                    apply(null)
                }
            }
        },
    }
}

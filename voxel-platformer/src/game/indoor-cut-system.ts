import { Vector3 } from 'three'
import { query } from 'bitecs'
import { BoxCollider, PlayerControlled, Position } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK, occludesFaces, type Palette } from '../engine/voxel/palette'
import { voxelRaycast, type VoxelHit } from '../engine/voxel/voxel-raycast'

/**
 * Reveals the player when world geometry would hide them from the camera —
 * the roof and floors of a building, an overhang, etc. Implemented as a
 * *localised* cutaway corridor: `ChunkRenderer.setLocalCut` hides voxels above
 * the player's feet within a radius of the segment from the player toward the
 * camera (XZ), sized to reach just past the occluding wall. So even in a large
 * room — where the wall can be far from the player — the corridor reaches it,
 * while only a narrow slot toward the camera is carved and the rest of the
 * world is left intact. It's shader-only (no remesh), so it follows the player
 * and camera every frame.
 *
 * Detection tracks *visibility*, not a fixed ceiling: it casts a ray from the
 * character toward the camera viewpoint and checks whether a face-occluding
 * block blocks the line of sight within a short distance. This is robust where
 * a straight-up probe fails — e.g. a tower with an open shaft directly above
 * the player but a wall/roof between them and the camera. The ray reads voxel
 * data, which the visual cut never changes, so revealing the character can't
 * oscillate the cut.
 *
 * Foliage is excluded so walking under a tree canopy doesn't trigger a cut.
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
 * The first view-occluding block between `target` (a point on the character)
 * and `viewpoint` (the camera), within `maxDistance` world units of the
 * character, or `null` if the line of sight is clear. The hit's `t` is the
 * distance to the occluder — used to size the cutaway so it reaches a wall
 * however far it sits from the player in a large room. Pure over the voxel
 * data — drives the system and its tests.
 */
export function castViewObstruction(
    chunks: ChunkManager,
    target: { x: number; y: number; z: number },
    viewpoint: { x: number; y: number; z: number },
    maxDistance: number,
): VoxelHit | null {
    const dx = viewpoint.x - target.x
    const dy = viewpoint.y - target.y
    const dz = viewpoint.z - target.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-3) return null
    const dir = new Vector3(dx / len, dy / len, dz / len)
    const origin = new Vector3(target.x, target.y, target.z)
    const reach = Math.min(maxDistance, len)
    return voxelRaycast(chunks, origin, dir, reach, isViewOccluder)
}

export interface LocalCut {
    /** Capsule start (player) in world XZ. */
    a: { x: number; z: number }
    /** Capsule end (toward the camera, past the occluder) in world XZ. */
    b: { x: number; z: number }
    radius: number
    y: number
}

export interface IndoorCutOptions {
    /** Apply the localised cutaway — wire to `chunkRenderer.setLocalCut`. */
    setLocalCut: (cut: LocalCut | null) => void
    /** Camera world position the character's visibility is tested against. */
    viewpoint: () => { x: number; y: number; z: number }
    /** Half-width of the cutaway corridor. Default 4. */
    revealRadius?: number
    /** Blocks of headroom kept above the player's feet inside the cut.
     *  Default 1 (a shin-level lip stays; head and above are cleared). */
    revealHeadroom?: number
    /** Extra length added past the detected occluder so the wall fully clears.
     *  Default 3. */
    occluderMargin?: number
    /** Only occluders within this distance of the character count, and the
     *  cut corridor never extends further. Default 28. */
    maxOccluderDistance?: number
    /** Seconds between visibility checks. Default 0.12. */
    checkInterval?: number
    /** Consecutive "occluded" checks before cutting (smooths walking past posts). Default 2. */
    enterGraceChecks?: number
    /** Consecutive "visible" checks before clearing the cut. Default 4. */
    exitGraceChecks?: number
    /** Optional master toggle (e.g. a player setting). */
    enabled?: () => boolean
}

const DEFAULT_RADIUS = 4
const DEFAULT_HEADROOM = 1
const DEFAULT_MARGIN = 3
const DEFAULT_MAX_OCCLUDER = 28
const DEFAULT_INTERVAL = 0.12
const DEFAULT_ENTER_GRACE = 2
const DEFAULT_EXIT_GRACE = 4

export function createIndoorCutSystem(chunks: ChunkManager, opts: IndoorCutOptions): System {
    const radius = opts.revealRadius ?? DEFAULT_RADIUS
    const headroom = opts.revealHeadroom ?? DEFAULT_HEADROOM
    const margin = opts.occluderMargin ?? DEFAULT_MARGIN
    const maxOccluder = opts.maxOccluderDistance ?? DEFAULT_MAX_OCCLUDER
    const interval = opts.checkInterval ?? DEFAULT_INTERVAL
    const enterGrace = opts.enterGraceChecks ?? DEFAULT_ENTER_GRACE
    const exitGrace = opts.exitGraceChecks ?? DEFAULT_EXIT_GRACE

    let accumulator = 0
    let occludedStreak = 0
    let visibleStreak = 0
    let active = false
    let applied = false
    // Corridor length toward the camera, sized to reach the last occluder.
    let corridorLen = radius

    return {
        order: RenderOrder.worldRender - 1,
        update(world, dt) {
            if (opts.enabled && !opts.enabled()) {
                active = false
                occludedStreak = 0
                visibleStreak = 0
                if (applied) { applied = false; opts.setLocalCut(null) }
                return
            }

            const eids = query(world, [PlayerControlled, Position, BoxCollider])
            if (eids.length === 0) return
            const eid = eids[0]!
            const px = Position.x[eid]!
            const pz = Position.z[eid]!
            const footY = Position.y[eid]!
            const height = BoxCollider.y[eid]! * 2

            // Decide indoors/outdoors on a throttle (the raycast is the cost);
            // the corridor follows the player + camera every frame for smoothness.
            accumulator += dt
            if (accumulator >= interval) {
                accumulator = 0
                const head = { x: px, y: footY + height, z: pz }
                const hit = castViewObstruction(chunks, head, opts.viewpoint(), maxOccluder)
                if (hit) {
                    occludedStreak += 1
                    visibleStreak = 0
                    if (!active && occludedStreak >= enterGrace) active = true
                    // Reach just past the occluding wall, clamped to the cap.
                    corridorLen = Math.min(maxOccluder, Math.max(radius, hit.t + margin))
                } else {
                    visibleStreak += 1
                    occludedStreak = 0
                    if (active && visibleStreak >= exitGrace) active = false
                }
            }

            if (active) {
                const vp = opts.viewpoint()
                let dx = vp.x - px
                let dz = vp.z - pz
                const horiz = Math.hypot(dx, dz)
                if (horiz > 1e-3) { dx /= horiz; dz /= horiz } else { dx = 0; dz = 0 }
                opts.setLocalCut({
                    a: { x: px, z: pz },
                    b: { x: px + dx * corridorLen, z: pz + dz * corridorLen },
                    radius,
                    y: Math.floor(footY) + headroom,
                })
                applied = true
            } else if (applied) {
                applied = false
                opts.setLocalCut(null)
            }
        },
    }
}

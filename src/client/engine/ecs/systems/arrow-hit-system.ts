import { hasComponent, query, removeEntity } from 'bitecs'
import { Vector3 } from 'three'
import type { ChunkManager } from '../../voxel'
import { voxelRaycast } from '../../voxel'
import {
    BoxCollider,
    Health,
    MovingObject,
    PlayerControlled,
    Position,
    Velocity,
} from '../components'
import { MovingObjectKind } from '../../../game/moving-objects'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'
import type { GameWorld } from '../world'
import { applyDamagePacket } from '../damage'

export interface ArrowHitOptions {
    /** UI hint callback (also pushed to the in-world combat log). */
    notify?: (message: string) => void
    /** Base damage per hit, before speed scaling. */
    baseDamage?: number
    /** Max additional damage at the speed-scaling cap. */
    speedBonus?: number
    /** Speed (m/s) at which speedBonus is fully applied; smaller speeds scale linearly. */
    referenceSpeed?: number
    /** Padding added to each target AABB to make hits feel responsive. */
    targetPadding?: number
}

/**
 * Per-step arrow-vs-character hit detection. For each in-flight arrow we
 * project its velocity over `dt` into a line segment and test it against
 * every Health-bearing entity's AABB (slab method). The first hit that's
 * closer than the nearest voxel along the same ray wins; the arrow is
 * stuck onto the target's Object3D (preserving world transform), damage
 * is applied, and the arrow ECS entity is removed — its visual lives on
 * as a child of the host's mesh and tags along with the host's motion.
 *
 * Runs *before* physics so we can intercept the arrow before it tunnels
 * past a target whose AABB isn't a physics obstacle. Player and other
 * MovingObject entities are excluded from the target set.
 */
export function createArrowHitSystem(
    chunks: ChunkManager,
    opts: ArrowHitOptions = {},
): System {
    const baseDamage = opts.baseDamage ?? 18
    const speedBonus = opts.speedBonus ?? 6
    const referenceSpeed = opts.referenceSpeed ?? 12
    const targetPadding = opts.targetPadding ?? 0.05

    const tmpOrigin = new Vector3()
    const tmpDir = new Vector3()

    return {
        fixed: true,
        order: FixedOrder.movement + 50,
        update(world, dt) {
            const arrows = query(world, [MovingObject, Position, Velocity])
            if (arrows.length === 0) return

            const targets = query(world, [Position, BoxCollider, Health])
            if (targets.length === 0) return

            for (let i = 0; i < arrows.length; i++) {
                const arrow = arrows[i]
                if (MovingObject.kind[arrow] !== MovingObjectKind.Arrow) continue

                const sx = Position.x[arrow]
                const sy = Position.y[arrow]
                const sz = Position.z[arrow]
                const vx = Velocity.x[arrow]
                const vy = Velocity.y[arrow]
                const vz = Velocity.z[arrow]
                const speedSq = vx * vx + vy * vy + vz * vz
                // Don't try to hit anything with a near-stationary arrow — it
                // would just snap onto whatever NPC is closest as the arrow
                // settles, which feels wrong.
                if (speedSq < 4) continue
                const dx = vx * dt
                const dy = vy * dt
                const dz = vz * dt

                let bestT = Infinity
                let bestTarget = -1
                for (let j = 0; j < targets.length; j++) {
                    const t = targets[j]
                    if (t === arrow) continue
                    if (Health.current[t] <= 0) continue
                    if (hasComponent(world, t, PlayerControlled)) continue
                    if (hasComponent(world, t, MovingObject)) continue

                    const halfX = BoxCollider.x[t] + targetPadding
                    const halfY = BoxCollider.y[t] + targetPadding
                    const halfZ = BoxCollider.z[t] + targetPadding
                    const minX = Position.x[t] - halfX
                    const maxX = Position.x[t] + halfX
                    // Foot-anchored: AABB Y span [pos.y, pos.y + 2*half.y].
                    const minY = Position.y[t] - targetPadding
                    const maxY = Position.y[t] + halfY * 2
                    const minZ = Position.z[t] - halfZ
                    const maxZ = Position.z[t] + halfZ

                    const tHit = segmentVsAABB(sx, sy, sz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ)
                    if (tHit !== null && tHit < bestT) {
                        bestT = tHit
                        bestTarget = t
                    }
                }

                if (bestTarget < 0) continue

                // Reject the hit if a wall would intercept the arrow first.
                const segLen = Math.sqrt(dx * dx + dy * dy + dz * dz)
                if (segLen > 0) {
                    tmpOrigin.set(sx, sy, sz)
                    tmpDir.set(dx / segLen, dy / segLen, dz / segLen)
                    const wallHit = voxelRaycast(chunks, tmpOrigin, tmpDir, segLen)
                    if (wallHit !== null && wallHit.t < bestT * segLen) {
                        continue
                    }
                }

                const speed = Math.sqrt(speedSq)
                const speedFactor = Math.min(1, speed / referenceSpeed)
                const damage = baseDamage + speedBonus * speedFactor
                applyArrowHit(world, arrow, bestTarget, damage, opts.notify)
            }
        },
    }
}

function applyArrowHit(
    world: GameWorld,
    arrow: number,
    target: number,
    damage: number,
    notify: ((message: string) => void) | undefined,
): void {
    const result = applyDamagePacket(world, {
        target,
        amount: damage,
        type: 'physical',
    })
    if (!result.applied) return

    let message: string
    if (result.killed) {
        message = `Arrow finishes ${result.targetLabel}.`
    } else {
        message = `Arrow strikes ${result.targetLabel} for ${damage.toFixed(1)}.`
    }
    pushGameLog(world, { type: 'combat', message, eid: target })
    notify?.(message)

    // Stick: reparent the arrow Object3D under the target's, preserving its
    // current world transform so it visually freezes at the strike point and
    // then follows the target's motion / rotation.
    const arrowObj = world.object3DByEid.get(arrow)
    const targetObj = world.object3DByEid.get(target)
    if (arrowObj && targetObj) {
        arrowObj.name = 'EmbeddedArrow'
        targetObj.attach(arrowObj)
    }

    // Drop the ECS entity. The Object3D is now retained by the target's
    // scene-graph subtree, not by world.object3DByEid, so don't dispose it.
    world.object3DByEid.delete(arrow)
    removeEntity(world, arrow)
}

/** Slab-method segment-vs-AABB intersection. Returns parametric t in [0, 1]
 *  where the segment first enters the box, or null if the segment misses. */
function segmentVsAABB(
    sx: number,
    sy: number,
    sz: number,
    dx: number,
    dy: number,
    dz: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
): number | null {
    let tmin = 0
    let tmax = 1

    if (Math.abs(dx) < 1e-9) {
        if (sx < minX || sx > maxX) return null
    } else {
        let t1 = (minX - sx) / dx
        let t2 = (maxX - sx) / dx
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        if (t1 > tmin) tmin = t1
        if (t2 < tmax) tmax = t2
        if (tmin > tmax) return null
    }
    if (Math.abs(dy) < 1e-9) {
        if (sy < minY || sy > maxY) return null
    } else {
        let t1 = (minY - sy) / dy
        let t2 = (maxY - sy) / dy
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        if (t1 > tmin) tmin = t1
        if (t2 < tmax) tmax = t2
        if (tmin > tmax) return null
    }
    if (Math.abs(dz) < 1e-9) {
        if (sz < minZ || sz > maxZ) return null
    } else {
        let t1 = (minZ - sz) / dz
        let t2 = (maxZ - sz) / dz
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
        if (t1 > tmin) tmin = t1
        if (t2 < tmax) tmax = t2
        if (tmin > tmax) return null
    }

    return tmin
}

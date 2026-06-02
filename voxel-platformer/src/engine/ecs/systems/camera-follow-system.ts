import { Vector3 } from 'three'
import { query } from 'bitecs'
import { CameraTarget, Position } from '../components'
import type { IsometricCamera } from '../../render/isometric-camera'
import type { System } from './system'
import { RenderOrder } from './orders'

export interface CameraFollowOptions {
    /** Higher = snappier (less lag). 0 = no follow. Default 6. */
    smoothing?: number
}

/**
 * Smoothly tracks the first entity tagged `CameraTarget` and `Position`. The
 * camera's `target` is lerped toward the entity each render frame; the
 * camera position follows via `IsometricCamera.syncPosition()`.
 *
 * If multiple entities have `CameraTarget`, only the first in the query
 * result is followed — typical use is to tag exactly one entity (the player).
 */
export function createCameraFollowSystem(
    iso: IsometricCamera,
    opts: CameraFollowOptions = {},
): System {
    const smoothing = opts.smoothing ?? 6
    const desired = new Vector3()

    return {
        order: RenderOrder.cameraFollow,
        update(world, dt) {
            if (smoothing <= 0) return
            // A cinematic owns the camera while active — don't fight its tweens.
            if (world.cinematicActive) return
            const eids = query(world, [CameraTarget, Position])
            if (eids.length === 0) return
            const eid = eids[0]
            desired.set(Position.x[eid], Position.y[eid], Position.z[eid])

            // Exponential approach. alpha ∈ [0, 1] computed from dt so it's
            // frame-rate independent: alpha = 1 - exp(-smoothing * dt).
            const alpha = 1 - Math.exp(-smoothing * dt)
            iso.target.lerp(desired, alpha)
            iso.syncPosition()
        },
    }
}

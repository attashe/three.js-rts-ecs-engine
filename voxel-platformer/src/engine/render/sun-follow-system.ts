import { Vector3, type DirectionalLight } from 'three'
import type { System } from '../ecs/systems/system'
import { RenderOrder } from '../ecs/systems/orders'

/**
 * Keeps a `DirectionalLight`'s shadow frustum centred on a moving focal
 * point (typically the iso camera's lookAt target / player).
 *
 * Without this, a level-wide directional sun authored with a fixed
 * world-space target (e.g. the centre of the demo level) drops shadows
 * only inside its ±N orthographic frustum — pan or rotate the camera
 * away and shadows vanish. The fix is to preserve the sun → target
 * offset captured at install time and re-aim both `sun.position` and
 * `sun.target.position` at the focal point each frame.
 *
 * `focusProvider` returns the world-space focus point. The system
 * captures `sun.position - sun.target.position` once at construction so
 * the original sun *direction* (azimuth + elevation) is preserved.
 */
export function createSunFollowSystem(
    sun: DirectionalLight,
    focusProvider: () => { x: number; y: number; z: number },
): System {
    const offset = new Vector3().copy(sun.position).sub(sun.target.position)
    const tmp = new Vector3()

    function applyFocus(): void {
        const focus = focusProvider()
        tmp.set(focus.x, focus.y, focus.z)
        sun.target.position.copy(tmp)
        sun.position.copy(tmp).add(offset)
        sun.target.updateMatrixWorld()
        sun.updateMatrixWorld()
    }

    return {
        name: 'sunFollow',
        // Runs after cameraFollow so the focal point reflects the
        // final post-follow iso target — otherwise the shadow camera
        // would lag the player by one frame.
        order: RenderOrder.cameraFollow + 1,
        init: applyFocus,
        update: applyFocus,
    }
}

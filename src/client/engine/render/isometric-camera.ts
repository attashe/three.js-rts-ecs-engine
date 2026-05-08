import { OrthographicCamera, Vector3 } from 'three'

export interface IsometricCameraOptions {
    /** Half-height of the visible area in world units (at zoom = 1). Default 12. */
    viewSize?: number
    /** Yaw around Y axis, radians. Default π/4 (45°). */
    yaw?: number
    /** Pitch downward, radians. Default π/6 (30°, "game-iso"). True iso is atan(1/√2). */
    pitch?: number
    /** Distance from target along the camera direction. Ortho ignores this for projection,
     *  but it controls shadow frustum and z-buffer range. Default 60. */
    distance?: number
    /** Initial camera target (look-at). Default origin. */
    target?: Vector3
}

/**
 * Fixed-angle isometric camera rig built on OrthographicCamera. Phase 2 ships
 * with manual pan/zoom; Phase 5 adds entity-follow.
 *
 * Pan: move `target` and `syncPosition()` keeps the camera at a fixed offset.
 * Zoom: write `camera.zoom` and call `applyZoom()`.
 */
export class IsometricCamera {
    readonly camera: OrthographicCamera
    readonly target: Vector3

    private readonly viewSize: number
    private readonly pitch: number
    private readonly distance: number
    private readonly offset: Vector3
    private yaw: number

    constructor(opts: IsometricCameraOptions = {}) {
        this.viewSize = opts.viewSize ?? 12
        this.yaw = opts.yaw ?? Math.PI / 4
        this.pitch = opts.pitch ?? Math.PI / 6
        this.distance = opts.distance ?? 60
        this.target = opts.target?.clone() ?? new Vector3(0, 0, 0)

        const cosP = Math.cos(this.pitch)
        this.offset = new Vector3(
            Math.cos(this.yaw) * cosP,
            Math.sin(this.pitch),
            Math.sin(this.yaw) * cosP,
        ).multiplyScalar(this.distance)

        const aspect = window.innerWidth / window.innerHeight
        this.camera = new OrthographicCamera(
            -this.viewSize * aspect,
            this.viewSize * aspect,
            this.viewSize,
            -this.viewSize,
            0.1,
            this.distance * 4,
        )
        this.camera.up.set(0, 1, 0)
        this.syncPosition()
    }

    /** World-space basis vectors for "right" and "forward" in screen pan space.
     *
     *  These match three's camera basis after `lookAt(target)`:
     *    localZ = +offset normalized (camera's local +Z points away from target)
     *    localX = worldUp × localZ = (sin(yaw), 0, -cos(yaw))      (screen-right in world)
     *  `getPanForward` returns the XZ projection of localZ — i.e. "from target
     *  back toward camera"; negate it for the camera's view direction. */
    getPanRight(out: Vector3): Vector3 {
        return out.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize()
    }
    getPanForward(out: Vector3): Vector3 {
        return out.set(Math.cos(this.yaw), 0, Math.sin(this.yaw)).normalize()
    }

    rotateYaw(radians: number): void {
        this.yaw = normalizeRadians(this.yaw + radians)
        this.recomputeOffset()
        this.syncPosition()
    }

    /** Re-place the camera so it sits at the fixed offset from the current target. */
    syncPosition(): void {
        this.camera.position.copy(this.target).add(this.offset)
        this.camera.lookAt(this.target)
    }

    /** Recompute frustum on viewport resize. Preserves zoom. */
    onResize(): void {
        const aspect = window.innerWidth / window.innerHeight
        this.camera.left = -this.viewSize * aspect
        this.camera.right = this.viewSize * aspect
        this.camera.top = this.viewSize
        this.camera.bottom = -this.viewSize
        this.camera.updateProjectionMatrix()
    }

    /** Apply zoom limits and rebuild projection matrix. */
    applyZoom(min = 0.25, max = 5): void {
        this.camera.zoom = Math.max(min, Math.min(max, this.camera.zoom))
        this.camera.updateProjectionMatrix()
    }

    private recomputeOffset(): void {
        const cosP = Math.cos(this.pitch)
        this.offset.set(
            Math.cos(this.yaw) * cosP,
            Math.sin(this.pitch),
            Math.sin(this.yaw) * cosP,
        ).multiplyScalar(this.distance)
    }
}

function normalizeRadians(value: number): number {
    const tau = Math.PI * 2
    return ((value % tau) + tau) % tau
}

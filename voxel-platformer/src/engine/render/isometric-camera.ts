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

export type ViewMode = 'iso' | 'top-down'

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
    private readonly isoPitch: number
    private readonly distance: number
    private readonly offset: Vector3
    private yaw: number
    private pitch: number
    private mode: ViewMode = 'iso'
    /** When set (and `mode === 'top-down'`), the near plane is tightened so
     *  any voxel above `cutPlaneY` is clipped. Use to peek at a specific
     *  layer without geometry above it in the way. */
    private cutPlaneY: number | null = null
    private readonly defaultNear: number

    constructor(opts: IsometricCameraOptions = {}) {
        this.viewSize = opts.viewSize ?? 12
        this.yaw = opts.yaw ?? Math.PI / 4
        this.isoPitch = opts.pitch ?? Math.PI / 6
        this.pitch = this.isoPitch
        this.distance = opts.distance ?? 60
        this.target = opts.target?.clone() ?? new Vector3(0, 0, 0)
        this.defaultNear = 0.1

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
            this.defaultNear,
            this.distance * 4,
        )
        this.camera.up.set(0, 1, 0)
        this.syncPosition()
    }

    getViewMode(): ViewMode { return this.mode }

    /** Switch between fixed-iso and straight-down ortho views. The top-down
     *  view sets `camera.up` from the current yaw so screen-up matches the
     *  iso view's pan-forward direction — keyboard pan keeps the same feel. */
    setViewMode(mode: ViewMode): void {
        if (this.mode === mode) return
        this.mode = mode
        this.pitch = mode === 'top-down' ? Math.PI / 2 : this.isoPitch
        this.recomputeOffset()
        this.syncPosition()
    }

    /** Show only voxels at or below world Y = `y` (top-down only). Pass
     *  `null` to disable the cut. */
    setCutPlaneY(y: number | null): void {
        this.cutPlaneY = y
        this.applyCutPlane()
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
        if (this.mode === 'top-down') {
            // Set up to -pan-forward so screen-right aligns with
            // getPanRight (D moves view right, S moves view down, etc).
            this.camera.up.set(-Math.cos(this.yaw), 0, -Math.sin(this.yaw))
        } else {
            this.camera.up.set(0, 1, 0)
        }
        this.camera.position.copy(this.target).add(this.offset)
        this.camera.lookAt(this.target)
        this.applyCutPlane()
    }

    private applyCutPlane(): void {
        if (this.mode === 'top-down' && this.cutPlaneY !== null) {
            // Camera looks straight down; distance from camera to a point
            // at world Y = y is (cameraY - y). We want anything above
            // cutPlaneY+1 (top of the cut cell) clipped → near plane sits
            // at exactly that distance. Voxel back-face culling handles
            // the otherwise-coincident upper-cell bottom faces.
            const targetDistance = this.camera.position.y - (this.cutPlaneY + 1)
            this.camera.near = Math.max(this.defaultNear, targetDistance)
        } else {
            this.camera.near = this.defaultNear
        }
        this.camera.updateProjectionMatrix()
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

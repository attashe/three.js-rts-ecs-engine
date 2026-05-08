import { Vector3 } from 'three'
import type { IsometricCamera } from '../../render/isometric-camera'
import type { Input } from '../../input/input'
import type { System } from './system'
import { RenderOrder } from './orders'

export interface CameraControlOptions {
    /** Enable WASD/arrow-key pan. Default true. */
    keyboardPan?: boolean
    /** Enable edge-pan when the cursor is near a viewport edge. Default true. */
    edgePan?: boolean
    /** Enable wheel zoom. Default true. */
    wheelZoom?: boolean
    /** Enable 90-degree camera rotation on Q/R. Default true. */
    stepRotate?: boolean
    /** World-units / second of pan at full input. Default 18. */
    panSpeed?: number
    /** Edge-pan trigger distance in CSS pixels from each viewport edge. Default 24. */
    edgePanThreshold?: number
    /** Multiplier per wheel notch. Default 1.1. */
    zoomFactor?: number
    /** Zoom clamp. Default [0.25, 5]. */
    zoomMin?: number
    zoomMax?: number
}

// Render-step system. Reads Input each frame and pans the IsometricCamera's
// target on the XZ plane (camera position follows automatically). Wheel zoom
// updates camera.zoom with clamping. WASD + arrow keys + edge-pan are all
// summed; pointer must have moved at least once for edge-pan to engage.
export function createCameraControlSystem(
    iso: IsometricCamera,
    input: Input,
    opts: CameraControlOptions = {},
): System {
    const keyboardPan = opts.keyboardPan ?? true
    const edgePanEnabled = opts.edgePan ?? true
    const wheelZoom = opts.wheelZoom ?? true
    const stepRotate = opts.stepRotate ?? true
    const panSpeed = opts.panSpeed ?? 18
    const edgeThreshold = opts.edgePanThreshold ?? 24
    const zoomFactor = opts.zoomFactor ?? 1.1
    const zoomMin = opts.zoomMin ?? 0.25
    const zoomMax = opts.zoomMax ?? 5

    const right = new Vector3()
    const forward = new Vector3()
    const delta = new Vector3()

    return {
        order: RenderOrder.cameraControl,
        update(_world, dt) {
            if (stepRotate) {
                if (input.consumeKeyPressed('KeyQ')) iso.rotateYaw(-Math.PI * 0.5)
                if (input.consumeKeyPressed('KeyR')) iso.rotateYaw(Math.PI * 0.5)
            }

            // Keyboard pan (WASD + arrows). +x = right, +z = back/forward in pan-space.
            let panX = 0
            let panZ = 0
            if (keyboardPan) {
                if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) panZ -= 1
                if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) panZ += 1
                if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) panX -= 1
                if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) panX += 1
            }

            if (edgePanEnabled && edgeThreshold > 0) {
                const ptr = input.getPointer()
                if (ptr) {
                    if (ptr.x < edgeThreshold) panX -= 1
                    else if (ptr.x > window.innerWidth - edgeThreshold) panX += 1
                    if (ptr.y < edgeThreshold) panZ -= 1
                    else if (ptr.y > window.innerHeight - edgeThreshold) panZ += 1
                }
            }

            if (panX !== 0 || panZ !== 0) {
                iso.getPanRight(right)
                iso.getPanForward(forward)
                delta
                    .copy(right)
                    .multiplyScalar(panX)
                    .addScaledVector(forward, panZ)
                // Normalise so diagonal pan isn't √2× faster than orthogonal.
                if (delta.lengthSq() > 1) delta.normalize()
                iso.target.addScaledVector(delta, panSpeed * dt)
                iso.syncPosition()
            }

            if (wheelZoom) {
                const wheel = input.consumeWheel()
                if (wheel !== 0) {
                    // Up = zoom in, down = zoom out. e.deltaY > 0 on scroll-down in standard browsers.
                    const factor = wheel < 0 ? zoomFactor : 1 / zoomFactor
                    iso.camera.zoom *= factor
                    iso.applyZoom(zoomMin, zoomMax)
                }
            }
        },
    }
}

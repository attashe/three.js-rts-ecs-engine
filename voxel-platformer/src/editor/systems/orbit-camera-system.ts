import { MOUSE } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Input } from '../../engine/input/input'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import type { EditorState } from '../editor-state'

/**
 * FX-demo style orbit navigation for the editor. It deliberately controls the
 * existing editor camera, so all raycasts, TransformControls, debug labels, and
 * the axis gizmo keep using the same camera object in every view mode.
 */
export function createOrbitCameraSystem(
    iso: IsometricCamera,
    input: Input,
    domElement: HTMLElement,
    editorState: EditorState,
): System {
    const controls = new OrbitControls(iso.camera, domElement)
    controls.enabled = false
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 2
    controls.maxDistance = 180
    controls.minZoom = 0.25
    controls.maxZoom = 5
    controls.screenSpacePanning = false
    controls.mouseButtons = {
        LEFT: MOUSE.ROTATE,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.PAN,
    }
    controls.target.copy(iso.target)

    let wasOrbit = false

    function enterOrbit(): void {
        controls.target.copy(iso.target)
        controls.enabled = true
        controls.update()
        input.clear()
    }

    function exitOrbit(): void {
        iso.target.copy(controls.target)
        controls.enabled = false
        input.clear()
    }

    function clearEditorPointerState(): void {
        if (!wasOrbit) return
        input.clear()
    }

    function drainOrbitWheel(): void {
        if (!wasOrbit) return
        input.consumeWheel()
    }

    controls.addEventListener('start', clearEditorPointerState)
    controls.addEventListener('end', clearEditorPointerState)
    domElement.addEventListener('pointerdown', clearEditorPointerState)
    domElement.addEventListener('pointerup', clearEditorPointerState)
    domElement.addEventListener('wheel', drainOrbitWheel)

    return {
        name: 'orbitCamera',
        order: RenderOrder.cameraControl + 2,
        update() {
            const isOrbit = editorState.viewMode === 'orbit'
            if (isOrbit && !wasOrbit) enterOrbit()
            else if (!isOrbit && wasOrbit) exitOrbit()
            wasOrbit = isOrbit

            if (!isOrbit) return
            controls.update()
            iso.target.copy(controls.target)
            // Input also listens to the canvas. Drain these events so the
            // fixed-view camera controller does not inherit stale orbit input.
            input.consumeWheel()
        },
        dispose() {
            controls.removeEventListener('start', clearEditorPointerState)
            controls.removeEventListener('end', clearEditorPointerState)
            domElement.removeEventListener('pointerdown', clearEditorPointerState)
            domElement.removeEventListener('pointerup', clearEditorPointerState)
            domElement.removeEventListener('wheel', drainOrbitWheel)
            controls.dispose()
        },
    }
}

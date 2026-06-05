import { Raycaster, Vector2, Vector3, type Camera } from 'three'

export interface Ray {
    origin: Vector3
    direction: Vector3
}

/** Allocate a fresh ray struct. Reuse across frames to avoid GC pressure. */
export function makeRay(): Ray {
    return { origin: new Vector3(), direction: new Vector3() }
}

const raycaster = new Raycaster()
const ndc = new Vector2()

/**
 * Convert a CSS-pixel pointer position to a world-space ray. Works for both
 * perspective and orthographic cameras (three's `Raycaster.setFromCamera`
 * handles the difference). Mutates `out` and returns it.
 */
export function screenToWorldRay(
    clientX: number,
    clientY: number,
    camera: Camera,
    out: Ray,
    viewport: Element | DOMRect = new DOMRect(0, 0, window.innerWidth, window.innerHeight),
): Ray {
    const rect = viewport instanceof Element ? viewport.getBoundingClientRect() : viewport
    ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
    )
    raycaster.setFromCamera(ndc, camera)
    out.origin.copy(raycaster.ray.origin)
    out.direction.copy(raycaster.ray.direction)
    return out
}

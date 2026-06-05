import type { Camera, Light, Object3D } from 'three'

/**
 * Render-layer assignments. Three.js uses an integer bitmask
 * (`Object3D.layers`) to control which objects each camera renders and
 * which objects each light illuminates / shadows. We use this to keep
 * the player out of the player-held torch's shadow map: the torch is
 * attached to the player's chest, so omnidirectional shadow casting
 * otherwise projects the player's own body across the lit pool.
 *
 * Layer assignments:
 *
 *  - `WORLD` (0) — chunk geometry, block torches, props, particles.
 *    Default for every Object3D. The block torches' shadow casters
 *    (if `maxShadows > 0`) sample this layer.
 *  - `PLAYER` (1) — the player root and all its children, including
 *    the held torch model + light. We move the player off layer 0
 *    so the held torch's shadow camera (layer 0 only) skips the
 *    player body, but every camera + every light that should still
 *    see / illuminate the player must opt in via
 *    `enablePlayerVisibility()`.
 *
 * Anything new added to the scene that needs to illuminate or render
 * the player must call `enablePlayerVisibility()` on the relevant
 * object — otherwise the player will look unlit or invisible
 * depending on context. Always call this on:
 *
 *  - The main render camera(s).
 *  - The sun and its shadow camera.
 *  - Any PointLight whose `light.position` is in WORLD space but
 *    should still light the player when nearby (block torches,
 *    glow blocks, the ambient lightning flash).
 *
 * The player-held torch's own light is auto-broadened in
 * `spawnPlayer` so it lights the world too — see the traverse there.
 */
export const RENDER_LAYER = {
    WORLD: 0,
    PLAYER: 1,
} as const

/** Set the object + all descendants to a single layer (clears existing
 *  layer mask first). Used by `spawnPlayer` to move the player root
 *  off the default WORLD layer. */
export function setLayerRecursive(root: Object3D, layer: number): void {
    root.layers.set(layer)
    for (const child of root.children) setLayerRecursive(child, layer)
}

/** Enable the PLAYER layer on a camera or light's layers mask. Idempotent. */
export function enablePlayerVisibility(target: Camera | Light): void {
    target.layers.enable(RENDER_LAYER.PLAYER)
}

/** For a shadow-casting light: enable PLAYER layer on the light's own
 *  layers (so the light illuminates the player) AND on the shadow
 *  camera's layers (so the player casts a shadow from this light). */
export function castShadowOnPlayer(light: Light & { shadow: { camera: { layers: Camera['layers'] } } }): void {
    light.layers.enable(RENDER_LAYER.PLAYER)
    light.shadow.camera.layers.enable(RENDER_LAYER.PLAYER)
}

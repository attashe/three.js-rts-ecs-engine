import {
    AmbientLight,
    type Camera,
    Color,
    DirectionalLight,
    FogExp2,
    PerspectiveCamera,
    Scene,
} from 'three'
import { createBackdropScenery, type BackdropLayer, type BackdropScenery } from './backdrop-scenery'

/**
 * A perspective backdrop drawn behind the orthographic world (see
 * `Renderer.setBackdrop`). An ortho camera can't foreshorten, so a distant
 * vista rendered with it looks flat; this pass renders the authored ranges
 * with a *perspective* camera that mirrors the iso camera's position +
 * orientation, so far ranges converge and shrink into the haze, then the ortho
 * gameplay is composited on top.
 *
 * The backdrop owns its own scene (sky colour + fog + sun + ambient + the
 * ranges), so it's self-contained and weather-syncable via `setSky`/`setFog`/
 * `setSun` without coupling to the main scene's lighting. The ranges follow the
 * focus in XZ while their base Y stays fixed, so rising with the player reveals
 * more vista below — the "see the world far below as you climb" effect.
 */
export interface BackdropPassOptions {
    layers: readonly BackdropLayer[]
    /** Sky colour the backdrop clears to and fogs toward. */
    sky: number
    /** Exponential fog density. Default 0.003. */
    fogDensity?: number
    /** Perspective field of view, degrees. Lower = flatter/more telephoto
     *  (ranges read as more distant). Default 42. */
    fov?: number
    sunColor?: number
    sunIntensity?: number
    /** Sun direction (it's directional, so only the direction matters). */
    sunPosition?: [number, number, number]
    ambientColor?: number
    ambientIntensity?: number
}

export interface BackdropPass {
    readonly scene: Scene
    readonly camera: PerspectiveCamera
    /** Mirror the iso camera's position + orientation so the vista aligns with
     *  the gameplay view (call every frame). */
    syncTo(isoCamera: Camera): void
    /** Recentre the ranges on the focus point (player / camera target) in XZ. */
    update(focusX: number, focusZ: number): void
    setSky(color: number): void
    setFog(color: number, density: number): void
    setSun(color: number, intensity: number): void
    dispose(): void
}

export function createBackdropPass(opts: BackdropPassOptions): BackdropPass {
    const scene = new Scene()
    const sky = new Color(opts.sky)
    scene.background = sky
    scene.fog = new FogExp2(sky.getHex(), opts.fogDensity ?? 0.003)

    const ambient = new AmbientLight(opts.ambientColor ?? 0xffe6c4, opts.ambientIntensity ?? 0.5)
    scene.add(ambient)
    const sun = new DirectionalLight(opts.sunColor ?? 0xffdfae, opts.sunIntensity ?? 1.6)
    const [sx, sy, sz] = opts.sunPosition ?? [-120, 70, -90]
    sun.position.set(sx, sy, sz)
    scene.add(sun)

    const scenery: BackdropScenery = createBackdropScenery(scene, opts.layers, { follow: true })

    const camera = new PerspectiveCamera(opts.fov ?? 42, aspect(), 0.5, 6000)

    const onResize = (): void => {
        camera.aspect = aspect()
        camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    return {
        scene,
        camera,
        syncTo(isoCamera) {
            camera.position.copy(isoCamera.position)
            camera.quaternion.copy(isoCamera.quaternion)
            camera.updateMatrixWorld()
        },
        update(focusX, focusZ) {
            scenery.update(focusX, focusZ)
        },
        setSky(color) {
            sky.set(color)
            scene.background = sky
            const fog = scene.fog as FogExp2 | null
            if (fog) fog.color.set(color)
        },
        setFog(color, density) {
            const fog = scene.fog as FogExp2 | null
            if (!fog) return
            fog.color.set(color)
            fog.density = density
        },
        setSun(color, intensity) {
            sun.color.set(color)
            sun.intensity = intensity
        },
        dispose() {
            window.removeEventListener('resize', onResize)
            scenery.dispose()
            scene.remove(ambient, sun)
        },
    }
}

function aspect(): number {
    return window.innerHeight > 0 ? window.innerWidth / window.innerHeight : 1
}

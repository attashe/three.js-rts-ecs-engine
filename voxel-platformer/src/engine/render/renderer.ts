import { ACESFilmicToneMapping, Color, PCFSoftShadowMap, Scene, type Camera } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { IsometricCamera } from './isometric-camera'
import { StatsHUD } from './stats-hud'

/**
 * Optional perspective backdrop drawn behind the orthographic world. The
 * renderer draws `scene` with `camera` first (clearing colour + depth to the
 * backdrop's sky), then clears depth and draws the main ortho scene on top —
 * so a deep, foreshortened distant vista (which an ortho camera can't produce)
 * sits behind the crisp isometric gameplay. See `createBackdropPass`.
 */
export interface RendererBackdrop {
    readonly scene: Scene
    readonly camera: Camera
}

export class WebGPUUnavailableError extends Error {
    constructor() {
        super('WebGPU is not available in this browser. Try a recent Chrome / Edge / Firefox build.')
        this.name = 'WebGPUUnavailableError'
    }
}

/**
 * Phase 2 renderer: WebGPU + fixed isometric orthographic camera + ACES tone
 * mapping + MSAA. No WebGL fallback (per the locked decision in README).
 *
 * Construction is sync; the underlying WebGPU device must be initialised via
 * `await renderer.init()` before the first frame. `Engine.start()` handles
 * this for callers.
 *
 * Note: three.js recommends `renderer.setAnimationLoop(cb)` as the canonical
 * frame loop (auto-init, free WebXR support). We deliberately use our own
 * `Scheduler` instead because it provides separate fixed-timestep and
 * render-timestep buckets that `setAnimationLoop` does not. As long as
 * `init()` is awaited before the first `render()` (which `Engine.start()`
 * guarantees), manual rAF is officially supported — see the comment on
 * `Renderer.render()` in three's `renderers/common/Renderer.js`.
 */
export class Renderer {
    readonly scene: Scene
    readonly iso: IsometricCamera
    readonly webgpu: WebGPURenderer
    readonly stats: StatsHUD
    private backdrop: RendererBackdrop | null = null

    constructor() {
        if (!('gpu' in navigator) || navigator.gpu == null) {
            throw new WebGPUUnavailableError()
        }

        this.scene = new Scene()
        this.scene.background = new Color(0x101418)

        this.iso = new IsometricCamera()

        this.webgpu = new WebGPURenderer({ antialias: true })
        this.webgpu.setPixelRatio(window.devicePixelRatio)
        this.webgpu.setSize(window.innerWidth, window.innerHeight)
        this.webgpu.toneMapping = ACESFilmicToneMapping
        this.webgpu.toneMappingExposure = 1.0
        this.webgpu.shadowMap.enabled = true
        this.webgpu.shadowMap.type = PCFSoftShadowMap
        // We drive rendering from our own Scheduler instead of
        // WebGPURenderer.setAnimationLoop(), so Three will not reset
        // per-frame info for us. Reset once at the start of render().
        this.webgpu.info.autoReset = false
        document.body.appendChild(this.webgpu.domElement)

        this.stats = new StatsHUD()

        window.addEventListener('resize', this.onResize)
    }

    /** Convenience accessor — the camera the engine renders with. */
    get camera() {
        return this.iso.camera
    }

    async init(): Promise<void> {
        await this.webgpu.init()
    }

    private onResize = () => {
        this.iso.onResize()
        this.webgpu.setSize(window.innerWidth, window.innerHeight)
    }

    update(dt: number): void {
        this.stats.update(dt)
    }

    /** Install (or clear with `null`) a perspective backdrop drawn behind the
     *  ortho world. The main scene must leave its `background` null so the
     *  backdrop's sky shows through. */
    setBackdrop(backdrop: RendererBackdrop | null): void {
        this.backdrop = backdrop
    }

    render(): void {
        this.webgpu.info.reset()
        const bp = this.backdrop
        if (bp) {
            // Pass 1: backdrop (clears colour to its sky + depth).
            this.webgpu.autoClear = true
            this.webgpu.render(bp.scene, bp.camera)
            // Pass 2: ortho world on top — keep the backdrop colour, drop its
            // depth so near geometry isn't occluded by far ranges.
            this.webgpu.autoClear = false
            this.webgpu.clearDepth()
            this.webgpu.render(this.scene, this.iso.camera)
            this.webgpu.autoClear = true
            return
        }
        this.webgpu.render(this.scene, this.iso.camera)
    }

    dispose(): void {
        window.removeEventListener('resize', this.onResize)
        this.stats.dispose()
        this.webgpu.dispose()
        this.webgpu.domElement.remove()
    }
}

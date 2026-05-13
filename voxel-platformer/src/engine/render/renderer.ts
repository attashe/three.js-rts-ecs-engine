import { ACESFilmicToneMapping, Color, PCFSoftShadowMap, Scene } from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { IsometricCamera } from './isometric-camera'
import { StatsHUD } from './stats-hud'

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

    render(): void {
        this.webgpu.render(this.scene, this.iso.camera)
    }

    dispose(): void {
        window.removeEventListener('resize', this.onResize)
        this.stats.dispose()
        this.webgpu.dispose()
        this.webgpu.domElement.remove()
    }
}

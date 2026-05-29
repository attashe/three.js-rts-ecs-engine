import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    FogExp2,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Renderer, WebGPUUnavailableError } from './engine/render/renderer'
import { createBackdropScenery, type BackdropLayer } from './engine/render/backdrop-scenery'

/**
 * Standalone showcase for the authored distant-backdrop scenery
 * (`createBackdropScenery`). Sets up a warm sunset sky + fog + sun and a few
 * hand-tuned mountain ranges so the layered vista — and how fog blends the
 * far ranges into the sky — is visible without wiring into the full game.
 */
const SKY = new Color(0xf6cda0)

// Hand-authored ranges: nearer = darker + taller-contrast, farther = lighter
// and closer to the sky colour so fog melts them into the horizon.
const LAYERS: BackdropLayer[] = [
    { seed: 11, distance: 130, baseY: -8, height: 46, ruggedness: 0.7, colorLow: [0.18, 0.16, 0.22], colorHigh: [0.42, 0.34, 0.36] },
    { seed: 23, distance: 190, baseY: -6, height: 66, ruggedness: 0.55, colorLow: [0.34, 0.30, 0.34], colorHigh: [0.62, 0.50, 0.46] },
    { seed: 37, distance: 255, baseY: -4, height: 92, ruggedness: 0.45, colorLow: [0.55, 0.46, 0.44], colorHigh: [0.82, 0.68, 0.56] },
    { seed: 51, distance: 320, baseY: -2, height: 120, ruggedness: 0.35, colorLow: [0.78, 0.64, 0.54], colorHigh: [0.95, 0.82, 0.66] },
]

async function main(): Promise<void> {
    try {
        const renderer = new Renderer()
        renderer.scene.background = SKY
        renderer.scene.fog = new FogExp2(SKY.getHex(), 0.0032)
        renderer.iso.setViewMode('orbit')

        renderer.scene.add(new AmbientLight(0xffe6c4, 0.5))
        const sun = new DirectionalLight(0xffdfae, 1.7)
        sun.position.set(-120, 70, -90) // low, behind the ranges → rim-lit sunset
        renderer.scene.add(sun)

        // Small foreground plateau so the ranges read as "far below/beyond".
        const ground = new Mesh(
            new PlaneGeometry(60, 60),
            new MeshStandardMaterial({ color: 0x6f7d5a, roughness: 1 }),
        )
        ground.rotation.x = -Math.PI / 2
        renderer.scene.add(ground)
        const plateau = new Mesh(
            new BoxGeometry(18, 10, 18),
            new MeshStandardMaterial({ color: 0x8a7d63, roughness: 1, flatShading: true }),
        )
        plateau.position.set(0, -5, 0)
        renderer.scene.add(plateau)

        const backdrop = createBackdropScenery(renderer.scene, LAYERS, { follow: false })

        const controls = new OrbitControls(renderer.iso.camera, renderer.webgpu.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.06
        controls.target.set(0, 10, 0)
        controls.minDistance = 10
        controls.maxDistance = 360
        renderer.iso.camera.position.set(34, 26, 44)
        renderer.iso.camera.lookAt(0, 10, 0)
        renderer.iso.camera.far = 1200
        renderer.iso.camera.updateProjectionMatrix()
        controls.update()

        await renderer.init()

        let disposed = false
        window.addEventListener('beforeunload', () => {
            if (disposed) return
            disposed = true
            controls.dispose()
            backdrop.dispose()
            renderer.dispose()
        })

        let last = performance.now()
        function frame(now = performance.now()): void {
            const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
            last = now
            controls.update()
            renderer.update(dt)
            renderer.render()
            requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
    } catch (err) {
        if (err instanceof WebGPUUnavailableError) {
            document.body.innerHTML = `<p style="margin:24px;color:#b00">${err.message}</p>`
            return
        }
        throw err
    }
}

void main()

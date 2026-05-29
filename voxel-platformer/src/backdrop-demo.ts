import {
    AmbientLight,
    BoxGeometry,
    DirectionalLight,
    FogExp2,
    Color,
    Mesh,
    MeshStandardMaterial,
    PlaneGeometry,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Renderer, WebGPUUnavailableError } from './engine/render/renderer'
import { createBackdropPass } from './engine/render/backdrop-pass'
import type { BackdropLayer } from './engine/render/backdrop-scenery'

/**
 * Showcase for the perspective backdrop behind the orthographic world
 * (`Renderer.setBackdrop` + `createBackdropPass`). The foreground renders with
 * the ortho iso camera; the authored ranges render first through a perspective
 * camera that mirrors it, so far ranges foreshorten into the haze — the deep
 * vista an ortho camera can't make on its own. Orbit to see the composite;
 * dolly the target up to see more vista revealed below.
 */
const SKY = 0xf6cda0

const LAYERS: BackdropLayer[] = [
    { seed: 11, distance: 220, baseY: -10, height: 70, ruggedness: 0.7, colorLow: [0.18, 0.16, 0.22], colorHigh: [0.42, 0.34, 0.36] },
    { seed: 23, distance: 320, baseY: -8, height: 110, ruggedness: 0.55, colorLow: [0.34, 0.30, 0.34], colorHigh: [0.62, 0.50, 0.46] },
    { seed: 37, distance: 440, baseY: -6, height: 160, ruggedness: 0.45, colorLow: [0.55, 0.46, 0.44], colorHigh: [0.82, 0.68, 0.56] },
    { seed: 51, distance: 580, baseY: -4, height: 220, ruggedness: 0.35, colorLow: [0.78, 0.64, 0.54], colorHigh: [0.95, 0.82, 0.66] },
]

async function main(): Promise<void> {
    try {
        const renderer = new Renderer()
        // Leave the main scene's background null so the backdrop's sky shows
        // through the composite; a faint matching fog blends the foreground.
        renderer.scene.background = null
        renderer.scene.fog = new FogExp2(new Color(SKY).getHex(), 0.0016)
        renderer.iso.setViewMode('orbit')

        renderer.scene.add(new AmbientLight(0xffe6c4, 0.5))
        const sun = new DirectionalLight(0xffdfae, 1.7)
        sun.position.set(-60, 50, -40)
        renderer.scene.add(sun)

        // Foreground plateau — the gameplay stand-in the player would be on.
        const ground = new Mesh(new PlaneGeometry(80, 80), new MeshStandardMaterial({ color: 0x6f7d5a, roughness: 1 }))
        ground.rotation.x = -Math.PI / 2
        renderer.scene.add(ground)
        const plateau = new Mesh(
            new BoxGeometry(20, 12, 20),
            new MeshStandardMaterial({ color: 0x8a7d63, roughness: 1, flatShading: true }),
        )
        plateau.position.set(0, -6, 0)
        renderer.scene.add(plateau)

        const backdrop = createBackdropPass({
            layers: LAYERS,
            sky: SKY,
            fogDensity: 0.0019,
            fov: 42,
            sunColor: 0xffdfae,
            sunIntensity: 1.7,
            sunPosition: [-120, 70, -90],
        })
        renderer.setBackdrop(backdrop)

        const controls = new OrbitControls(renderer.iso.camera, renderer.webgpu.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.06
        controls.target.set(0, 8, 0)
        controls.minDistance = 12
        controls.maxDistance = 200
        renderer.iso.camera.position.set(36, 26, 46)
        renderer.iso.camera.lookAt(0, 8, 0)
        controls.update()

        await renderer.init()

        let disposed = false
        window.addEventListener('beforeunload', () => {
            if (disposed) return
            disposed = true
            controls.dispose()
            renderer.setBackdrop(null)
            backdrop.dispose()
            renderer.dispose()
        })

        let last = performance.now()
        function frame(now = performance.now()): void {
            const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
            last = now
            controls.update()
            backdrop.syncTo(renderer.iso.camera)
            backdrop.update(controls.target.x, controls.target.z)
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

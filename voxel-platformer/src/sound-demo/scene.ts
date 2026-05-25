import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    GridHelper,
    InstancedMesh,
    Mesh,
    MeshStandardMaterial,
    Object3D,
    PerspectiveCamera,
    PlaneGeometry,
    Scene,
} from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Bootstrap a small WebGPU scene for the sound demo. The scene is
 * intentionally simple — a tiled ground, a soft sun, and an
 * orbital camera — because its job is to make spatial sound
 * relationships legible, not to look impressive.
 */
export interface DemoScene {
    scene: Scene
    camera: PerspectiveCamera
    renderer: WebGPURenderer
    controls: OrbitControls
    ready: Promise<void>
}

export function createDemoScene(canvas: HTMLCanvasElement): DemoScene {
    const scene = new Scene()
    scene.background = new Color('#0a0e14')

    const camera = new PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.2, 200)
    camera.position.set(0, 18, 22)

    const renderer = new WebGPURenderer({ canvas, antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)

    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 0, 0)
    controls.minDistance = 4
    controls.maxDistance = 80
    // Keep the camera above the ground so emitter rings stay readable.
    controls.maxPolarAngle = Math.PI * 0.48

    scene.add(new AmbientLight(0xffffff, 0.55))
    const sun = new DirectionalLight(0xffe2b3, 0.85)
    sun.position.set(12, 18, 8)
    scene.add(sun)

    buildGround(scene)
    buildPillars(scene)

    return {
        scene,
        camera,
        renderer,
        controls,
        ready: renderer.init().then(() => undefined),
    }
}

function buildGround(scene: Scene): void {
    const ground = new Mesh(
        new PlaneGeometry(60, 60),
        new MeshStandardMaterial({ color: new Color('#1a2230'), roughness: 0.95 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    scene.add(ground)

    // Two-tone tile mat to give the eye distance cues without ever
    // touching a per-tile mesh.
    const tiles = 16
    const tileSize = 3
    const count = tiles * tiles
    const tileMat = new MeshStandardMaterial({ roughness: 0.85 })
    const mesh = new InstancedMesh(new BoxGeometry(tileSize, 0.2, tileSize), tileMat, count)
    const dummy = new Object3D()
    const a = new Color('#27313f')
    const b = new Color('#1e2735')
    const tmp = new Color()
    for (let i = 0; i < count; i++) {
        const x = (i % tiles) - tiles / 2
        const z = Math.floor(i / tiles) - tiles / 2
        dummy.position.set(x * tileSize + tileSize / 2, 0, z * tileSize + tileSize / 2)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        tmp.copy((x + z + 100) % 2 === 0 ? a : b)
        mesh.setColorAt(i, tmp)
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    scene.add(mesh)

    const grid = new GridHelper(60, 30, 0x3a4658, 0x222a36)
    grid.position.y = 0.06
    scene.add(grid)
}

function buildPillars(scene: Scene): void {
    // A few stepped pillars give the panned audio a visual anchor —
    // hearing a sound at +X is easier to verify when there's a
    // pillar there for the eye to lock on.
    const mat = new MeshStandardMaterial({ color: new Color('#3e4a5e'), roughness: 0.75 })
    for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2
        const r = 18
        const h = 3 + (i % 3)
        const pillar = new Mesh(new BoxGeometry(1.8, h, 1.8), mat)
        pillar.position.set(Math.cos(ang) * r, h / 2, Math.sin(ang) * r)
        scene.add(pillar)
    }
}

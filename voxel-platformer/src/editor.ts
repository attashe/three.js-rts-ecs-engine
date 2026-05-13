import { AmbientLight, DirectionalLight } from 'three'
import { Engine } from './engine/engine'
import { ChunkManager, ChunkRenderer, DEFAULT_PALETTE, BLOCK } from './engine/voxel'
import type { System } from './engine/ecs/systems/system'
import { RenderOrder } from './engine/ecs/systems/orders'
import { createRenderSyncSystem } from './engine/ecs/systems/render-sync-system'
import { createCameraControlSystem } from './engine/ecs/systems/camera-control-system'
import { createDebugOverlaySystem } from './engine/ecs/systems/debug-overlay-system'
import { createRenderMetricsSystem } from './engine/ecs/systems/render-metrics-system'
import { createEditorActionMap } from './editor/actions'
import { createEditorState } from './editor/editor-state'
import { createVoxelCursorSystem } from './editor/systems/voxel-cursor-system'
import { createVoxelPaintSystem } from './editor/systems/voxel-paint-system'
import { createPickupSpawnSystem } from './editor/systems/pickup-spawn-system'
import { mountEditorPanel } from './editor/editor-ui'

async function main(): Promise<void> {
    const engine = new Engine({ fixedHz: 60 })
    const { renderer, world } = engine
    const actions = createEditorActionMap(engine.input)

    // Lighting matches the game so painted voxels look the same in editor + play.
    renderer.scene.add(new AmbientLight(0xffffff, 0.5))
    const sun = new DirectionalLight(0xfff0d4, 1.1)
    sun.position.set(32, 60, 24)
    sun.target.position.set(12, 0, 12)
    sun.castShadow = true
    sun.shadow.camera.left = -24
    sun.shadow.camera.right = 24
    sun.shadow.camera.top = 24
    sun.shadow.camera.bottom = -24
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 180
    sun.shadow.mapSize.set(1024, 1024)
    renderer.scene.add(sun)
    renderer.scene.add(sun.target)

    const chunks = new ChunkManager(DEFAULT_PALETTE)

    // Seed a tiny 12×12 grass pad so the user can see the cursor on landing
    // and start building from somewhere instead of staring at the void.
    const padY = 4
    for (let x = 0; x < 12; x++) {
        for (let z = 0; z < 12; z++) {
            chunks.setVoxel(x, padY, z, BLOCK.grass)
            for (let y = 0; y < padY; y++) chunks.setVoxel(x, y, z, BLOCK.dirt)
        }
    }

    const chunkRenderer = new ChunkRenderer(renderer.scene, chunks)
    chunkRenderer.rebuildAll()

    const editorState = createEditorState({ x: 6, y: padY + 1, z: 6 })

    renderer.iso.target.set(editorState.spawn.x, editorState.spawn.y, editorState.spawn.z)
    renderer.iso.syncPosition()

    mountEditorPanel({ world, chunks, editorState })

    const chunkRenderSystem: System = {
        name: 'chunkRender',
        order: RenderOrder.worldRender,
        update: () => chunkRenderer.update(),
        dispose: () => chunkRenderer.dispose(),
    }

    engine
        .addSystem(createVoxelPaintSystem(chunks, engine.input, editorState), 'voxelPaint')
        .addSystem(createPickupSpawnSystem(engine.input, editorState), 'pickupSpawn')
        .addSystem(createRenderSyncSystem(renderer.scene), 'renderSync')
        .addSystem(chunkRenderSystem, 'chunkRender')
        .addSystem(createVoxelCursorSystem(renderer.scene, renderer.iso, engine.input, chunks, editorState), 'voxelCursor')
        .addSystem(createRenderMetricsSystem(renderer), 'renderMetrics')
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input), 'debugOverlay')
        .addSystem(createCameraControlSystem(renderer.iso, engine.input, actions, {
            keyboardPan: true,
            edgePan: false,
            wheelZoom: true,
            panSpeed: 12,
        }), 'cameraControl')

    await engine.start()
}

void main()

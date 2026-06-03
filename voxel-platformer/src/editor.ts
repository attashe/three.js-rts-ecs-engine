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
import { createTerrainEditSystem } from './editor/systems/terrain-edit-system'
import { createTerrainPreviewSystem } from './editor/systems/terrain-preview-system'
import { createHistorySystem } from './editor/systems/history-system'
import { createCommandStack } from './editor/history'
import { createPaletteHotkeySystem } from './editor/systems/palette-hotkey-system'
import { createPickupSpawnSystem } from './editor/systems/pickup-spawn-system'
import { createPistonPlaceSystem } from './editor/systems/piston-place-system'
import { createSpawnPlaceSystem } from './editor/systems/spawn-place-system'
import { createSpawnMarkerSystem } from './editor/systems/spawn-marker-system'
import { createPistonMarkerSystem } from './editor/systems/piston-marker-system'
import { createZonePlaceSystem } from './editor/systems/zone-place-system'
import { createZoneRenderSystem } from './editor/systems/zone-render-system'
import { createSoundSourcePlaceSystem } from './editor/systems/sound-source-place-system'
import { createSoundSourceRenderSystem } from './editor/systems/sound-source-render-system'
import { createSoundZonePlaceSystem } from './editor/systems/sound-zone-place-system'
import { createSoundZoneRenderSystem } from './editor/systems/sound-zone-render-system'
import { createWeatherZonePlaceSystem } from './editor/systems/weather-zone-place-system'
import { createWeatherZoneRenderSystem } from './editor/systems/weather-zone-render-system'
import { createPropPlaceSystem } from './editor/systems/prop-place-system'
import { createPropRenderSystem } from './game/props/prop-system'
import { createNpcPlaceSystem } from './editor/systems/npc-place-system'
import { createNpcRenderSystem } from './game/npcs/npc-render-system'
import { createStonePlaceSystem } from './editor/systems/stone-place-system'
import { createStoneRenderSystem } from './editor/systems/stone-render-system'
import { createRailCartPlaceSystem } from './editor/systems/rail-cart-place-system'
import { createRailCartRenderSystem } from './editor/systems/rail-cart-render-system'
import { createStructurePlaceSystem } from './editor/systems/structure-place-system'
import { createStructurePreviewSystem } from './editor/systems/structure-preview-system'
import { createSelectionGizmoSystem } from './editor/systems/selection-gizmo-system'
import { createWorkingPlaneSystem } from './editor/systems/working-plane-system'
import { createWorkingPlaneOutlinesSystem } from './editor/systems/working-plane-outlines-system'
import { createViewModeSystem } from './editor/systems/view-mode-system'
import { createAxisGizmoSystem } from './editor/systems/axis-gizmo-system'
import { createOrbitCameraSystem } from './editor/systems/orbit-camera-system'
import { createSunFollowSystem } from './engine/render/sun-follow-system'
import { castShadowOnPlayer, enablePlayerVisibility } from './engine/render/render-layers'
import { createTorchBlockRenderSystem } from './game/torch-block-system'
import { createRailRenderSystem } from './game/rail/rail-render-system'
import { createFenceRenderSystem } from './game/fence/fence-render-system'
import { createLadderRenderSystem } from './game/ladder/ladder-render-system'
import { mountEditorPanel } from './editor/editor-ui'
import { createCinematicPreview } from './editor/cinematic-preview'
import { consumePlaytestLevel } from './editor/playtest'
import { loadLevelFromBuffer } from './editor/save-load'
import type { GameWorld } from './engine/ecs/world'
import type { EditorState } from './editor/editor-state'

async function main(): Promise<void> {
    const engine = new Engine({ fixedHz: 60 })
    const { renderer, world } = engine
    const actions = createEditorActionMap(engine.input)

    // Lighting matches the game so painted voxels look the same in editor + play.
    const editorAmbient = new AmbientLight(0xffffff, 0.5)
    enablePlayerVisibility(editorAmbient)
    renderer.scene.add(editorAmbient)
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
    // The player rig is on a non-default render layer; enable it on
    // the sun + its shadow camera so the character is sunlit and casts
    // sun shadows. (The editor has no player by default but this is
    // cheap and keeps editor/game lighting symmetric.)
    castShadowOnPlayer(sun)
    renderer.scene.add(sun)
    renderer.scene.add(sun.target)

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const padY = 4
    const editorState = createEditorState({ x: 6, y: padY + 1, z: 6 })

    // If we got here via the playtest "← Editor" button, sessionStorage
    // still holds the level the user was just playtesting — restore that
    // session so they don't lose their work. Falls back to seeding a fresh
    // 12×12 grass pad when there's nothing to restore.
    const restored = restoreSessionLevel(world, chunks, editorState)
    if (!restored) {
        for (let x = 0; x < 12; x++) {
            for (let z = 0; z < 12; z++) {
                chunks.setVoxel(x, padY, z, BLOCK.grass)
                for (let y = 0; y < padY; y++) chunks.setVoxel(x, y, z, BLOCK.dirt)
            }
        }
    }

    // Mesh streaming around the camera pivot keeps large authored levels
    // (up to NEW_LEVEL_MAX_DIMENSION) smooth to edit: only chunks near the
    // pan/orbit target are meshed, and (re)meshing is spread across frames.
    // Voxel data stays fully resident, so editing, the working-plane cut, and
    // the cover mask all keep reading the whole level. Small levels fit inside
    // the radius, so behaviour there is unchanged.
    const chunkRenderer = new ChunkRenderer(renderer.scene, chunks, {
        streaming: {
            focus: () => renderer.iso.target,
            radiusChunks: 8,
            budgetPerFrame: 8,
        },
    })
    chunkRenderer.rebuildAll()

    renderer.iso.target.set(editorState.spawn.x, editorState.spawn.y, editorState.spawn.z)
    renderer.iso.syncPosition()

    const history = createCommandStack()
    const cinematicPreview = createCinematicPreview(renderer.iso, editorState)
    mountEditorPanel({ world, chunks, editorState, history, cinematicPreview: cinematicPreview.controller })

    const chunkRenderSystem: System = {
        name: 'chunkRender',
        order: RenderOrder.worldRender,
        update: () => chunkRenderer.update(),
        dispose: () => chunkRenderer.dispose(),
    }

    engine
        .addSystem(createSunFollowSystem(sun, () => renderer.iso.target), 'sunFollow')
        .addSystem(createHistorySystem(engine.input, history), 'history')
        .addSystem(createPaletteHotkeySystem(chunks, engine.input, renderer.iso, editorState), 'paletteHotkeys')
        .addSystem(createTerrainEditSystem(chunks, engine.input, editorState, history), 'terrainEdit')
        .addSystem(createVoxelPaintSystem(chunks, engine.input, editorState, history), 'voxelPaint')
        .addSystem(createPickupSpawnSystem(engine.input, editorState), 'pickupSpawn')
        .addSystem(createPistonPlaceSystem(chunks, engine.input, editorState), 'pistonPlace')
        .addSystem(createSpawnPlaceSystem(engine.input, editorState), 'spawnPlace')
        .addSystem(createZonePlaceSystem(engine.input, editorState), 'zonePlace')
        .addSystem(createSoundSourcePlaceSystem(engine.input, editorState), 'soundSourcePlace')
        .addSystem(createSoundZonePlaceSystem(engine.input, editorState), 'soundZonePlace')
        .addSystem(createWeatherZonePlaceSystem(engine.input, editorState), 'weatherZonePlace')
        .addSystem(createPropPlaceSystem(engine.input, renderer.iso, chunks, editorState), 'propPlace')
        .addSystem(createNpcPlaceSystem(engine.input, renderer.iso, chunks, editorState), 'npcPlace')
        .addSystem(createStonePlaceSystem(engine.input, editorState), 'stonePlace')
        .addSystem(createRailCartPlaceSystem(engine.input, chunks, editorState), 'railCartPlace')
        .addSystem(createStructurePlaceSystem(engine.input, chunks, editorState, history), 'structurePlace')
        .addSystem(createPropRenderSystem(renderer.scene, {
            getProps: () => editorState.props,
            castShadows: true,
        }), 'propRender')
        .addSystem(createNpcRenderSystem(renderer.scene, { getNpcs: () => editorState.npcs }), 'npcRender')
        .addSystem(createStoneRenderSystem(renderer.scene, editorState), 'stoneRender')
        .addSystem(createRailCartRenderSystem(renderer.scene, editorState), 'railCartRender')
        .addSystem(createRenderSyncSystem(renderer.scene), 'renderSync')
        .addSystem(chunkRenderSystem, 'chunkRender')
        .addSystem(createTorchBlockRenderSystem(renderer.scene, chunks, {
            cutY: () => editorState.viewMode === 'top-down' ? editorState.workingPlaneY : null,
            focus: () => renderer.iso.target,
            lightsEnabled: false,
        }), 'torchBlocks')
        .addSystem(createRailRenderSystem(renderer.scene, chunks, {
            cutY: () => editorState.viewMode === 'top-down' ? editorState.workingPlaneY : null,
        }), 'railRender')
        .addSystem(createFenceRenderSystem(renderer.scene, chunks, {
            cutY: () => editorState.viewMode === 'top-down' ? editorState.workingPlaneY : null,
        }), 'fenceRender')
        .addSystem(createLadderRenderSystem(renderer.scene, chunks, {
            cutY: () => editorState.viewMode === 'top-down' ? editorState.workingPlaneY : null,
        }), 'ladderRender')
        .addSystem(createVoxelCursorSystem(renderer.scene, renderer.iso, engine.input, chunks, editorState), 'voxelCursor')
        .addSystem(createTerrainPreviewSystem(renderer.scene, chunks, editorState), 'terrainPreview')
        .addSystem(createWorkingPlaneSystem(renderer.scene, engine.input, renderer.iso, editorState), 'workingPlane')
        .addSystem(createWorkingPlaneOutlinesSystem(renderer.scene, chunks, editorState), 'workingPlaneOutlines')
        .addSystem(createSpawnMarkerSystem(renderer.scene, editorState), 'spawnMarker')
        .addSystem(createPistonMarkerSystem(renderer.scene, editorState), 'pistonMarker')
        .addSystem(createZoneRenderSystem(renderer.scene, editorState), 'zoneRender')
        .addSystem(createSoundSourceRenderSystem(renderer.scene, editorState), 'soundSourceRender')
        .addSystem(createSoundZoneRenderSystem(renderer.scene, editorState), 'soundZoneRender')
        .addSystem(createWeatherZoneRenderSystem(renderer.scene, editorState), 'weatherZoneRender')
        .addSystem(createStructurePreviewSystem(renderer.scene, editorState, chunks), 'structurePreview')
        .addSystem(createSelectionGizmoSystem(renderer.scene, renderer.iso, engine.input, renderer.webgpu.domElement, chunks, editorState), 'selectionGizmo')
        .addSystem(createRenderMetricsSystem(renderer), 'renderMetrics')
        // Editor panel lives top-right; push debug metrics / log to the
        // bottom corners so the four panels don't collide.
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input, {
            metricsPosition: { bottom: '8px', left: '8px' },
            logPosition: { bottom: '8px', right: '8px', maxWidth: '320px' },
            cameraProvider: () => renderer.iso.camera,
            renderElement: renderer.webgpu.domElement,
        }), 'debugOverlay')
        .addSystem(createCameraControlSystem(renderer.iso, engine.input, actions, {
            keyboardPan: true,
            edgePan: false,
            wheelZoom: true,
            panSpeed: 12,
        }), 'cameraControl')
        .addSystem(createViewModeSystem(renderer.iso, chunkRenderer, chunks, editorState), 'viewMode')
        .addSystem(createOrbitCameraSystem(renderer.iso, engine.input, renderer.webgpu.domElement, editorState), 'orbitCamera')
        .addSystem(createAxisGizmoSystem(renderer.iso), 'axisGizmo')
        .addSystem(cinematicPreview.system, 'cinematicPreview')

    await engine.start()
}

function restoreSessionLevel(world: GameWorld, chunks: ChunkManager, editorState: EditorState): boolean {
    const buffer = consumePlaytestLevel()
    if (!buffer) return false
    try {
        loadLevelFromBuffer(buffer, world, chunks, editorState)
        return true
    } catch (err) {
        console.error('Editor: failed to restore session level — starting fresh.', err)
        return false
    }
}

void main()

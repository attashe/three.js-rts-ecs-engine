import { AmbientLight, DirectionalLight } from 'three'
import { Engine } from './engine/engine'
import { ChunkManager, ChunkRenderer, DEFAULT_PALETTE } from './engine/voxel'
import type { System } from './engine/ecs/systems/system'
import { RenderOrder } from './engine/ecs/systems/orders'
import { createRenderSyncSystem } from './engine/ecs/systems/render-sync-system'
import { createCameraControlSystem } from './engine/ecs/systems/camera-control-system'
import { createCameraFollowSystem } from './engine/ecs/systems/camera-follow-system'
import { createPlayerControlSystem } from './engine/ecs/systems/player-control-system'
import { createPhysicsSystem } from './engine/ecs/systems/physics-system'
import { createDynamicCollisionSystem } from './engine/ecs/systems/dynamic-collision-system'
import { createRigidBodyPairSystem } from './engine/ecs/systems/rigidbody-pair-system'
import { createImpactSystem } from './engine/ecs/systems/impact-system'
import { createDebugOverlaySystem } from './engine/ecs/systems/debug-overlay-system'
import { createRenderMetricsSystem } from './engine/ecs/systems/render-metrics-system'
import { createFallingStoneSpawnerSystem, createMovingObjectSystem } from './engine/ecs/systems/moving-object-system'
import { createProjectileLaunchSystem } from './engine/ecs/systems/projectile-launch-system'
import { createArrowHitSystem } from './engine/ecs/systems/arrow-hit-system'
import { createAirPushSystem } from './engine/ecs/systems/air-push-system'
import { createHighJumpSystem } from './engine/ecs/systems/high-jump-system'
import { createPickupSystem } from './engine/ecs/systems/pickup-system'
import { createPistonSystem } from './engine/ecs/systems/piston-system'
import { generatePlatformerLevel } from './game/level'
import { spawnPlayer } from './game/player'
import { spawnCoinPile } from './game/pickups'
import { registerPistonMechanism } from './game/mechanisms'
import { createGameActionMap, GameAction } from './game/actions'

async function main(): Promise<void> {
    const engine = new Engine({ fixedHz: 60 })
    const { renderer, world } = engine
    const actions = createGameActionMap(engine.input)

    // Lighting. Sun from south-east, target at the centre of the demo level so
    // the shadow camera covers the whole island.
    renderer.scene.add(new AmbientLight(0xffffff, 0.45))
    const sun = new DirectionalLight(0xfff0d4, 1.2)
    sun.position.set(32, 60, 24)
    sun.target.position.set(12, 0, 12)
    sun.castShadow = true
    sun.shadow.camera.left = -20
    sun.shadow.camera.right = 20
    sun.shadow.camera.top = 20
    sun.shadow.camera.bottom = -20
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 160
    sun.shadow.mapSize.set(1024, 1024)
    renderer.scene.add(sun)
    renderer.scene.add(sun.target)

    // Voxel world + level + chunk renderer.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generatePlatformerLevel(chunks)
    sun.target.position.set(meta.size / 2, 0, meta.size / 2)
    const chunkRenderer = new ChunkRenderer(renderer.scene, chunks)
    chunkRenderer.rebuildAll()

    spawnPlayer(world, { spawn: meta.spawn })
    for (const coin of meta.coinPiles) spawnCoinPile(world, coin)
    for (const piston of meta.pistons) registerPistonMechanism(world, chunks, piston)

    // Centre the camera on the player from the very first frame so we don't
    // see a "fly-in" from the world origin.
    renderer.iso.target.set(meta.spawn.x, meta.spawn.y, meta.spawn.z)
    renderer.iso.syncPosition()

    // Wrap chunk-meshing as a render-step system so it integrates with the engine loop.
    const chunkRenderSystem: System = {
        name: 'chunkRender',
        order: RenderOrder.worldRender,
        update: () => chunkRenderer.update(),
        dispose: () => chunkRenderer.dispose(),
    }

    engine
        .addSystem(createPlayerControlSystem(engine.input, actions, renderer.iso), 'playerControl')
        .addSystem(createProjectileLaunchSystem(actions, { actionId: GameAction.BowShot }), 'projectileLaunch')
        .addSystem(createArrowHitSystem(chunks), 'arrowHit')
        .addSystem(createHighJumpSystem(actions, { actionId: GameAction.HighJump }), 'highJump')
        .addSystem(createAirPushSystem(actions, { actionId: GameAction.AirPush }), 'airPush')
        .addSystem(createPickupSystem(), 'pickup')
        .addSystem(createPistonSystem(chunks), 'piston')
        .addSystem(createFallingStoneSpawnerSystem(meta.stoneSpawners, { maxMovingStones: 12 }), 'stoneSpawner')
        .addSystem(createPhysicsSystem(chunks), 'physics')
        .addSystem(createRigidBodyPairSystem(chunks), 'rigidBodyPairs')
        .addSystem(createImpactSystem(), 'impact')
        .addSystem(createMovingObjectSystem(), 'movingObjects')
        .addSystem(createDynamicCollisionSystem(chunks), 'dynamicCollision')
        .addSystem(createRenderSyncSystem(renderer.scene), 'renderSync')
        .addSystem(chunkRenderSystem, 'chunkRender')
        .addSystem(createRenderMetricsSystem(renderer), 'renderMetrics')
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input), 'debugOverlay')
        .addSystem(createCameraControlSystem(renderer.iso, engine.input, actions, {
            keyboardPan: false,
            edgePan: false,
            wheelZoom: true,
        }), 'cameraControl')
        .addSystem(createCameraFollowSystem(renderer.iso, { smoothing: 8 }), 'cameraFollow')

    await engine.start()
}

void main()

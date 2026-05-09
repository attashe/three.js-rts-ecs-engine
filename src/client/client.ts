import { AmbientLight, DirectionalLight, Vector3 } from 'three'
import { addComponent } from 'bitecs'
import { GameHud, fatalOverlay } from './ui'
import { Engine } from './engine/engine'
import { WebGPUUnavailableError } from './engine/render/renderer'
import { ChunkManager, ChunkRenderer, DEFAULT_PALETTE, findPath } from './engine/voxel'
import { MoveAlongPath } from './engine/ecs/components'
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
import { createVoxelMechanismSystem } from './engine/ecs/systems/voxel-mechanism-system'
import { createFallingStoneSpawnerSystem, createMovingObjectSystem } from './engine/ecs/systems/moving-object-system'
import { createProjectileLaunchSystem } from './engine/ecs/systems/projectile-launch-system'
import { createArrowHitSystem } from './engine/ecs/systems/arrow-hit-system'
import { createAirPushSystem } from './engine/ecs/systems/air-push-system'
import { MoveAlongPathSystem } from './engine/ecs/systems/move-along-path-system'
import { createInteractionSystem } from './engine/ecs/systems/interaction-system'
import { createMeleeCombatSystem } from './engine/ecs/systems/melee-combat-system'
import { createPickupSystem } from './engine/ecs/systems/pickup-system'
import { createWanderSystem } from './engine/ecs/systems/wander-system'
import { generateDemoLevel } from './game/level'
import { spawnPlayer } from './game/player'
import { spawnSampleNpc, spawnWanderingNpc } from './game/npc'
import { spawnCoinPile, spawnHealthPotion, spawnTrainingDummy } from './game/props'
import { registerDoorMechanism, registerPistonMechanism } from './game/mechanisms'

async function main(): Promise<void> {
    let engine: Engine
    try {
        engine = new Engine({ fixedHz: 60 })
    } catch (err) {
        if (err instanceof WebGPUUnavailableError) {
            fatalOverlay(err.message)
            return
        }
        throw err
    }

    const { renderer, world } = engine
    const hud = new GameHud()
    const notify = (message: string) => hud.notify(message)

    // Lighting. Sun from south-east, target at the centre of the demo level so
    // the shadow camera covers the whole island.
    renderer.scene.add(new AmbientLight(0xffffff, 0.45))
    const sun = new DirectionalLight(0xfff0d4, 1.2)
    sun.position.set(64, 80, 40)
    sun.target.position.set(24, 0, 24)
    sun.castShadow = true
    sun.shadow.camera.left = -36
    sun.shadow.camera.right = 36
    sun.shadow.camera.top = 36
    sun.shadow.camera.bottom = -36
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 200
    sun.shadow.mapSize.set(1024, 1024)
    renderer.scene.add(sun)
    renderer.scene.add(sun.target)

    // Voxel world + level + chunk renderer.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = generateDemoLevel(chunks)
    const chunkRenderer = new ChunkRenderer(renderer.scene, chunks)
    chunkRenderer.rebuildAll()

    // Player.
    spawnPlayer(world, { spawn: meta.spawn })
    spawnSampleNpc(world, { position: meta.npc, yaw: Math.PI * 0.75 })
    for (let i = 0; i < meta.wanderers.length; i++) {
        spawnWanderingNpc(world, {
            position: meta.wanderers[i]!,
            yaw: Math.PI * (0.1 + i * 0.2),
            radius: 8,
        })
    }
    const pistonTester = spawnWanderingNpc(world, {
        position: meta.pistonTester,
        yaw: Math.PI * 0.5,
        radius: 11,
    })
    seedPistonTesterPath(chunks, world, pistonTester, meta.pistonTester, meta.pistonTesterGoal)
    spawnTrainingDummy(world, { position: meta.dummy, yaw: Math.PI * 0.35 })
    spawnCoinPile(world, { position: meta.coins })
    spawnHealthPotion(world, { position: meta.potion })
    for (const door of meta.doors) registerDoorMechanism(world, door)
    for (const piston of meta.pistons) registerPistonMechanism(world, piston)

    // Centre the camera on the player from the very first frame so we don't
    // see a "fly-in" from the world origin.
    renderer.iso.target.set(meta.spawn.x, meta.spawn.y, meta.spawn.z)
    renderer.iso.syncPosition()

    // Wrap chunk-meshing as a render-step system so it integrates with the engine loop.
    const chunkRenderSystem: System = {
        order: RenderOrder.worldRender,
        update: () => chunkRenderer.update(),
        dispose: () => chunkRenderer.dispose(),
    }

    // Systems declare their own phase order; call order here is no longer the scheduling contract.
    engine
        .addSystem(createVoxelMechanismSystem(chunks, engine.input))
        .addSystem(createPlayerControlSystem(engine.input, renderer.iso))
        .addSystem(createProjectileLaunchSystem(engine.input))
        .addSystem(createArrowHitSystem(chunks, { notify }))
        .addSystem(createAirPushSystem(engine.input, { notify }))
        .addSystem(createInteractionSystem(engine.input, { notify }))
        .addSystem(createMeleeCombatSystem(engine.input, { notify }))
        .addSystem(createPickupSystem({ notify }))
        .addSystem(createFallingStoneSpawnerSystem(meta.stoneSpawners, { maxMovingStones: 14 }))
        .addSystem(createWanderSystem(chunks))
        .addSystem(MoveAlongPathSystem)
        .addSystem(createPhysicsSystem(chunks))
        .addSystem(createRigidBodyPairSystem(chunks))
        .addSystem(createImpactSystem())
        .addSystem(createMovingObjectSystem())
        .addSystem(createDynamicCollisionSystem())
        .addSystem(createRenderSyncSystem(renderer.scene))
        .addSystem(chunkRenderSystem)
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input))
        .addSystem(createCameraControlSystem(renderer.iso, engine.input, {
            keyboardPan: false,
            edgePan: false,
            wheelZoom: true,
        }))
        .addSystem(createCameraFollowSystem(renderer.iso, { smoothing: 8 }))

    try {
        await engine.start()
        hud.setCommandHints([
            { keys: ['WASD', 'Arrows'], label: 'Move' },
            { keys: ['Mouse'], label: 'Aim' },
            { keys: ['Q', 'R'], label: 'Rotate camera' },
            { keys: ['Space'], label: 'Jump' },
            { keys: ['F'], label: 'Attack' },
            { keys: ['B'], label: 'Bow' },
            { keys: ['G'], label: 'Air push' },
            { keys: ['E'], label: 'Interact' },
            { keys: ['Wheel'], label: 'Zoom' },
        ])
    } catch (err) {
        console.error(err)
        hud.fatal(err instanceof Error ? err.message : String(err))
    }
}

void main()

function seedPistonTesterPath(
    chunks: ChunkManager,
    world: Engine['world'],
    eid: number,
    start: { x: number; y: number; z: number },
    goal: { x: number; y: number; z: number },
): void {
    const path = findPath(
        chunks,
        { x: Math.floor(start.x), y: Math.floor(start.y), z: Math.floor(start.z) },
        { x: Math.floor(goal.x), y: Math.floor(goal.y), z: Math.floor(goal.z) },
        { maxNodes: 1024, maxStepUp: 1, maxDrop: 2, surfaceSearchRange: 4 },
    )
    if (!path || path.length < 2) return
    world.pathByEid.set(eid, {
        points: path.slice(1).map((p) => new Vector3(p.x + 0.5, p.y, p.z + 0.5)),
        index: 0,
        speed: 2.2,
    })
    addComponent(world, eid, MoveAlongPath)
}

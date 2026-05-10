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
import { createShieldSystem } from './engine/ecs/systems/shield-system'
import { createPhysicsSystem } from './engine/ecs/systems/physics-system'
import { createDynamicCollisionSystem } from './engine/ecs/systems/dynamic-collision-system'
import { createRigidBodyPairSystem } from './engine/ecs/systems/rigidbody-pair-system'
import { createImpactSystem } from './engine/ecs/systems/impact-system'
import { createDebugOverlaySystem } from './engine/ecs/systems/debug-overlay-system'
import { createRenderMetricsSystem } from './engine/ecs/systems/render-metrics-system'
import { createVoxelMechanismSystem } from './engine/ecs/systems/voxel-mechanism-system'
import { createFallingStoneSpawnerSystem, createMovingObjectSystem } from './engine/ecs/systems/moving-object-system'
import { createProjectileLaunchSystem } from './engine/ecs/systems/projectile-launch-system'
import { createHighJumpSystem } from './engine/ecs/systems/high-jump-system'
import { createArrowHitSystem } from './engine/ecs/systems/arrow-hit-system'
import { createAirPushSystem } from './engine/ecs/systems/air-push-system'
import { MoveAlongPathSystem } from './engine/ecs/systems/move-along-path-system'
import { createInteractionSystem } from './engine/ecs/systems/interaction-system'
import { createMeleeCombatSystem } from './engine/ecs/systems/melee-combat-system'
import { createPickupSystem } from './engine/ecs/systems/pickup-system'
import { createPerceptionSystem } from './engine/ecs/systems/perception-system'
import { createBehaviourSystem } from './engine/ecs/systems/behaviour-system'
import { generateLevel, type LevelId } from './game/level'
import { spawnPlayer } from './game/player'
import { createGameHudSystem } from './game/hud-system'
import { createPlayerLoadoutSystem } from './game/player-loadout-system'
import {
    spawnGuardNpc,
    spawnHostileArcherNpc,
    spawnHostileMeleeNpc,
    spawnHunterNpc,
    spawnRabbitNpc,
    spawnSampleNpc,
    spawnVillagerNpc,
    spawnWanderingNpc,
} from './game/npc'
import { spawnCoinPile, spawnHealthPotion, spawnTrainingDummy } from './game/props'
import { registerDoorMechanism, registerPistonMechanism } from './game/mechanisms'
import { GAME_COMMAND_HINT_ACTIONS, GameAction, createGameActionMap } from './game/actions'
import { activePlayerLoadoutKind } from './engine/ecs/world'

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
    const actions = createGameActionMap(engine.input)
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
    const meta = generateLevel(chunks, selectedLevel())
    sun.target.position.set(meta.size / 2, 0, meta.size / 2)
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
    if (meta.pistonTester && meta.pistonTesterGoal) {
        const pistonTester = spawnWanderingNpc(world, {
            position: meta.pistonTester,
            yaw: Math.PI * 0.5,
            radius: 11,
        })
        seedPistonTesterPath(chunks, world, pistonTester, meta.pistonTester, meta.pistonTesterGoal)
    }
    spawnTrainingDummy(world, { position: meta.dummy, yaw: Math.PI * 0.35 })
    spawnCoinPile(world, { position: meta.coins })
    spawnHealthPotion(world, { position: meta.potion })
    for (let i = 0; i < meta.villagers.length; i++) {
        spawnVillagerNpc(world, {
            position: meta.villagers[i]!,
            yaw: Math.PI * (0.15 + i * 0.17),
            label: `Villager ${i + 1}`,
        })
    }
    for (let i = 0; i < meta.guards.length; i++) {
        spawnGuardNpc(world, {
            position: meta.guards[i]!,
            yaw: Math.PI * (0.5 + i * 0.25),
            label: `Village Guard ${i + 1}`,
        })
    }
    for (let i = 0; i < meta.hunters.length; i++) {
        spawnHunterNpc(world, {
            position: meta.hunters[i]!.home,
            huntingGround: meta.hunters[i]!.huntingGround,
            yaw: Math.PI,
            label: `Hunter ${i + 1}`,
        })
    }
    for (let i = 0; i < meta.rabbits.length; i++) {
        spawnRabbitNpc(world, {
            position: meta.rabbits[i]!,
            yaw: Math.PI * (0.25 + i * 0.35),
            label: `Rabbit ${i + 1}`,
        })
    }
    for (const hostile of meta.hostiles) {
        spawnHostileMeleeNpc(world, hostile)
    }
    for (const archer of meta.archers) {
        spawnHostileArcherNpc(world, archer)
    }
    for (const door of meta.doors) registerDoorMechanism(world, door)
    for (const piston of meta.pistons) registerPistonMechanism(world, piston)

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

    // Systems declare their own phase order; call order here is no longer the scheduling contract.
    engine
        .addSystem(createVoxelMechanismSystem(chunks, actions), 'voxelMechanism')
        .addSystem(createPlayerLoadoutSystem(actions), 'playerLoadout')
        .addSystem(createShieldSystem(actions), 'shield')
        .addSystem(createPlayerControlSystem(engine.input, actions, renderer.iso), 'playerControl')
        .addSystem(createProjectileLaunchSystem(actions, {
            actionId: GameAction.BowShot,
            canUse: (gameWorld) => activePlayerLoadoutKind(gameWorld) === 'bow',
        }), 'projectileLaunch')
        .addSystem(createArrowHitSystem(chunks, { notify }), 'arrowHit')
        .addSystem(createAirPushSystem(actions, {
            actionId: GameAction.AirPush,
            canUse: (gameWorld) => activePlayerLoadoutKind(gameWorld) === 'airPush',
            notify,
        }), 'airPush')
        .addSystem(createHighJumpSystem(actions, {
            actionId: GameAction.HighJump,
            canUse: (gameWorld) => activePlayerLoadoutKind(gameWorld) === 'highJump',
            notify,
        }), 'highJump')
        .addSystem(createInteractionSystem(actions, { notify }), 'interaction')
        .addSystem(createMeleeCombatSystem(actions, {
            actionId: GameAction.AttackPrimary,
            canUse: (gameWorld) => activePlayerLoadoutKind(gameWorld) === 'sword',
            notify,
        }), 'meleeCombat')
        .addSystem(createPickupSystem({ notify }), 'pickup')
        .addSystem(createFallingStoneSpawnerSystem(meta.stoneSpawners, { maxMovingStones: 14 }), 'stoneSpawner')
        .addSystem(createPerceptionSystem(), 'perception')
        .addSystem(createBehaviourSystem(chunks), 'behaviour')
        .addSystem(MoveAlongPathSystem, 'moveAlongPath')
        .addSystem(createPhysicsSystem(chunks), 'physics')
        .addSystem(createRigidBodyPairSystem(chunks), 'rigidBodyPairs')
        .addSystem(createImpactSystem(), 'impact')
        .addSystem(createMovingObjectSystem(), 'movingObjects')
        .addSystem(createDynamicCollisionSystem(chunks), 'dynamicCollision')
        .addSystem(createRenderSyncSystem(renderer.scene), 'renderSync')
        .addSystem(chunkRenderSystem, 'chunkRender')
        .addSystem(createGameHudSystem(hud, actions), 'gameHud')
        .addSystem(createRenderMetricsSystem(renderer), 'renderMetrics')
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input), 'debugOverlay')
        .addSystem(createCameraControlSystem(renderer.iso, engine.input, actions, {
            keyboardPan: false,
            edgePan: false,
            wheelZoom: true,
        }), 'cameraControl')
        .addSystem(createCameraFollowSystem(renderer.iso, { smoothing: 8 }), 'cameraFollow')

    try {
        await engine.start()
        hud.setCommandHints(actions.commandHints(GAME_COMMAND_HINT_ACTIONS))
    } catch (err) {
        console.error(err)
        hud.fatal(err instanceof Error ? err.message : String(err))
    }
}

void main()

function selectedLevel(): LevelId {
    const value = new URLSearchParams(window.location.search).get('map')
    return value === 'village' ? 'village' : 'playground'
}

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

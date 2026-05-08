import { AmbientLight, DirectionalLight, Vector3 } from 'three'
import { addComponent } from 'bitecs'
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
import { createDebugOverlaySystem } from './engine/ecs/systems/debug-overlay-system'
import { createVoxelMechanismSystem } from './engine/ecs/systems/voxel-mechanism-system'
import { createFallingStoneSpawnerSystem, createMovingObjectSystem } from './engine/ecs/systems/moving-object-system'
import { createProjectileLaunchSystem } from './engine/ecs/systems/projectile-launch-system'
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

function showFatal(message: string): void {
    const div = document.createElement('div')
    div.style.cssText = [
        'position:fixed',
        'inset:0',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'padding:24px',
        'background:#101418',
        'color:#ff8a8a',
        'font:14px/1.5 ui-sans-serif,system-ui,sans-serif',
        'text-align:center',
    ].join(';')
    div.textContent = message
    document.body.appendChild(div)
}

function showHint(message: string): void {
    const div = document.createElement('div')
    div.style.cssText = [
        'position:fixed',
        'bottom:12px',
        'left:50%',
        'transform:translateX(-50%)',
        'padding:8px 14px',
        'background:rgba(16,20,24,0.85)',
        'color:#cfe7ff',
        'font:13px/1.3 ui-sans-serif,system-ui,sans-serif',
        'border:1px solid #2a3340',
        'border-radius:6px',
        'pointer-events:none',
        'z-index:1000',
    ].join(';')
    div.textContent = message
    document.body.appendChild(div)
}

function createNotifier(): (message: string) => void {
    const div = document.createElement('div')
    div.style.cssText = [
        'position:fixed',
        'top:14px',
        'left:50%',
        'transform:translateX(-50%)',
        'min-width:220px',
        'max-width:min(520px,calc(100vw - 32px))',
        'padding:10px 14px',
        'background:rgba(16,20,24,0.9)',
        'color:#f4e9c7',
        'font:13px/1.35 ui-sans-serif,system-ui,sans-serif',
        'border:1px solid #544832',
        'border-radius:6px',
        'box-shadow:0 10px 28px rgba(0,0,0,0.25)',
        'pointer-events:none',
        'z-index:1001',
        'opacity:0',
        'transition:opacity 120ms ease',
        'text-align:center',
    ].join(';')
    document.body.appendChild(div)

    let timeout = 0
    return (message: string) => {
        div.textContent = message
        div.style.opacity = '1'
        window.clearTimeout(timeout)
        timeout = window.setTimeout(() => {
            div.style.opacity = '0'
        }, 2200)
    }
}

async function main(): Promise<void> {
    let engine: Engine
    try {
        engine = new Engine({ fixedHz: 60 })
    } catch (err) {
        if (err instanceof WebGPUUnavailableError) {
            showFatal(err.message)
            return
        }
        throw err
    }

    const { renderer, world } = engine
    const notify = createNotifier()

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
        .addSystem(createInteractionSystem(engine.input, { notify }))
        .addSystem(createMeleeCombatSystem(engine.input, { notify }))
        .addSystem(createPickupSystem({ notify }))
        .addSystem(createFallingStoneSpawnerSystem(meta.stoneSpawners))
        .addSystem(createWanderSystem(chunks))
        .addSystem(MoveAlongPathSystem)
        .addSystem(createPhysicsSystem(chunks))
        .addSystem(createMovingObjectSystem(chunks))
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
        showHint('WASD / arrows move · Q/R rotate · B shoot arrow · space jump · E interact · F attack · scroll zoom')
    } catch (err) {
        console.error(err)
        showFatal(err instanceof Error ? err.message : String(err))
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

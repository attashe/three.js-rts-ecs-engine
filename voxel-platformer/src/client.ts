import { AmbientLight, DirectionalLight } from 'three'
import { query } from 'bitecs'
import { Engine } from './engine/engine'
import { ChunkManager, ChunkRenderer, DEFAULT_PALETTE, createBlockLightSystem } from './engine/voxel'
import type { System } from './engine/ecs/systems/system'
import { FixedOrder, RenderOrder } from './engine/ecs/systems/orders'
import { createRenderSyncSystem } from './engine/ecs/systems/render-sync-system'
import { createCameraControlSystem } from './engine/ecs/systems/camera-control-system'
import { createCameraFollowSystem } from './engine/ecs/systems/camera-follow-system'
import { createPlayerControlSystem } from './engine/ecs/systems/player-control-system'
import { createPhysicsSystem } from './engine/ecs/systems/physics-system'
import { MovingObjectKind } from './game/moving-objects'
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
import { createPickupSystem, PickupKind } from './engine/ecs/systems/pickup-system'
import { createPistonSystem } from './engine/ecs/systems/piston-system'
import { createZoneTriggerSystem } from './engine/ecs/systems/zone-trigger-system'
import { createPlayerDeathSystem } from './engine/ecs/systems/player-death-system'
import { createRestartSystem } from './engine/ecs/systems/restart-system'
import { createAudioUnlockSystem } from './engine/ecs/systems/audio-unlock-system'
import { createPlayerAudioListenerSystem } from './engine/ecs/systems/audio-listener-system'
import { AudioEngine, type SoundHandle } from './engine/audio'
import { Pickup as PickupComponent, PickupValue, Position } from './engine/ecs/components'
import { despawnEntity } from './engine/ecs/entity'
import { DEMO_LEVEL_ID } from './game/procedural-level-ids'
import { getProceduralLevelDefinition, type ProceduralScriptSources } from './game/procedural-levels'
import { spawnPlayer } from './game/player'
import { createPlayerTorchSystem } from './game/player-torch-system'
import { createIndoorCutSystem } from './game/indoor-cut-system'
import { createSunFollowSystem } from './engine/render/sun-follow-system'
import { castShadowOnPlayer, enablePlayerVisibility } from './engine/render/render-layers'
import { disposeObject3D } from './engine/render/dispose-object'
import { createTorchBlockRenderSystem } from './game/torch-block-system'
import { createTorchBlockRenderSystemV2 } from './game/torch-block-system-v2'
import { getTorchSystem } from './engine/render/render-settings'
import { spawnCoinPile } from './game/pickups'
import { spawnLevelStone } from './game/stones'
import { registerPistonMechanism } from './game/mechanisms'
import { createSoundSourceSystem, createSoundZoneSystem, startEnvironment } from './game/sound-sources'
import { createPlayerLocomotionAudioSystem } from './game/player-audio'
import { createEnvironmentFxSystem, createVisualFxZoneSystem } from './game/weather'
import { createPropRenderSystem } from './game/props/prop-system'
import { createNpcRenderSystem } from './game/npcs/npc-render-system'
import { registerRuntimeNpcs, type RegisteredNpcRuntime } from './game/npcs/npc-runtime'
import { createGameScriptSystem } from './game/script-system'
import { createInteractionSystem } from './game/interaction-system'
import { createDialogueController } from './game/dialogue-system'
import { checkpointStorageKey, createSessionCheckpointStore, resolveSpawn, type CheckpointStore } from './game/checkpoint-store'
import { defineZone, type Zone } from './engine/ecs/zones'
import { createGameActionMap, GameAction } from './game/actions'
import { createGameMenuSystem } from './game/game-menu-system'
import { GAME_AUDIO_MANIFEST, GameAudio } from './game/audio'
import { copyPlayerSettings, type PlayerSettings } from './game/player-settings'
import { deserializeLevel, serializeLevel } from './engine/voxel/level-serializer'
import { consumePlaytestLevel } from './editor/playtest'
import { createProceduralEditorLevel } from './editor/procedural-level-export'
import { levelMetaFromEditor } from './game/level-from-meta'
import { loadLevelBufferById, normalizeLevelId } from './game/level-library'
import type { EditorLevelMeta } from './editor/editor-state'
import { levelMetaWithSpawn, type LevelMeta } from './game/level'
import { pushLog, type GameWorld } from './engine/ecs/world'
import type { ScriptEngineSystem } from './engine/script/script-engine-system'
import type { FlagValue, ScriptEntry, TravelFacade } from './engine/script/types'
import demoQuestSource from '../examples/scripts/demo-quest.js?raw'
import lanternTrialSource from '../examples/scripts/lantern-trial.js?raw'
import hasteShrineSource from '../examples/scripts/haste-shrine.js?raw'
import paidPortalShrineSource from '../examples/scripts/paid-portal-shrine.js?raw'

const BROWSER_PROCEDURAL_SCRIPT_SOURCES: ProceduralScriptSources = {
    'examples/scripts/demo-quest.js': demoQuestSource,
    'examples/scripts/lantern-trial.js': lanternTrialSource,
    'examples/scripts/haste-shrine.js': hasteShrineSource,
    'examples/scripts/paid-portal-shrine.js': paidPortalShrineSource,
}

interface LoadedLocation {
    id: string
    meta: LevelMeta
    chunks: ChunkManager
    editorMeta?: EditorLevelMeta
    sourceBuffer?: ArrayBuffer
    restoredFlags?: Map<string, FlagValue>
}

interface ActiveLocation {
    id: string
    meta: LevelMeta
    editorMeta?: EditorLevelMeta
    sourceBuffer?: ArrayBuffer
    entrySnapshot: LocationSnapshot
    entrySpawn: { x: number; y: number; z: number }
    checkpointStore: CheckpointStore
    entryPlayerSettings: PlayerSettings
    levelScripts: readonly ScriptEntry[]
    npcRuntime: RegisteredNpcRuntime | null
    scriptEngine: ScriptEngineSystem | null
    environmentHandle: SoundHandle | null
}

interface LocationSnapshot {
    buffer: ArrayBuffer
    flags: Map<string, FlagValue>
}

interface SystemSlot {
    readonly system: System
    set(next: System | null): void
}

async function main(): Promise<void> {
    const engine = new Engine({ fixedHz: 60 })
    const { renderer, world } = engine
    const actions = createGameActionMap(engine.input)
    const dialogue = createDialogueController({ input: engine.input })
    const audio = new AudioEngine()
    const audioReady = audio.loadManifest(GAME_AUDIO_MANIFEST)
    void audioReady.catch((err) => console.warn('Game audio failed to load:', err))

    const defaultAmbient = new AmbientLight(0xffffff, 0.45)
    enablePlayerVisibility(defaultAmbient)
    renderer.scene.add(defaultAmbient)
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
    castShadowOnPlayer(sun)
    renderer.scene.add(sun)
    renderer.scene.add(sun.target)

    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const titleOverlay = mountLocationTitle()
    const snapshots = new Map<string, LocationSnapshot>()
    let active: ActiveLocation | null = null
    let locationVersion = 0
    let travelInFlight = false

    const slots = {
        soundSources: createSystemSlot('soundSources', false, 0),
        soundZones: createSystemSlot('soundZones', false, RenderOrder.cameraFollow + 2),
        environmentFx: createSystemSlot('environmentFx', false, RenderOrder.cameraFollow + 2),
        visualFxZones: createSystemSlot('visualFxZones', false, RenderOrder.cameraFollow + 3),
        propRender: createSystemSlot('propRender', false, RenderOrder.worldRender + 3),
        npcRender: createSystemSlot('npcRender', false, RenderOrder.worldRender + 1),
        piston: createSystemSlot('piston', true, FixedOrder.mechanisms),
        zoneTrigger: createSystemSlot('zoneTrigger', true, FixedOrder.postPhysics - 20),
        scriptEngine: createSystemSlot('scriptEngine', true, FixedOrder.postPhysics + 5),
        stoneSpawner: createSystemSlot('stoneSpawner', true, FixedOrder.input + 10),
        blockLights: createSystemSlot('blockLights', false, RenderOrder.blockLights),
        chunkRender: createSystemSlot('chunkRender', false, RenderOrder.worldRender),
        indoorCut: createSystemSlot('indoorCut', false, RenderOrder.worldRender - 1),
        torchBlocks: createSystemSlot('torchBlocks', false, RenderOrder.worldRender + 2),
    }
    const allSlots = Object.values(slots)

    const travelFacade: TravelFacade = {
        to(levelId, opts) {
            void travelTo(levelId, { arrivalId: opts?.arrivalId })
        },
        reload(opts) {
            void restartCurrent({
                arrivalId: opts?.arrivalId,
                useCheckpoint: !opts?.arrivalId,
            })
        },
    }

    async function travelTo(levelId: string, opts: { arrivalId?: string } = {}): Promise<void> {
        if (travelInFlight) return
        const targetId = normalizeLevelId(levelId)
        if (!targetId) return
        travelInFlight = true
        const carried = currentPlayerSettings(world)
        try {
            const loaded = await loadProjectLocation(targetId, snapshots)
            activateLocation(loaded, {
                arrivalId: opts.arrivalId,
                playerSettings: carried,
                saveCurrent: true,
                useCheckpoint: false,
            })
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.error('Travel failed:', err)
            pushLog(world, `Travel failed: ${msg}`)
        } finally {
            travelInFlight = false
        }
    }

    async function restartCurrent(opts: { arrivalId?: string; useCheckpoint?: boolean } = {}): Promise<void> {
        const current = active
        if (!current || travelInFlight) return
        travelInFlight = true
        try {
            const loaded = loadLocationForRestart(current)
            activateLocation(loaded, {
                arrivalId: opts.arrivalId,
                entrySpawn: opts.arrivalId ? undefined : current.entrySpawn,
                playerSettings: current.entryPlayerSettings,
                saveCurrent: false,
                useCheckpoint: opts.useCheckpoint ?? !opts.arrivalId,
            })
        } finally {
            travelInFlight = false
        }
    }

    function activateLocation(
        loaded: LoadedLocation,
        opts: {
            arrivalId?: string
            entrySpawn?: { x: number; y: number; z: number }
            playerSettings: PlayerSettings
            saveCurrent: boolean
            useCheckpoint: boolean
        },
    ): void {
        if (opts.saveCurrent) captureCurrentSnapshot()
        cleanupActiveLocation()
        clearRuntimeWorld(world)
        replaceChunks(chunks, loaded.chunks)

        const version = ++locationVersion
        const entrySpawn = opts.entrySpawn ?? resolveArrival(loaded.meta, opts.arrivalId) ?? loaded.meta.spawn
        const meta = levelMetaWithSpawn(loaded.meta, entrySpawn)
        const checkpointStore = createSessionCheckpointStore(checkpointStorageKey(loaded.id))
        const effectiveSpawn = opts.useCheckpoint ? resolveSpawn(entrySpawn, checkpointStore) : entrySpawn
        if (opts.useCheckpoint) {
            world.lastCheckpoint = checkpointStore.get()
        } else {
            checkpointStore.clear()
            world.lastCheckpoint = null
        }
        world.playerSettings = copyPlayerSettings(opts.playerSettings)
        world.inventory.gold = world.playerSettings.inventory.gold
        world.inventory.arrows = world.playerSettings.inventory.arrows

        spawnPlayer(world, { spawn: effectiveSpawn, settings: world.playerSettings })
        for (const stone of meta.stones) spawnLevelStone(world, stone)
        for (const coin of meta.coinPiles) spawnCoinPile(world, coin)
        for (const piston of meta.pistons) registerPistonMechanism(world, chunks, piston)
        for (const zone of meta.zones) defineZone(world, zone)
        const npcRuntime = registerRuntimeNpcs(world, meta.npcs)
        const levelScripts = [...meta.scripts, ...npcRuntime.scripts]

        const nextActive: ActiveLocation = {
            id: loaded.id,
            meta,
            editorMeta: loaded.editorMeta,
            sourceBuffer: loaded.sourceBuffer,
            entrySnapshot: entrySnapshotFromLoaded(loaded),
            entrySpawn: { ...entrySpawn },
            checkpointStore,
            entryPlayerSettings: copyPlayerSettings(opts.playerSettings),
            levelScripts,
            npcRuntime,
            scriptEngine: null,
            environmentHandle: null,
        }
        active = nextActive

        defaultAmbient.visible = !meta.ambientWeather
        sun.visible = !meta.ambientWeather
        sun.target.position.set(meta.size / 2, 0, meta.size / 2)
        renderer.iso.target.set(effectiveSpawn.x, effectiveSpawn.y, effectiveSpawn.z)
        renderer.iso.syncPosition()

        installLocationSystems(nextActive, loaded.restoredFlags)
        void audioReady.then(() => {
            if (version !== locationVersion || active !== nextActive) return
            nextActive.environmentHandle = startEnvironment(audio, meta.environment, GAME_AUDIO_MANIFEST)
        })
        titleOverlay.show(meta.name)
    }

    function installLocationSystems(location: ActiveLocation, initialFlags?: ReadonlyMap<string, FlagValue>): void {
        const meta = location.meta
        // Mesh streaming: keep only chunks near the camera target (which
        // follows the player) meshed, and spread (re)meshing across frames so
        // large locations never stall on load or on a cut change. Voxel data
        // stays fully resident — this bounds meshing + draw cost, not memory.
        const chunkRenderer = new ChunkRenderer(renderer.scene, chunks, {
            streaming: {
                focus: () => renderer.iso.target,
                radiusChunks: 6,
                budgetPerFrame: 6,
            },
        })
        chunkRenderer.rebuildAll()
        const environmentFx = createEnvironmentFxSystem(
            renderer.scene,
            meta.ambientWeather,
            () => renderer.iso.camera,
            () => renderer.iso.target,
        )
        const visualFxZones = createVisualFxZoneSystem(renderer.scene, audio, meta.weatherZones, () => renderer.iso.camera, {
            audioReady,
            // Pre-compile WebGPU pipelines for every authored zone — script-toggled
            // zones (e.g. the demo's portal-magic FX) would otherwise stall the main
            // thread on first activation while shaders compile.
            warmupShaders: (scene, camera) => renderer.webgpu.compileAsync(scene, camera),
        })
        const stoneSpawnerSystem = createFallingStoneSpawnerSystem(meta.stoneSpawners, { maxMovingStones: 12 })
        slots.stoneSpawner.set(stoneSpawnerSystem)

        const scriptEngine = createGameScriptSystem({
            world,
            chunks,
            audio,
            audioManifest: GAME_AUDIO_MANIFEST,
            weatherSystem: environmentFx.weatherSystem,
            visualFxZones: visualFxZones.controller,
            dialogue: dialogue.facade,
            travel: travelFacade,
            level: meta,
            checkpointStore: location.checkpointStore,
            initialFlags,
            getScripts: () => location.levelScripts,
        })
        location.scriptEngine = scriptEngine

        slots.soundSources.set(createSoundSourceSystem(audio, meta.soundSources, { audioReady }))
        slots.soundZones.set(createSoundZoneSystem(audio, meta.soundZones, { audioReady }))
        slots.environmentFx.set(environmentFx)
        slots.visualFxZones.set(visualFxZones)
        slots.propRender.set(createPropRenderSystem(renderer.scene, { getProps: () => meta.props }))
        slots.npcRender.set(createNpcRenderSystem(renderer.scene, { getNpcs: () => meta.npcs }))
        slots.piston.set(createPistonSystem(chunks, {
            onFlip: (piston, position) => {
                if (!piston.moveSoundId) return
                try {
                    audio.playSpatial(piston.moveSoundId, position, {
                        deferUntilUnlocked: true,
                        volume: piston.moveSoundVolume ?? 1,
                        refDistance: 2,
                        maxDistance: 24,
                        rolloffModel: 'inverse',
                    })
                } catch (err) {
                    console.warn(`Piston move sound "${piston.moveSoundId}" failed:`, err)
                }
            },
        }))
        slots.zoneTrigger.set(createZoneTriggerSystem({
            onTrigger: (event, zone) => {
                if (event.source !== 'player') return
                if (!zone.portal?.targetLevelId) return
                void travelTo(zone.portal.targetLevelId, { arrivalId: zone.portal.targetArrivalId })
            },
        }))
        slots.scriptEngine.set(scriptEngine)
        slots.blockLights.set(createBlockLightSystem(chunks, {
            scene: renderer.scene,
            camera: () => renderer.iso.camera,
        }))
        slots.chunkRender.set({
            name: 'chunkRender',
            order: RenderOrder.worldRender,
            update: () => chunkRenderer.update(),
            dispose: () => chunkRenderer.dispose(),
        })
        slots.indoorCut.set(createIndoorCutSystem(chunks, {
            setCutY: (y) => chunkRenderer.setCutY(y),
        }))
        slots.torchBlocks.set(
            getTorchSystem() === 'experimental'
                ? createTorchBlockRenderSystemV2(renderer.scene, chunks, {
                    focus: () => renderer.iso.target,
                    audio,
                    audioReady,
                    soundId: GameAudio.TorchFire,
                })
                : createTorchBlockRenderSystem(renderer.scene, chunks, {
                    focus: () => renderer.iso.target,
                    audio,
                    audioReady,
                    soundId: GameAudio.TorchFire,
                }),
        )
    }

    function captureCurrentSnapshot(): void {
        if (!active?.editorMeta) return
        active.editorMeta.pickups = captureLiveEditorPickups(world)
        snapshots.set(active.id, {
            buffer: serializeLevel(chunks, active.editorMeta),
            flags: new Map(active.scriptEngine?.flags ?? []),
        })
    }

    function cleanupActiveLocation(): void {
        if (active?.scriptEngine) active.scriptEngine.runtime.emit('level.reset')
        active?.environmentHandle?.stop(0.25)
        active?.npcRuntime?.dispose()
        audio.stopMusic(0.35)
        for (const slot of allSlots) slot.set(null)
        if (active) {
            active.scriptEngine = null
            active.environmentHandle = null
            active.npcRuntime = null
        }
    }

    const initial = await loadInitialLocation()
    activateLocation(initial, {
        playerSettings: copyPlayerSettings(initial.meta.player),
        saveCurrent: false,
        useCheckpoint: true,
    })

    engine
        .addSystem(createSunFollowSystem(sun, () => renderer.iso.target), 'sunFollow')
        .addSystem(createAudioUnlockSystem(audio), 'audioUnlock')
        .addSystem(slots.soundSources.system, 'soundSources')
        .addSystem(slots.soundZones.system, 'soundZones')
        .addSystem(slots.environmentFx.system, 'environmentFx')
        .addSystem(slots.visualFxZones.system, 'visualFxZones')
        .addSystem(slots.propRender.system, 'propRender')
        .addSystem(slots.npcRender.system, 'npcRender')
        .addSystem(createPlayerControlSystem(engine.input, actions, renderer.iso, {
            chunks,
            onJump: () => audio.play(GameAudio.Jump, {
                deferUntilUnlocked: true,
                rate: 0.97 + Math.random() * 0.06,
            }),
        }), 'playerControl')
        .addSystem(createPlayerTorchSystem(), 'playerTorch')
        .addSystem(createProjectileLaunchSystem(actions, {
            actionId: GameAction.BowShot,
            onLaunch: () => audio.play(GameAudio.Bow, { deferUntilUnlocked: true }),
        }), 'projectileLaunch')
        .addSystem(createArrowHitSystem(chunks, {
            onArrowLand: () => audio.play(GameAudio.ArrowHit, { deferUntilUnlocked: true }),
        }), 'arrowHit')
        .addSystem(createHighJumpSystem(actions, {
            actionId: GameAction.HighJump,
            chunks,
            onHighJump: () => audio.play(GameAudio.HighJump, { deferUntilUnlocked: true }),
        }), 'highJump')
        .addSystem(createAirPushSystem(actions, { actionId: GameAction.AirPush }), 'airPush')
        .addSystem(createPickupSystem({
            onCollected: (kind) => audio.play(
                kind === PickupKind.Arrow
                    ? GameAudio.PickupArrow
                    : kind === PickupKind.ScriptItem
                        ? GameAudio.QuestChime
                        : GameAudio.PickupGold,
                { deferUntilUnlocked: true },
            ),
        }), 'pickup')
        .addSystem(slots.piston.system, 'piston')
        .addSystem(slots.zoneTrigger.system, 'zoneTrigger')
        .addSystem(slots.scriptEngine.system, 'scriptEngine')
        .addSystem(slots.stoneSpawner.system, 'stoneSpawner')
        .addSystem(createPhysicsSystem(chunks, {
            impactMinSpeed: 4.0,
            onImpact: (event) => {
                if (event.movingObjectKind !== MovingObjectKind.Stone) return
                const speedFactor = Math.min(1, event.speed / 18)
                audio.playSpatial(GameAudio.StoneImpact, { x: event.x, y: event.y, z: event.z }, {
                    deferUntilUnlocked: true,
                    volume: 0.42 + speedFactor * 0.42,
                    rate: 0.92 + Math.random() * 0.14,
                    refDistance: 2,
                    maxDistance: 32,
                    rolloffModel: 'linear',
                    panningModel: 'equalpower',
                    priority: 2,
                })
            },
        }), 'physics')
        .addSystem(createPlayerLocomotionAudioSystem(audio, { chunks }), 'playerLocomotionAudio')
        .addSystem(createRigidBodyPairSystem(chunks), 'rigidBodyPairs')
        .addSystem(createImpactSystem(), 'impact')
        .addSystem(createMovingObjectSystem(), 'movingObjects')
        .addSystem(createDynamicCollisionSystem(chunks), 'dynamicCollision')
        .addSystem(createPlayerDeathSystem({
            chunks,
            onDeath: () => {
                audio.play(GameAudio.Death, { deferUntilUnlocked: true })
                audio.playStinger(GameAudio.DeathStinger, { deferUntilUnlocked: true })
            },
        }), 'playerDeath')
        .addSystem(createRenderSyncSystem(renderer.scene), 'renderSync')
        .addSystem(slots.blockLights.system, 'blockLights')
        .addSystem(slots.chunkRender.system, 'chunkRender')
        .addSystem(slots.indoorCut.system, 'indoorCut')
        .addSystem(slots.torchBlocks.system, 'torchBlocks')
        .addSystem(createRenderMetricsSystem(renderer), 'renderMetrics')
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input, {
            logPosition: { top: '48px', right: '8px', maxWidth: '320px' },
            cameraProvider: () => renderer.iso.camera,
            renderElement: renderer.webgpu.domElement,
        }), 'debugOverlay')
        .addSystem(createGameMenuSystem(engine.input, actions, audio, {
            renderElement: renderer.webgpu.domElement,
            exitHref: './editor.html',
        }), 'gameMenu')
        .addSystem(dialogue.system, 'dialogue')
        .addSystem(createInteractionSystem({
            actions,
            camera: () => renderer.iso.camera,
            domElement: renderer.webgpu.domElement,
        }), 'interaction')
        .addSystem(createRestartSystem({
            onRestart: (reason) => restartCurrent({ useCheckpoint: reason !== 'manual-restart' }),
        }), 'restart')
        .addSystem(createCameraControlSystem(renderer.iso, engine.input, actions, {
            keyboardPan: false,
            edgePan: false,
            wheelZoom: true,
        }), 'cameraControl')
        .addSystem(createCameraFollowSystem(renderer.iso, { smoothing: 8 }), 'cameraFollow')
        .addSystem(createPlayerAudioListenerSystem(audio, () => renderer.iso.camera), 'audioListener')

    mountRestartButton(world)
    if (isPlaytestMode()) mountBackToEditorButton()

    await engine.start()
}

function createSystemSlot(name: string, fixed: boolean, order: number): SystemSlot {
    let current: System | null = null
    let activeWorld: GameWorld | null = null
    const system: System = {
        name,
        fixed,
        order,
        init(world) {
            activeWorld = world
            current?.init?.(world)
        },
        update(world, dt) {
            current?.update(world, dt)
        },
        dispose() {
            current?.dispose?.()
            current = null
            activeWorld = null
        },
    }
    return {
        system,
        set(next) {
            current?.dispose?.()
            current = next
            if (current && activeWorld) current.init?.(activeWorld)
        },
    }
}

function clearRuntimeWorld(world: GameWorld): void {
    const entities = [...query(world, [Position])]
    for (const eid of entities) despawnEntity(world, eid)
    for (const obj of world.object3DByEid.values()) {
        obj.removeFromParent()
        disposeObject3D(obj)
    }
    world.object3DByEid.clear()
    world.obstacles.clear()
    world.pickupMetaByEid.clear()
    world.pickupEntityByScriptId.clear()
    world.stoneEntityByScriptId.clear()
    world.stoneSpawnersById.clear()
    world.pistons.length = 0
    world.pistonsById.clear()
    world.zones.clear()
    world.zoneEvents.length = 0
    world.popupMessages.length = 0
    world.nextPopupMessageId = 1
    world.popupClears.length = 0
    world.nextPopupClearId = 1
    world.scriptTriggerEvents.length = 0
    world.deathSignal = null
    world.lastCheckpoint = null
}

function replaceChunks(target: ChunkManager, source: ChunkManager): void {
    target.clear()
    target.replacePalette(source.palette)
    copyChunks(source, target)
}

function copyChunks(src: ChunkManager, dst: ChunkManager): void {
    for (const chunk of [...src.allChunks()]) {
        for (let z = 0; z < 32; z++) {
            for (let y = 0; y < 32; y++) {
                for (let x = 0; x < 32; x++) {
                    const v = chunk.getLocal(x, y, z)
                    if (v !== 0) {
                        dst.setVoxel(chunk.cx * 32 + x, chunk.cy * 32 + y, chunk.cz * 32 + z, v)
                    }
                }
            }
        }
    }
}

function currentPlayerSettings(world: GameWorld): PlayerSettings {
    const settings = copyPlayerSettings(world.playerSettings)
    settings.inventory.gold = world.inventory.gold
    settings.inventory.arrows = world.inventory.arrows
    return settings
}

function captureLiveEditorPickups(world: GameWorld): EditorLevelMeta['pickups'] {
    const out: EditorLevelMeta['pickups'] = []
    const pickups = query(world, [PickupComponent, PickupValue, Position])
    for (let i = 0; i < pickups.length; i++) {
        const eid = pickups[i]!
        if (world.pickupMetaByEid.has(eid)) continue
        if (PickupValue.kind[eid] !== PickupKind.Gold) continue
        out.push({
            kind: PickupValue.kind[eid],
            amount: PickupValue.amount[eid],
            position: {
                x: Position.x[eid],
                y: Position.y[eid],
                z: Position.z[eid],
            },
        })
    }
    return out
}

function resolveArrival(meta: LevelMeta, arrivalId: string | undefined): { x: number; y: number; z: number } | null {
    const id = arrivalId?.trim()
    if (!id) return null
    const zone = meta.zones.find((z) => z.id === id)
    if (!zone) return null
    return zoneSpawnPoint(zone)
}

function zoneSpawnPoint(zone: Zone): { x: number; y: number; z: number } {
    return {
        x: (zone.min.x + zone.max.x) * 0.5,
        y: zone.min.y,
        z: (zone.min.z + zone.max.z) * 0.5,
    }
}

async function loadInitialLocation(): Promise<LoadedLocation> {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('level')
    if (requested === 'playtest') {
        const buffer = consumePlaytestLevel()
        if (buffer) {
            try {
                return loadedEditorLocationFromBuffer('playtest', buffer)
            } catch (err) {
                console.error('Playtest level failed to load — falling back to demo:', err)
            }
        }
    } else if (requested) {
        try {
            return await loadProjectLocation(requested, new Map())
        } catch (err) {
            console.error(`Project level "${requested}" failed to load — falling back to demo:`, err)
        }
    }
    return loadBuiltinDemoLocation()
}

async function loadProjectLocation(
    id: string,
    snapshots: ReadonlyMap<string, LocationSnapshot>,
): Promise<LoadedLocation> {
    const normalized = normalizeLevelId(id)
    const snapshot = snapshots.get(normalized)
    if (snapshot) {
        return {
            ...loadedEditorLocationFromBuffer(normalized, snapshot.buffer),
            restoredFlags: new Map(snapshot.flags),
        }
    }
    // Canonical procedural levels must come from source during game travel.
    // The exported .vplevel copies are for the editor/library path and can be
    // stale while a dev server stays open across procedural-level edits.
    const procedural = loadProceduralLocation(normalized)
    if (procedural) return procedural
    try {
        return loadedEditorLocationFromBuffer(normalized, await loadLevelBufferById(normalized))
    } catch (err) {
        if (normalized === DEMO_LEVEL_ID) {
            console.warn('Disk-backed demo level failed to load — using procedural fallback:', err)
            return loadBuiltinDemoLocation()
        }
        throw err
    }
}

function loadLocationForRestart(active: ActiveLocation): LoadedLocation {
    return {
        ...loadedEditorLocationFromBuffer(active.id, active.entrySnapshot.buffer),
        restoredFlags: new Map(active.entrySnapshot.flags),
    }
}

function entrySnapshotFromLoaded(loaded: LoadedLocation): LocationSnapshot {
    if (loaded.sourceBuffer) {
        return {
            buffer: loaded.sourceBuffer.slice(0),
            flags: new Map(loaded.restoredFlags ?? []),
        }
    }
    if (loaded.editorMeta) {
        return {
            buffer: serializeLevel(loaded.chunks, loaded.editorMeta),
            flags: new Map(loaded.restoredFlags ?? []),
        }
    }
    throw new Error(`Location "${loaded.id}" has no serializable restart baseline`)
}

function loadedEditorLocationFromBuffer(id: string, buffer: ArrayBuffer): LoadedLocation {
    const loaded = deserializeLevel<EditorLevelMeta>(buffer)
    const size = Math.max(24, Math.ceil(Math.max(
        loaded.metadata.spawn.x,
        loaded.metadata.spawn.z,
    )) * 2)
    const locationId = normalizeLevelId(id === 'playtest' ? loaded.metadata.name || id : id)
    return {
        id: locationId,
        meta: levelMetaFromEditor(loaded.metadata, size),
        editorMeta: loaded.metadata,
        sourceBuffer: buffer.slice(0),
        chunks: loaded.chunks,
    }
}

function loadProceduralLocation(id: string): LoadedLocation | null {
    const normalized = normalizeLevelId(id)
    const definition = getProceduralLevelDefinition(normalized)
    if (!definition) return null
    const level = createProceduralEditorLevel(definition.id, BROWSER_PROCEDURAL_SCRIPT_SOURCES)
    return {
        id: level.id,
        meta: level.runtimeMeta,
        editorMeta: level.editorMeta,
        sourceBuffer: level.buffer.slice(0),
        chunks: level.chunks,
    }
}

function loadBuiltinDemoLocation(): LoadedLocation {
    const loaded = loadProceduralLocation(DEMO_LEVEL_ID)
    if (!loaded) throw new Error('Built-in demo level is not registered')
    return loaded
}

function mountLocationTitle(): { show(name: string): void } {
    const el = document.createElement('div')
    el.style.cssText = [
        'position: fixed',
        'top: 48px',
        'left: 50%',
        'transform: translateX(-50%)',
        'z-index: 1100',
        'padding: 8px 14px',
        'border-radius: 4px',
        'background: rgba(8, 12, 16, 0.72)',
        'color: #d9f7ff',
        'font: 600 13px ui-sans-serif, system-ui, sans-serif',
        'letter-spacing: 0.04em',
        'text-transform: uppercase',
        'opacity: 0',
        'transition: opacity 240ms ease',
        'pointer-events: none',
        'border: 1px solid rgba(217, 247, 255, 0.18)',
        'box-shadow: 0 6px 24px rgba(0,0,0,0.28)',
    ].join('; ')
    document.body.appendChild(el)
    let timer = 0
    return {
        show(name) {
            window.clearTimeout(timer)
            el.textContent = name || 'Untitled'
            el.style.opacity = '1'
            timer = window.setTimeout(() => { el.style.opacity = '0' }, 2200)
        },
    }
}

function isPlaytestMode(): boolean {
    return new URLSearchParams(window.location.search).get('level') === 'playtest'
}

function mountRestartButton(world: GameWorld): void {
    const btn = document.createElement('button')
    btn.textContent = '↻ Restart'
    btn.onclick = () => { world.deathSignal ??= 'manual-restart' }
    const offset = isPlaytestMode() ? 'right: 82px' : 'right: 8px'
    btn.style.cssText = [
        'position: fixed', 'top: 8px', offset,
        'z-index: 1000',
        'padding: 6px 10px',
        'border-radius: 4px',
        'background: rgba(8, 12, 16, 0.78)',
        'color: #d9f7ff',
        'font: 12px ui-sans-serif, system-ui, sans-serif',
        'border: 1px solid rgba(217, 247, 255, 0.25)',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.35)',
        'cursor: pointer',
    ].join('; ')
    document.body.appendChild(btn)
}

function mountBackToEditorButton(): void {
    const btn = document.createElement('a')
    btn.href = './editor.html'
    btn.textContent = '← Editor'
    btn.style.cssText = [
        'position: fixed', 'top: 8px', 'right: 8px',
        'z-index: 1000',
        'padding: 6px 10px',
        'border-radius: 4px',
        'background: rgba(8, 12, 16, 0.78)',
        'color: #d9f7ff', 'text-decoration: none',
        'font: 12px ui-sans-serif, system-ui, sans-serif',
        'border: 1px solid rgba(217, 247, 255, 0.25)',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.35)',
    ].join('; ')
    document.body.appendChild(btn)
}

void main()

import { AmbientLight, DirectionalLight } from 'three'
import { query } from 'bitecs'
import { Engine } from './engine/engine'
import { ChunkManager, ChunkRenderer, DEFAULT_PALETTE, createBlockLightSystem } from './engine/voxel'
import type { System } from './engine/ecs/systems/system'
import { FixedOrder, RenderOrder } from './engine/ecs/systems/orders'
import { createRenderSyncSystem } from './engine/ecs/systems/render-sync-system'
import { createAnimationSystem } from './engine/ecs/systems/animation-system'
import { preloadCharacterModels } from './game/anim/model-registry'
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
import { createMeleeAttackSystem } from './engine/ecs/systems/melee-attack-system'
import { createMeleeCombatSystem } from './engine/ecs/systems/melee-combat-system'
import { createPlayerHurtAudioSystem } from './engine/ecs/systems/player-hurt-audio-system'
import { CinematicDirector } from './game/cinematics/cinematic-director'
import { createCinematicSystem } from './game/cinematics/cinematic-system'
import { createCinematicOverlay } from './game/cinematics/cinematic-overlay'
import { createGameCinematicStage } from './game/cinematics/game-cinematic-stage'
import type { CinematicFacade } from './engine/script/types'
import { createSpellCastSystem } from './game/spells'
import { createSpellEffectSystem, createSpellEffectRenderSystem } from './game/spell-effect-system'
import { createWeaponStanceSystem } from './game/weapon-stance-system'
import { createPlayerDeathAnimSystem } from './game/anim/player-death-anim-system'
import { createArrowHitSystem } from './engine/ecs/systems/arrow-hit-system'
import { createNpcHazardSystem } from './engine/ecs/systems/npc-hazard-system'
import { createStuckArrowSystem } from './game/stuck-arrow-system'
import { createHealthBarSystem } from './game/health-bar-system'
import { createHealthHudSystem } from './game/health-hud-system'
import { createManaHudSystem } from './game/mana-hud-system'
import { createConsumableHudSystem } from './game/consumable-hud-system'
import { createStoneDamageSystem } from './game/stone-damage-system'
import { createElectricOrbSystem } from './game/electric-orb-system'
import { createConsumableUseSystem, createDelayedConsumableSystem } from './game/consumable-use-system'
import { createDynamiteSystem } from './game/dynamite-system'
import { createNpcLootSystem } from './game/npc-loot-system'
import { createSniperHatTrajectorySystem } from './game/sniper-hat-trajectory-system'
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
import { DEMO_LEVEL_ID, FOREST_LIFT_VALLEY_LEVEL_ID } from './game/procedural-level-ids'
import { getProceduralLevelDefinition, publicPlayableLevels, type ProceduralScriptSources } from './game/procedural-levels'
import { createTitleScreen, type TitleScreen } from './game/front-end/title-screen'
import { createLevelSelect, type LevelSelect } from './game/front-end/level-select'
import { createHelpScreen, type HelpScreen } from './game/front-end/help-screen'
import { createEndgameCredits, type EndgameCredits } from './game/front-end/endgame-credits'
import { maybeShowFirstPlayTips } from './game/front-end/first-play-tips'
import { readPlayerVitals, spawnPlayer, type PlayerVitalsSnapshot } from './game/player'
import { createPlayerTorchSystem } from './game/player-torch-system'
import { createIndoorCutSystem } from './game/indoor-cut-system'
import { createSunFollowSystem } from './engine/render/sun-follow-system'
import { castShadowOnPlayer, enablePlayerVisibility } from './engine/render/render-layers'
import { disposeObject3D } from './engine/render/dispose-object'
import { createTorchBlockRenderSystem } from './game/torch-block-system'
import { createTorchBlockRenderSystemV2 } from './game/torch-block-system-v2'
import { createRailRenderSystem } from './game/rail/rail-render-system'
import { createFenceRenderSystem } from './game/fence/fence-render-system'
import { createRailCartSystem, nearestRailCartInteractionTarget } from './game/rail/rail-cart-system'
import { createLadderRenderSystem } from './game/ladder/ladder-render-system'
import { createLadderSystem, nearestLadderInteractionTarget } from './game/ladder/ladder-system'
import { getTorchSystem } from './engine/render/render-settings'
import { spawnCoinPile } from './game/pickups'
import { spawnLevelStone } from './game/stones'
import { registerPistonMechanism } from './game/mechanisms'
import { createSoundSourceSystem, createSoundZoneSystem, startEnvironment } from './game/sound-sources'
import { createPlayerLocomotionAudioSystem } from './game/player-audio'
import { createEnvironmentFxSystem, createVisualFxZoneSystem } from './game/weather'
import { createPropRenderSystem } from './game/props/prop-system'
import { createNpcRenderSystem } from './game/npcs/npc-render-system'
import { createWolfHowlSystem } from './game/npcs/wolf-howl-system'
import { createNpcBehaviourSystem } from './engine/ecs/systems/npc-behaviour-system'
import { createPlayerShieldSystem } from './game/player-shield-system'
import { createPlayerStunBlinkSystem } from './game/player-stun-blink-system'
import { defeatedNpcSnapshot, registerRuntimeNpcs, type RegisteredNpcRuntime } from './game/npcs/npc-runtime'
import { createGameScriptSystem } from './game/script-system'
import { createInteractionSystem } from './game/interaction-system'
import { nearestDoorInteractionTarget, scanDoors } from './game/doors'
import { nearestChestInteractionTarget } from './game/chests'
import { createDialogueController } from './game/dialogue-system'
import { createDialogueVoiceService } from './game/dialogue-voice'
import { createTradeController } from './game/trade-system'
import { checkpointStorageKey, createSessionCheckpointStore, resolveSpawn, type CheckpointStore } from './game/checkpoint-store'
import { defineZone, type Zone } from './engine/ecs/zones'
import { createGameActionMap, GameAction, loadStoredKeyOverrides } from './game/actions'
import { createGameMenuSystem, type GameMenuController } from './game/game-menu-system'
import { createInventorySystem } from './game/inventory-system'
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
import { copyInventoryItems } from './game/inventory'
import { clearTemporaryVoxelEdits, restoreTemporaryVoxelEdits } from './game/temporary-voxel-edits'
import type { ScriptEngineSystem } from './engine/script/script-engine-system'
import type { FlagValue, ScriptEntry, TravelFacade } from './engine/script/types'
import demoQuestSource from '../examples/scripts/demo-quest.js?raw'
import lanternTrialSource from '../examples/scripts/lantern-trial.js?raw'
import hasteShrineSource from '../examples/scripts/haste-shrine.js?raw'
import paidPortalShrineSource from '../examples/scripts/paid-portal-shrine.js?raw'
import cliffLiftRepairSource from '../examples/scripts/cliff-lift-repair.js?raw'

const BROWSER_PROCEDURAL_SCRIPT_SOURCES: ProceduralScriptSources = {
    'examples/scripts/demo-quest.js': demoQuestSource,
    'examples/scripts/lantern-trial.js': lanternTrialSource,
    'examples/scripts/haste-shrine.js': hasteShrineSource,
    'examples/scripts/paid-portal-shrine.js': paidPortalShrineSource,
    'examples/scripts/cliff-lift-repair.js': cliffLiftRepairSource,
}

interface LoadedLocation {
    id: string
    meta: LevelMeta
    chunks: ChunkManager
    editorMeta?: EditorLevelMeta
    sourceBuffer?: ArrayBuffer
    restoredFlags?: Map<string, FlagValue>
    restoredDefeatedNpcIds?: Set<string>
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
    defeatedNpcIds: Set<string>
}

interface SystemSlot {
    readonly system: System
    set(next: System | null): void
}

async function main(): Promise<void> {
    const engine = new Engine({ fixedHz: 60 })
    const { renderer, world } = engine
    const actions = createGameActionMap(engine.input, loadStoredKeyOverrides())
    const audio = new AudioEngine()
    const dialogueVoice = createDialogueVoiceService(audio)
    const dialogue = createDialogueController({ input: engine.input, voice: dialogueVoice })
    const trade = createTradeController({ input: engine.input })
    const audioReady = audio.loadManifest(GAME_AUDIO_MANIFEST)
    void audioReady.catch((err) => console.warn('Game audio failed to load:', err))

    // Load any configured Blender character rigs before the first spawn. No-op
    // (no network) until a model is registered in CHARACTER_MODEL_URLS.
    await preloadCharacterModels()

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

    // ── Cinematics: one director for the whole session, driving the camera +
    // a letterbox/subtitle overlay. The script-facing facade resolves ids
    // against the active location's authored cinematics.
    const cinematicMusicIds = new Set((GAME_AUDIO_MANIFEST.music ?? []).map((a) => a.id))
    const cinematicOverlay = createCinematicOverlay()
    const cinematicDirector = new CinematicDirector(createGameCinematicStage({
        iso: renderer.iso,
        world,
        input: engine.input,
        overlay: cinematicOverlay,
        getNpcs: () => active?.meta.npcs ?? [],
        playSound: (id, o) => {
            if (cinematicMusicIds.has(id)) {
                void audio.playMusic(id, { volume: o.volume, crossfade: o.fade, fadeIn: o.fade, fadeOut: o.fade }).catch(() => {})
            } else {
                audio.play(id, { deferUntilUnlocked: true, volume: o.volume, fadeIn: o.fade })
            }
        },
    }))
    cinematicOverlay.onSkip(() => cinematicDirector.skip())
    const playedIntros = new Set<string>()
    const cinematicFacade: CinematicFacade = {
        play: (id) => {
            const c = (active?.meta.cinematics ?? []).find((x) => x.id === id)
            if (!c) {
                console.warn(`cinematic.play: unknown cinematic "${id}"`)
                return Promise.resolve()
            }
            const done = cinematicDirector.play(c)
            // A cinematic flagged `endsGame` (the summit shrine) rolls the
            // endgame credits when it finishes.
            return c.endsGame ? done.then(() => { rollEndgameCredits() }) : done
        },
        stop: () => {
            if (!cinematicDirector.isPlaying) return false
            cinematicDirector.skip()
            return true
        },
        get isPlaying() { return cinematicDirector.isPlaying },
    }
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
        railRender: createSystemSlot('railRender', false, RenderOrder.worldRender + 2),
        fenceRender: createSystemSlot('fenceRender', false, RenderOrder.worldRender + 2),
        ladderRender: createSystemSlot('ladderRender', false, RenderOrder.worldRender + 2),
        railCarts: createSystemSlot('railCarts', true, FixedOrder.input + 4),
        ladders: createSystemSlot('ladders', true, FixedOrder.input + 5),
    }
    const allSlots = Object.values(slots)
    let activeWeatherSystem: ReturnType<typeof createEnvironmentFxSystem>['weatherSystem'] | null = null

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
        const carriedVitals = readPlayerVitals(world)
        try {
            const loaded = await loadProjectLocation(targetId, snapshots)
            activateLocation(loaded, {
                arrivalId: opts.arrivalId,
                playerSettings: carried,
                playerVitals: carriedVitals,
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
            playerVitals?: PlayerVitalsSnapshot | null
            saveCurrent: boolean
            useCheckpoint: boolean
        },
    ): void {
        if (opts.saveCurrent) captureCurrentSnapshot()
        cleanupActiveLocation()
        clearRuntimeWorld(world)
        replaceChunks(chunks, loaded.chunks)
        // Make base-game-style door blocks (placed by the procedural house /
        // church / stable generators and hand-authored levels) openable.
        scanDoors(world, chunks)

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
        world.inventory.items = copyInventoryItems(world.playerSettings.inventory.items)
        world.defeatedNpcIds = new Set(loaded.restoredDefeatedNpcIds ?? [])

        spawnPlayer(world, { spawn: effectiveSpawn, settings: world.playerSettings, vitals: opts.playerVitals ?? undefined })
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
        sun.target.position.set((meta.sizeX ?? meta.size) / 2, 0, (meta.sizeZ ?? meta.size) / 2)
        renderer.iso.target.set(effectiveSpawn.x, effectiveSpawn.y, effectiveSpawn.z)
        renderer.iso.syncPosition()

        installLocationSystems(nextActive, loaded.restoredFlags)
        void audioReady.then(() => {
            if (version !== locationVersion || active !== nextActive) return
            nextActive.environmentHandle = startEnvironment(audio, meta.environment, GAME_AUDIO_MANIFEST)
        })
        titleOverlay.show(meta.name)

        // Auto-play a `playOnStart` cinematic the first time the player reaches
        // this location in the session.
        const intro = (meta.cinematics ?? []).find((c) => c.playOnStart)
        if (intro) {
            const introKey = `${loaded.id}:${intro.id}`
            if (!playedIntros.has(introKey)) {
                playedIntros.add(introKey)
                void cinematicDirector.play(intro)
            }
        }
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
        activeWeatherSystem = environmentFx.weatherSystem
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
            trade: trade.facade,
            travel: travelFacade,
            cinematic: cinematicFacade,
            level: meta,
            props: meta.props,
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
        slots.npcRender.set(createNpcRenderSystem(renderer.scene, {
            getNpcs: () => meta.npcs,
            onHurt: (p, model) => {
                const id = model === 'spider'
                    ? GameAudio.SpiderHurt
                    : model === 'wolf'
                        ? GameAudio.WolfHurt
                        : GameAudio.NpcHurt
                audio.playSpatial(id, p, {
                    deferUntilUnlocked: true,
                    rate: 0.9 + Math.random() * 0.2,
                    refDistance: 4,
                    maxDistance: 30,
                    rolloffModel: 'linear',
                    panningModel: 'equalpower',
                    priority: 2,
                })
            },
            // Creature death voices (other models settle silently for now).
            onDie: (p, model) => {
                const id = model === 'spider'
                    ? GameAudio.SpiderDie
                    : model === 'wolf'
                        ? GameAudio.WolfDie
                        : null
                if (!id) return
                audio.playSpatial(id, p, {
                    deferUntilUnlocked: true,
                    rate: 0.94 + Math.random() * 0.12,
                    refDistance: 5,
                    maxDistance: 34,
                    rolloffModel: 'linear',
                    panningModel: 'equalpower',
                    priority: 3,
                })
            },
            // Spatial attack cues: creatures vocalize as they lunge; the
            // archer's `shoot` clip plays a bow-release.
            onAttack: (clip, p, model) => {
                const creatureCue = model === 'spider'
                    ? GameAudio.SpiderChitter
                    : model === 'wolf'
                        ? GameAudio.WolfSnarl
                        : null
                if (creatureCue) {
                    audio.playSpatial(creatureCue, p, {
                        deferUntilUnlocked: true,
                        rate: 0.92 + Math.random() * 0.16,
                        refDistance: 5,
                        maxDistance: 30,
                        rolloffModel: 'linear',
                        panningModel: 'equalpower',
                        priority: 2,
                    })
                    return
                }
                if (clip !== 'shoot') return
                audio.playSpatial(GameAudio.Bow, p, {
                    deferUntilUnlocked: true,
                    rate: 0.94 + Math.random() * 0.12,
                    refDistance: 5,
                    maxDistance: 32,
                    rolloffModel: 'linear',
                    panningModel: 'equalpower',
                    priority: 2,
                })
            },
        }))
        slots.railCarts.set(createRailCartSystem(chunks, meta.railCarts, { actions, audio, audioReady, soundId: GameAudio.CartRolling }))
        slots.ladders.set(createLadderSystem(chunks, { actions }))
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
            setLocalCut: (cut) => chunkRenderer.setLocalCut(cut),
            viewpoint: () => renderer.iso.camera.position,
            enabled: () => world.playerSettings?.indoorCutEnabled !== false,
            mode: () => world.playerSettings?.indoorCutMode ?? 'corridor',
        }))
        slots.torchBlocks.set(
            getTorchSystem() === 'experimental'
                ? createTorchBlockRenderSystemV2(renderer.scene, chunks, {
                    audio,
                    audioReady,
                    soundId: GameAudio.TorchFire,
                })
                : createTorchBlockRenderSystem(renderer.scene, chunks, {
                    audio,
                    audioReady,
                    soundId: GameAudio.TorchFire,
                }),
        )
        slots.railRender.set(createRailRenderSystem(renderer.scene, chunks))
        slots.fenceRender.set(createFenceRenderSystem(renderer.scene, chunks))
        slots.ladderRender.set(createLadderRenderSystem(renderer.scene, chunks))
    }

    function captureCurrentSnapshot(): void {
        if (!active?.editorMeta) return
        restoreTemporaryVoxelEdits(world, chunks)
        active.editorMeta.pickups = captureLiveEditorPickups(world)
        snapshots.set(active.id, {
            buffer: serializeLevel(chunks, active.editorMeta),
            flags: new Map(active.scriptEngine?.flags ?? []),
            defeatedNpcIds: new Set(defeatedNpcSnapshot(world)),
        })
    }

    function cleanupActiveLocation(): void {
        if (active?.scriptEngine) active.scriptEngine.runtime.emit('level.reset')
        active?.environmentHandle?.stop(0.25)
        active?.npcRuntime?.dispose()
        audio.stopMusic(0.35)
        for (const slot of allSlots) slot.set(null)
        activeWeatherSystem = null
        if (active) {
            active.scriptEngine = null
            active.environmentHandle = null
            active.npcRuntime = null
        }
    }

    // Positioned one-shot SFX helper (melee hits, spell impacts, …). Spatial
    // so a brawl or a bolt across the plaza is placed in the world, not flat;
    // events at the player originate on the listener, so they're full volume.
    // Staff/hammer melee attacks get the beefier swing/hit samples; lighter
    // weapons use the light pair.
    const HEAVY_MELEE_ATTACKS = new Set(['staff-slam', 'hammer-slam'])
    const playSpatialSfx = (id: string, x: number, y: number, z: number, priority: number, rate?: number): void => {
        audio.playSpatial(id, { x, y, z }, {
            deferUntilUnlocked: true,
            rate: rate ?? 0.94 + Math.random() * 0.12,
            refDistance: 4,
            maxDistance: 30,
            rolloffModel: 'linear',
            panningModel: 'equalpower',
            priority,
        })
    }

    // ── Front-end: title / level select / help / endgame credits ─────────
    let titleScreen: TitleScreen
    let levelSelect: LevelSelect
    let helpScreen: HelpScreen
    let menuController: GameMenuController
    let endgameCredits: EndgameCredits | null = null

    titleScreen = createTitleScreen({
        onPlay: () => { void startLevel(FOREST_LIFT_VALLEY_LEVEL_ID) },
        onLevelSelect: () => { titleScreen.hide(); levelSelect.show() },
        onSettings: () => menuController.openSettings(),
        onHelp: () => { titleScreen.hide(); helpScreen.show() },
    })
    levelSelect = createLevelSelect({
        entries: publicPlayableLevels().map((l) => ({ id: l.id, title: l.menuTitle ?? l.name, description: l.description })),
        onPick: (id) => { void startLevel(id) },
        onBack: () => { levelSelect.hide(); titleScreen.show() },
    })
    helpScreen = createHelpScreen({
        actions,
        onBack: () => { helpScreen.hide(); if (!active) titleScreen.show() },
    })

    async function startLevel(id: string): Promise<void> {
        titleScreen.hide()
        levelSelect.hide()
        helpScreen.hide()
        let loaded: LoadedLocation
        try {
            loaded = await loadProjectLocation(id, snapshots)
        } catch (err) {
            console.error(`Level "${id}" failed to load — using demo:`, err)
            loaded = loadBuiltinDemoLocation()
        }
        activateLocation(loaded, {
            playerSettings: copyPlayerSettings(loaded.meta.player),
            saveCurrent: false,
            useCheckpoint: true,
        })
        maybeShowFirstPlayTips()
    }

    function returnToTitle(): void {
        menuController.setOpen(false)
        cleanupActiveLocation()
        clearRuntimeWorld(world)
        active = null
        locationVersion++
        void audio.playMusic(GameAudio.ThemeMenu, { loop: true, volume: 0.34, crossfade: 1.0 }).catch(() => {})
        titleScreen.show()
    }

    function rollEndgameCredits(): void {
        menuController.setOpen(false)
        endgameCredits?.dispose()
        endgameCredits = createEndgameCredits({
            onDone: () => { endgameCredits?.dispose(); endgameCredits = null; returnToTitle() },
        })
        endgameCredits.show()
    }

    menuController = createGameMenuSystem(engine.input, actions, audio, {
        renderElement: renderer.webgpu.domElement,
        exitHref: './editor.html',
        onMainMenu: returnToTitle,
        onHelp: () => { menuController.setOpen(false); helpScreen.show() },
    })

    // A `?level=<id>` deep-link jumps straight into a level (and playtest from
    // the editor); otherwise the public game opens on the title screen.
    const deepLinkLevel = new URLSearchParams(window.location.search).get('level')
    if (deepLinkLevel) {
        const initial = await loadInitialLocation()
        activateLocation(initial, {
            playerSettings: copyPlayerSettings(initial.meta.player),
            saveCurrent: false,
            useCheckpoint: true,
        })
        maybeShowFirstPlayTips()
    } else {
        void audio.playMusic(GameAudio.ThemeMenu, { loop: true, volume: 0.34, fadeIn: 1.2 }).catch(() => {})
        titleScreen.show()
    }

    engine
        .addSystem(createSunFollowSystem(sun, () => renderer.iso.target), 'sunFollow')
        .addSystem(createAudioUnlockSystem(audio), 'audioUnlock')
        .addSystem(slots.soundSources.system, 'soundSources')
        .addSystem(slots.soundZones.system, 'soundZones')
        .addSystem(slots.environmentFx.system, 'environmentFx')
        .addSystem(slots.visualFxZones.system, 'visualFxZones')
        .addSystem(slots.propRender.system, 'propRender')
        .addSystem(slots.npcRender.system, 'npcRender')
        .addSystem(createWolfHowlSystem({
            getHour: () => activeWeatherSystem?.ambient.state.timeOfDay ?? 12,
            onHowl: (p) => {
                audio.playSpatial(GameAudio.WolfHowl, p, {
                    deferUntilUnlocked: true,
                    rate: 0.94 + Math.random() * 0.1,
                    refDistance: 12,
                    maxDistance: 70,
                    rolloffModel: 'linear',
                    panningModel: 'equalpower',
                    priority: 2,
                })
            },
        }), 'wolfHowls')
        .addSystem(createStuckArrowSystem(), 'stuckArrows')
        .addSystem(createSpellEffectSystem({
            onWaveHit: (p) => playSpatialSfx(GameAudio.SpellNovaHit, p.x, p.y, p.z, 2),
        }), 'spellEffects')
        .addSystem(createSpellEffectRenderSystem(renderer.scene), 'spellEffectsRender')
        .addSystem(createHealthBarSystem(renderer.scene, () => renderer.iso.camera), 'healthBars')
        .addSystem(createPlayerShieldSystem(actions, { actionId: GameAction.RaiseShield }), 'playerShield')
        .addSystem(createNpcBehaviourSystem(chunks), 'npcBehaviour')
        .addSystem(createMeleeCombatSystem({
            chunks,
            onSwing: (e) => playSpatialSfx(
                HEAVY_MELEE_ATTACKS.has(e.attackId) ? GameAudio.HeavySwing : GameAudio.SwordSwing,
                e.x, e.y, e.z, 2,
            ),
            onHit: (e) => playSpatialSfx(
                HEAVY_MELEE_ATTACKS.has(e.attackId) ? GameAudio.MeleeHitHeavy : GameAudio.MeleeHit,
                e.x, e.y, e.z, 3,
            ),
            onBlock: (e) => playSpatialSfx(
                GameAudio.ShieldBlock,
                e.x,
                e.y,
                e.z,
                e.blockKind === 'perfect' ? 5 : 4,
                e.blockKind === 'perfect' ? 1.22 : undefined,
            ),
            onStun: (e) => {
                if (e.reason !== 'attack' || e.attackId !== 'hammer-slam') return
                playSpatialSfx(GameAudio.AirPush, e.x, e.y, e.z, 5, 0.82)
            },
        }), 'meleeCombat')
        .addSystem(createPlayerHurtAudioSystem({
            onHurt: () => audio.play(GameAudio.PlayerHurt, {
                deferUntilUnlocked: true,
                rate: 0.94 + Math.random() * 0.12,
            }),
        }), 'playerHurtAudio')
        .addSystem(createNpcHazardSystem(chunks), 'npcHazard')
        .addSystem(createPlayerControlSystem(engine.input, actions, renderer.iso, {
            chunks,
            onJump: () => audio.play(GameAudio.Jump, {
                deferUntilUnlocked: true,
                rate: 0.97 + Math.random() * 0.06,
            }),
        }), 'playerControl')
        .addSystem(createPlayerTorchSystem(), 'playerTorch')
        .addSystem(createWeaponStanceSystem(actions, { actionId: GameAction.SwitchWeapon }), 'weaponStance')
        .addSystem(createConsumableUseSystem(actions, { actionId: GameAction.UseConsumable, audio }), 'consumableUse')
        .addSystem(createProjectileLaunchSystem(actions, {
            // F is the universal attack; in the ranged stance it looses an arrow.
            actionId: GameAction.BowShot,
            canUse: (world) => world.weaponStance === 'ranged',
            onLaunch: () => audio.play(GameAudio.Bow, { deferUntilUnlocked: true }),
        }), 'projectileLaunch')
        .addSystem(createMeleeAttackSystem(actions, {
            // F drives melee in both the sword (melee) and staff (magic) stances;
            // the system plays the sword swing or the staff bonk per loadout.
            actionId: GameAction.BowShot,
            canUse: (world) => world.weaponStance === 'melee' || world.weaponStance === 'magic',
        }), 'meleeAttack')
        .addSystem(createSpellCastSystem(actions, {
            // C casts the selected spell — magician only (the staff channels it).
            actionId: GameAction.CastSpell,
            canUse: (world) => world.weaponStance === 'magic',
            // Distinct cast cue per spell (flat — you're the caster).
            onCast: (spell) => audio.play(
                spell.id === 'nova' ? GameAudio.SpellNovaCast
                    : spell.id === 'orb' ? GameAudio.SpellOrbCast
                        : GameAudio.SpellBoltCast,
                { deferUntilUnlocked: true, rate: 0.97 + Math.random() * 0.06 },
            ),
        }), 'spellCast')
        .addSystem(createArrowHitSystem(chunks, {
            onArrowLand: () => audio.play(GameAudio.ArrowHit, { deferUntilUnlocked: true }),
            onArrowHitNpc: () => audio.play(GameAudio.ArrowHit, { deferUntilUnlocked: true }),
            // Enemy arrow connecting with the player: the same thunk, but flat
            // (it's happening to you, not out in the world).
            onArrowHitPlayer: () => audio.play(GameAudio.ArrowHit, { deferUntilUnlocked: true }),
            // Arrow turned away by the player's raised shield — the block clang.
            onArrowBlocked: (_eid, p) => playSpatialSfx(GameAudio.ShieldBlock, p.x, p.y, p.z, 3),
            // Arcane Bolt gets its own spatial impact, not the arrow thunk.
            onBoltHit: (_eid, p) => playSpatialSfx(GameAudio.SpellBoltHit, p.x, p.y, p.z, 3),
        }), 'arrowHit')
        .addSystem(createHighJumpSystem(actions, {
            actionId: GameAction.HighJump,
            chunks,
            onHighJump: () => audio.play(GameAudio.HighJump, { deferUntilUnlocked: true }),
        }), 'highJump')
        .addSystem(createAirPushSystem(actions, {
            actionId: GameAction.AirPush,
            onAirPush: () => audio.play(GameAudio.AirPush, {
                deferUntilUnlocked: true,
                rate: 0.96 + Math.random() * 0.08,
            }),
        }), 'airPush')
        .addSystem(createDelayedConsumableSystem(), 'delayedConsumables')
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
        .addSystem(slots.railCarts.system, 'railCarts')
        .addSystem(slots.ladders.system, 'ladders')
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
        .addSystem(createDynamiteSystem({
            onExplode: (e) => {
                activeWeatherSystem?.triggerExplosion({ x: e.x, y: e.y, z: e.z }, {
                    size: { x: 6.5, y: 5.2, z: 6.5 },
                    count: 420,
                    speed: 8.5,
                    lifetime: 1.35,
                    lightIntensity: 10,
                    lightDistance: 20,
                })
                playSpatialSfx(GameAudio.Explosion, e.x, e.y, e.z, 6, 0.96)
            },
        }), 'dynamite')
        .addSystem(createStoneDamageSystem({
            onHit: () => audio.play(GameAudio.StoneImpact, { deferUntilUnlocked: true, volume: 0.7, rate: 0.9 }),
        }), 'stoneDamage')
        .addSystem(createElectricOrbSystem({
            onZap: (p) => playSpatialSfx(GameAudio.SpellOrbZap, p.x, p.y, p.z, 3),
        }), 'electricOrb')
        .addSystem(createNpcLootSystem(), 'npcLoot')
        .addSystem(createDynamicCollisionSystem(chunks), 'dynamicCollision')
        .addSystem(createPlayerDeathSystem({
            chunks,
            onDeath: () => {
                audio.play(GameAudio.Death, { deferUntilUnlocked: true })
                audio.playStinger(GameAudio.DeathStinger, { deferUntilUnlocked: true })
            },
        }), 'playerDeath')
        .addSystem(createRenderSyncSystem(renderer.scene), 'renderSync')
        .addSystem(createPlayerDeathAnimSystem(), 'playerDeathAnim')
        .addSystem(createAnimationSystem(), 'animation')
        .addSystem(createPlayerStunBlinkSystem(), 'playerStunBlink')
        .addSystem(createSniperHatTrajectorySystem(renderer.scene, chunks), 'sniperHatTrajectory')
        .addSystem(slots.blockLights.system, 'blockLights')
        .addSystem(slots.chunkRender.system, 'chunkRender')
        .addSystem(slots.indoorCut.system, 'indoorCut')
        .addSystem(slots.torchBlocks.system, 'torchBlocks')
        .addSystem(slots.railRender.system, 'railRender')
        .addSystem(slots.fenceRender.system, 'fenceRender')
        .addSystem(slots.ladderRender.system, 'ladderRender')
        .addSystem(createRenderMetricsSystem(renderer), 'renderMetrics')
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input, {
            logPosition: { top: '48px', right: '8px', maxWidth: '320px' },
            cameraProvider: () => renderer.iso.camera,
            renderElement: renderer.webgpu.domElement,
        }), 'debugOverlay')
        .addSystem(createHealthHudSystem(), 'healthHud')
        .addSystem(createManaHudSystem(), 'manaHud')
        .addSystem(createConsumableHudSystem(actions), 'consumableHud')
        .addSystem(createInventorySystem(engine.input, actions), 'inventory')
        .addSystem(menuController.system, 'gameMenu')
        .addSystem(dialogue.system, 'dialogue')
        .addSystem(trade.system, 'trade')
        .addSystem(createInteractionSystem({
            actions,
            camera: () => renderer.iso.camera,
            domElement: renderer.webgpu.domElement,
            providers: [
                (activeWorld, player) => nearestRailCartInteractionTarget(activeWorld, player, chunks),
                (activeWorld, player) => nearestChestInteractionTarget(activeWorld, player, chunks, active?.meta.chests ?? [], (a) => playSpatialSfx(GameAudio.ChestOpen, a.x, a.y, a.z, 3)),
                (activeWorld, player) => nearestLadderInteractionTarget(activeWorld, player, chunks),
                (activeWorld, player) => nearestDoorInteractionTarget(activeWorld, player, chunks),
            ],
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
        .addSystem(createCinematicSystem(cinematicDirector), 'cinematic')
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
    world.railCarts.length = 0
    world.railCartsById.clear()
    world.ridingCartByPlayer.clear()
    world.doors.length = 0
    world.pistons.length = 0
    world.pistonsById.clear()
    world.zones.clear()
    world.zoneEvents.length = 0
    world.popupMessages.length = 0
    world.nextPopupMessageId = 1
    world.popupClears.length = 0
    world.nextPopupClearId = 1
    world.scriptTriggerEvents.length = 0
    world.defeatedNpcIds.clear()
    clearTemporaryVoxelEdits(world)
    world.deathSignal = null
    world.lastCheckpoint = null
    world.weaponStance = 'melee'
    world.selectedSpell = 'bolt'
    world.selectedConsumable = 'heal-potion'
    world.delayedConsumableEffects.length = 0
    world.spellEffects.length = 0
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
    settings.inventory.items = copyInventoryItems(world.inventory.items)
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
        const buffer = await consumePlaytestLevel()
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
            restoredDefeatedNpcIds: new Set(snapshot.defeatedNpcIds),
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
        restoredDefeatedNpcIds: new Set(active.entrySnapshot.defeatedNpcIds),
    }
}

function entrySnapshotFromLoaded(loaded: LoadedLocation): LocationSnapshot {
    if (loaded.sourceBuffer) {
        return {
            buffer: loaded.sourceBuffer.slice(0),
            flags: new Map(loaded.restoredFlags ?? []),
            defeatedNpcIds: new Set(loaded.restoredDefeatedNpcIds ?? []),
        }
    }
    if (loaded.editorMeta) {
        return {
            buffer: serializeLevel(loaded.chunks, loaded.editorMeta),
            flags: new Map(loaded.restoredFlags ?? []),
            defeatedNpcIds: new Set(loaded.restoredDefeatedNpcIds ?? []),
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
    btn.type = 'button'
    btn.tabIndex = -1
    btn.textContent = '↻ Restart'
    btn.onclick = (ev) => {
        ev.preventDefault()
        btn.blur()
        world.deathSignal ??= 'manual-restart'
    }
    btn.onkeydown = preventFocusedHudButtonKeys
    btn.onkeyup = preventFocusedHudButtonKeys
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

function preventFocusedHudButtonKeys(ev: KeyboardEvent): void {
    if (ev.code !== 'Space' && ev.code !== 'Enter') return
    ev.preventDefault()
    ev.stopPropagation()
    if (ev.currentTarget instanceof HTMLElement) ev.currentTarget.blur()
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

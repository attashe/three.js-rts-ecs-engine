import { AmbientLight, DirectionalLight } from 'three'
import { Engine } from './engine/engine'
import { ChunkManager, ChunkRenderer, DEFAULT_PALETTE, createBlockLightSystem } from './engine/voxel'
import type { System } from './engine/ecs/systems/system'
import { RenderOrder } from './engine/ecs/systems/orders'
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
import { AudioEngine } from './engine/audio'
import { generatePlatformerLevel } from './game/level'
import { spawnPlayer } from './game/player'
import { createPlayerTorchSystem } from './game/player-torch-system'
import { createSunFollowSystem } from './engine/render/sun-follow-system'
import { castShadowOnPlayer, enablePlayerVisibility } from './engine/render/render-layers'
import { createTorchBlockRenderSystem } from './game/torch-block-system'
import { createTorchBlockRenderSystemV2 } from './game/torch-block-system-v2'
import { getTorchSystem } from './engine/render/render-settings'
import { spawnCoinPile } from './game/pickups'
import { registerPistonMechanism } from './game/mechanisms'
import { createSoundSourceSystem, createSoundZoneSystem, startEnvironment } from './game/sound-sources'
import { createPlayerLocomotionAudioSystem } from './game/player-audio'
import { createEnvironmentFxSystem, createVisualFxZoneSystem } from './game/weather'
import { defineZone } from './engine/ecs/zones'
import { createGameActionMap, GameAction } from './game/actions'
import { createGameMenuSystem } from './game/game-menu-system'
import { GAME_AUDIO_MANIFEST, GameAudio } from './game/audio'
import { deserializeLevel } from './engine/voxel/level-serializer'
import { consumePlaytestLevel } from './editor/playtest'
import { levelMetaFromEditor } from './game/level-from-meta'
import type { EditorLevelMeta } from './editor/editor-state'
import type { LevelMeta } from './game/level'
import type { GameWorld } from './engine/ecs/world'

async function main(): Promise<void> {
    const engine = new Engine({ fixedHz: 60 })
    const { renderer, world } = engine
    const actions = createGameActionMap(engine.input)
    const audio = new AudioEngine()
    const audioReady = audio.loadManifest(GAME_AUDIO_MANIFEST)
    void audioReady.catch((err) => console.warn('Game audio failed to load:', err))

    // Lighting. Sun from south-east, target at the centre of the demo level so
    // the shadow camera covers the whole island.
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
    // Player rig lives on a non-default render layer; opt the sun
    // into illuminating + shadowing it. Without this the player
    // appears unlit and casts no sun shadow.
    castShadowOnPlayer(sun)
    renderer.scene.add(sun)
    renderer.scene.add(sun.target)

    // Voxel world + level + chunk renderer.
    const chunks = new ChunkManager(DEFAULT_PALETTE)
    const meta = loadLevel(chunks)
    const hasAuthoredEnvironmentFx = Boolean(meta.ambientWeather)
    defaultAmbient.visible = !hasAuthoredEnvironmentFx
    sun.visible = !hasAuthoredEnvironmentFx
    sun.target.position.set(meta.size / 2, 0, meta.size / 2)
    const chunkRenderer = new ChunkRenderer(renderer.scene, chunks)
    chunkRenderer.rebuildAll()

    spawnPlayer(world, { spawn: meta.spawn })
    for (const coin of meta.coinPiles) spawnCoinPile(world, coin)
    for (const piston of meta.pistons) registerPistonMechanism(world, chunks, piston)
    for (const zone of meta.zones) defineZone(world, zone)

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

    // Level-wide ambient bed — starts once audio is unlocked. Routes
    // through music-bus or sfx-bus depending on whether the chosen
    // asset is declared under `music` or `sounds` in the manifest.
    // Authoring `(none)` in the editor leaves `meta.environment`
    // undefined ⇒ playtest is genuinely silent.
    void audioReady.then(() => startEnvironment(audio, meta.environment, GAME_AUDIO_MANIFEST))

    engine
        .addSystem(createSunFollowSystem(sun, () => renderer.iso.target), 'sunFollow')
        .addSystem(createAudioUnlockSystem(audio), 'audioUnlock')
        .addSystem(createSoundSourceSystem(audio, meta.soundSources, { audioReady }), 'soundSources')
        .addSystem(createSoundZoneSystem(audio, meta.soundZones, { audioReady }), 'soundZones')
        .addSystem(createEnvironmentFxSystem(
            renderer.scene,
            meta.ambientWeather,
            () => renderer.iso.camera,
            () => renderer.iso.target,
        ), 'environmentFx')
        .addSystem(createVisualFxZoneSystem(renderer.scene, audio, meta.weatherZones, () => renderer.iso.camera, { audioReady }), 'visualFxZones')
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
                kind === PickupKind.Arrow ? GameAudio.PickupArrow : GameAudio.PickupGold,
                { deferUntilUnlocked: true },
            ),
        }), 'pickup')
        .addSystem(createPistonSystem(chunks, {
            // Author-tagged movement sound. Fires once per teleport flip
            // and once per physical arrival — at the piston's current
            // cell so the falloff matches its visual position.
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
        }), 'piston')
        .addSystem(createZoneTriggerSystem(chunks), 'zoneTrigger')
        .addSystem(createFallingStoneSpawnerSystem(meta.stoneSpawners, { maxMovingStones: 12 }), 'stoneSpawner')
        .addSystem(createPhysicsSystem(chunks, {
            // One-shot stone-impact sfx — fires every time a falling
            // stone's vertical sweep is blocked at >4 m/s. Volume scales
            // with the inbound speed so a stone settling at 5 m/s is
            // much quieter than a 15 m/s slam, and a per-event pitch
            // jitter keeps a multi-bounce settle from sounding robotic.
            // Player landings get a louder dedicated "land.wav" via the
            // locomotion system, so we filter strictly to Stone here.
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
            onDeath: () => {
                audio.play(GameAudio.Death, { deferUntilUnlocked: true })
                audio.playStinger(GameAudio.DeathStinger, { deferUntilUnlocked: true })
            },
        }), 'playerDeath')
        .addSystem(createRenderSyncSystem(renderer.scene), 'renderSync')
        .addSystem(createBlockLightSystem(chunks, {
            scene: renderer.scene,
            camera: () => renderer.iso.camera,
        }), 'blockLights')
        .addSystem(chunkRenderSystem, 'chunkRender')
        .addSystem(
            // Pick the torch render system at startup based on the
            // user setting. Switching requires a page reload — the
            // two systems own different scene objects and can't be
            // safely hot-swapped without disposing chunks of state.
            getTorchSystem() === 'shadowed'
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
            'torchBlocks',
        )
        .addSystem(createRenderMetricsSystem(renderer), 'renderMetrics')
        // Push the log panel below the top-right ↻ Restart / ← Editor
        // buttons so it doesn't cover them. Buttons sit at top: 8px with
        // ~28 px height — start the log at 48 px to leave a clear gap.
        .addSystem(createDebugOverlaySystem(renderer.scene, engine.input, {
            logPosition: { top: '48px', right: '8px', maxWidth: '320px' },
        }), 'debugOverlay')
        .addSystem(createGameMenuSystem(engine.input, actions, audio, {
            renderElement: renderer.webgpu.domElement,
            exitHref: './editor.html',
        }), 'gameMenu')
        .addSystem(createRestartSystem(), 'restart')
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

/**
 * Top-right "↻ Restart" button. Sets `world.deathSignal = 'manual-restart'`
 * which the `restart-system` picks up to trigger a page reload. Always
 * mounted (works in demo + playtest); when in playtest, sits next to the
 * "← Editor" button.
 */
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

function isPlaytestMode(): boolean {
    return new URLSearchParams(window.location.search).get('level') === 'playtest'
}

/**
 * Pick the level the game should load. In playtest mode we deserialize the
 * editor-authored level from session storage and translate its metadata into
 * the runtime `LevelMeta` (mapping editor pickups to coin piles, passing
 * pistons / zones / sound sources through). The procedural demo level is the
 * fallback when there's
 * no playtest snapshot, so the game URL still works as a standalone entry.
 */
function loadLevel(chunks: ChunkManager): LevelMeta {
    if (isPlaytestMode()) {
        const buffer = consumePlaytestLevel()
        if (buffer) {
            try {
                const loaded = deserializeLevel<EditorLevelMeta>(buffer)
                chunks.replacePalette(loaded.chunks.palette)
                copyChunks(loaded.chunks, chunks)
                const size = Math.max(24, Math.ceil(Math.max(
                    loaded.metadata.spawn.x,
                    loaded.metadata.spawn.z,
                )) * 2)
                return levelMetaFromEditor(loaded.metadata, size)
            } catch (err) {
                console.error('Playtest level failed to load — falling back to demo:', err)
            }
        }
    }
    return generatePlatformerLevel(chunks)
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

/**
 * Tiny "← Editor" link in the top-right that ships the player back to the
 * editor when they're running a playtest. Mounted as a static DOM element
 * (no Three / ECS plumbing) so it doesn't grow a custom system.
 */
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

import { Vector3, type Camera, type Scene } from 'three'
import { query } from 'bitecs'
import {
    WeatherSystem,
    WEATHER_PRESETS,
    type EffectType,
} from '../engine/fx'
import {
    createVisualFxZoneController,
    type VisualFxZoneController,
} from './visual-fx-zone-controller'
import type { AudioEngine, SoundHandle } from '../engine/audio'
import { PlayerControlled, Position } from '../engine/ecs/components'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import {
    defaultSoundForPreset,
    thunderDelayForDistance,
    thunderVolumeForZone,
    type AmbientWeatherRuntimeConfig,
    type WeatherZoneRuntimeConfig,
} from './weather-config'
import { GameAudio } from './audio'

/**
 * Bundles a `WeatherSystem` with paired spatial audio. Splitting the
 * runtime out of `weather-config.ts` (plain data + sound mapping)
 * keeps the FX-graphics deps off the test build path.
 */

export interface WeatherZoneSystemOptions {
    /** Resolves after `audio.loadManifest` so paired beds start when the
     *  manifest is ready. Without this they throw synchronously. */
    audioReady?: Promise<unknown>
    /** Fade applied when the system is disposed. */
    fadeOut?: number
    /** Hook the renderer's shader pre-compile pipeline (e.g.
     *  `(s, c) => renderer.webgpu.compileAsync(s, c)`). Called once at
     *  init so the first activation of a pre-allocated-but-disabled
     *  FX zone doesn't freeze on shader compile. The system briefly
     *  reveals hidden zones for the duration of the compile and
     *  restores them when the promise settles. */
    warmupShaders?: (scene: Scene, camera: Camera) => Promise<unknown>
}

interface ZoneEntry {
    config: WeatherZoneRuntimeConfig
    soundHandle: SoundHandle | null
    soundGain: number
}

interface PendingThunder {
    playAt: number
    position: { x: number; y: number; z: number }
    volume: number
}

/** Level-wide visual environment: sky dome, fog, sun/ambient light,
 *  camera-following rain/snow/clouds, and lightning flashes.
 *
 *  `focusProvider` optionally returns the world-space point the sun's
 *  shadow frustum should track (typically the iso camera's lookAt
 *  target / player). When omitted, `AmbientWeather` projects the
 *  camera ray onto the ground plane — good enough as a fallback but
 *  prone to drift on yaw rotation. */
/** Environment FX system + a side-channel handle on the underlying
 *  `WeatherSystem`. Scripts read/write the ambient state via this
 *  handle — see `createGameScriptSystem`. Returns null when the
 *  caller passed no ambient config (silent demo levels). */
export interface EnvironmentFxSystem extends System {
    readonly weatherSystem: WeatherSystem | null
}

export function createEnvironmentFxSystem(
    scene: Scene,
    ambient: AmbientWeatherRuntimeConfig | undefined,
    cameraProvider: () => Camera,
    focusProvider?: () => { x: number; y: number; z: number },
): EnvironmentFxSystem {
    if (!ambient) {
        return Object.assign(
            { name: 'environmentFx', update: () => {} } as System,
            { weatherSystem: null },
        )
    }

    const fx = new WeatherSystem(scene, { maxLights: 8, cullDistance: 120 })
    if (ambient) {
        const applied = ambient.presetId && WEATHER_PRESETS[ambient.presetId]
            ? { ...WEATHER_PRESETS[ambient.presetId]!.apply, ...ambient.state }
            : ambient.state
        fx.setAmbient(applied)
    }

    const system: System = {
        name: 'environmentFx',
        order: RenderOrder.cameraFollow + 2,
        update(_world, dt) {
            if (focusProvider) fx.ambient.setFocusPoint(focusProvider())
            fx.update(dt, cameraProvider())
        },
        dispose() {
            fx.dispose()
        },
    }
    return Object.assign(system, { weatherSystem: fx })
}

/**
 * Build a system that owns local Visual FX zones + paired spatial audio.
 * This deliberately disables `WeatherSystem`'s ambient pass so placing a
 * fire/rain/lava volume does not overwrite the level-wide sky/fog/lights.
 */
/** System + side-channel handle exposing per-zone toggles for scripts. */
export interface VisualFxZoneSystem extends System {
    readonly controller: VisualFxZoneController | null
}

export function createVisualFxZoneSystem(
    scene: Scene,
    audio: AudioEngine,
    zones: readonly WeatherZoneRuntimeConfig[],
    cameraProvider: () => Camera,
    opts: WeatherZoneSystemOptions = {},
): VisualFxZoneSystem {
    if (zones.length === 0) {
        return Object.assign(
            { name: 'visualFxZones', update: () => {} } as System,
            { controller: null as VisualFxZoneController | null },
        )
    }

    const fx = new WeatherSystem(scene, { ambient: false, maxLights: 8, cullDistance: 120 })
    const controller = createVisualFxZoneController(fx, zones)
    const entries = new Map<string, ZoneEntry>()
    const pendingThunder: PendingThunder[] = []
    const tmpThunderPos = new Vector3()
    const fadeOut = Math.max(0, opts.fadeOut ?? 0.2)
    let disposed = false
    let elapsed = 0
    let audioReady = !opts.audioReady

    const hooks = {
        onSpawned(config: WeatherZoneRuntimeConfig) {
            if (entries.has(config.id)) return
            const handle = audioReady && config.addSound ? armPairedSound(audio, config) : null
            entries.set(config.id, { config, soundHandle: handle, soundGain: 0 })
        },
        onDespawned(config: WeatherZoneRuntimeConfig) {
            const entry = entries.get(config.id)
            if (!entry) return
            entry.soundHandle?.stop(fadeOut)
            entries.delete(config.id)
        },
    }

    function armEntriesAudio(): void {
        // Once the audio gate resolves, retroactively arm sounds for
        // already-spawned entries. Zones spawned after this point pick
        // up audio in onSpawned directly.
        for (const entry of entries.values()) {
            if (entry.soundHandle || !entry.config.addSound) continue
            entry.soundHandle = armPairedSound(audio, entry.config)
        }
    }

    const system: System = {
        name: 'visualFxZones',
        order: RenderOrder.cameraFollow + 3,
        init() {
            controller.spawnEnabled(hooks)
            if (opts.audioReady) {
                void opts.audioReady.then(() => {
                    audioReady = true
                    armEntriesAudio()
                }).catch((err) => {
                    console.warn('Visual FX zones starting without paired audio:', err)
                    audioReady = true
                })
            }
            if (opts.warmupShaders) {
                void fx.warmShaders(opts.warmupShaders, cameraProvider()).catch((err) => {
                    console.warn('Visual FX zones shader warmup failed:', err)
                })
            }
        },
        update(world, dt) {
            if (disposed) return
            elapsed += dt
            fx.update(dt, cameraProvider())
            queueThunderEvents(world, fx, entries, pendingThunder, elapsed, tmpThunderPos)
            playDueThunder(audio, pendingThunder, elapsed)
            updatePairedSoundGains(world, entries, dt)
        },
        dispose() {
            if (disposed) return
            disposed = true
            controller.despawnAll(hooks)
            pendingThunder.length = 0
            fx.dispose()
        },
    }
    return Object.assign(system, { controller })
}

/** Backward-compatible wrapper for old callers. Prefer the explicit
 *  `createEnvironmentFxSystem` + `createVisualFxZoneSystem` split. */
export function createWeatherZoneSystem(
    scene: Scene,
    audio: AudioEngine,
    zones: readonly WeatherZoneRuntimeConfig[],
    ambient: AmbientWeatherRuntimeConfig | undefined,
    cameraProvider: () => Camera,
    opts: WeatherZoneSystemOptions = {},
): System {
    if (ambient && zones.length === 0) return createEnvironmentFxSystem(scene, ambient, cameraProvider)
    if (!ambient) return createVisualFxZoneSystem(scene, audio, zones, cameraProvider, opts)

    const environment = createEnvironmentFxSystem(scene, ambient, cameraProvider)
    const zoneFx = createVisualFxZoneSystem(scene, audio, zones, cameraProvider, opts)
    return {
        name: 'environmentAndVisualFx',
        order: RenderOrder.cameraFollow + 2,
        init(world) {
            environment.init?.(world)
            zoneFx.init?.(world)
        },
        update(world, dt) {
            environment.update(world, dt)
            zoneFx.update(world, dt)
        },
        dispose() {
            zoneFx.dispose?.()
            environment.dispose?.()
        },
    }
}

function armPairedSound(audio: AudioEngine, config: WeatherZoneRuntimeConfig): SoundHandle | null {
    const id = config.soundId || defaultSoundForPreset(config.presetId)
    if (!id) return null
    try {
        // Visual FX zone loops are broad ambience. Panning a rain/fire
        // bed from a moving point source is brittle with an isometric
        // listener and can turn into corner-biased or staccato audio
        // after camera/player motion. Keep the loop stereo and let the
        // zone system drive locality with proximity-faded gain.
        return audio.play(id, {
            deferUntilUnlocked: true,
            loop: true,
            volume: 0,
            // Same hardening as sound zones — many Visual FX zones in a
            // level may share one looped asset and the manifest's
            // `maxInstances` cap would otherwise steal voices silently.
            maxInstances: Number.POSITIVE_INFINITY,
            priority: 5,
        })
    } catch (err) {
        console.warn(`Visual FX zone "${config.label ?? config.id}" paired sound "${id}" failed:`, err)
        return null
    }
}

function updatePairedSoundGains(
    world: Parameters<NonNullable<System['update']>>[0],
    entries: Map<string, ZoneEntry>,
    dt: number,
): void {
    if (entries.size === 0) return

    const players = query(world, [Position, PlayerControlled])
    const pid = players[0]
    const hasPlayer = pid !== undefined
    const px = hasPlayer ? Position.x[pid]! : 0
    const py = hasPlayer ? Position.y[pid]! : 0
    const pz = hasPlayer ? Position.z[pid]! : 0
    const alpha = 1 - Math.exp(-Math.max(0, dt) * 8)

    for (const entry of entries.values()) {
        const handle = entry.soundHandle
        if (!handle) continue
        const target = hasPlayer
            ? clamp(entry.config.soundVolume, 0, 1) * zoneAudioProximity(entry.config, px, py, pz)
            : 0
        entry.soundGain += (target - entry.soundGain) * alpha
        if (Math.abs(entry.soundGain - target) < 0.004) entry.soundGain = target
        handle.setVolume(entry.soundGain, 0)
    }
}

function queueThunderEvents(
    world: Parameters<NonNullable<System['update']>>[0],
    fx: WeatherSystem,
    entries: Map<string, ZoneEntry>,
    pending: PendingThunder[],
    now: number,
    tmp: Vector3,
): void {
    const player = playerPosition(world)
    for (const entry of entries.values()) {
        const fxZone = fx.getZone(entry.config.id)
        if (!fxZone) continue
        const events = fxZone.runtime.events
        if (events.length === 0) continue
        const drained = events.splice(0)
        if (!entry.config.addSound) continue

        for (const event of drained) {
            if (event.type !== 'lightning-strike') continue
            tmp.set(event.localPosition.x, event.localPosition.y, event.localPosition.z)
            fxZone.group.localToWorld(tmp)
            const pos = { x: tmp.x, y: tmp.y, z: tmp.z }
            const distance = player ? Math.hypot(pos.x - player.x, pos.y - player.y, pos.z - player.z) : 24
            pending.push({
                playAt: now + thunderDelayForDistance(distance),
                position: pos,
                volume: thunderVolumeForZone(entry.config.soundVolume, distance),
            })
        }
    }
}

function playDueThunder(audio: AudioEngine, pending: PendingThunder[], now: number): void {
    for (let i = pending.length - 1; i >= 0; i--) {
        const thunder = pending[i]!
        if (thunder.playAt > now) continue
        try {
            audio.playSpatial(GameAudio.Thunder, thunder.position, {
                deferUntilUnlocked: true,
                volume: thunder.volume,
                rate: 0.94 + Math.random() * 0.1,
                refDistance: 7,
                maxDistance: 96,
                rolloffModel: 'linear',
                panningModel: 'equalpower',
                priority: 7,
            })
        } catch (err) {
            console.warn('Lightning thunder failed:', err)
        }
        pending.splice(i, 1)
    }
}

function playerPosition(world: Parameters<NonNullable<System['update']>>[0]): { x: number; y: number; z: number } | null {
    const players = query(world, [Position, PlayerControlled])
    const pid = players[0]
    if (pid === undefined) return null
    return {
        x: Position.x[pid]!,
        y: Position.y[pid]! + 0.9,
        z: Position.z[pid]!,
    }
}

function zoneAudioProximity(config: WeatherZoneRuntimeConfig, x: number, y: number, z: number): number {
    const hx = Math.max(0.5, config.size.x * 0.5)
    const hy = Math.max(0.5, config.size.y * 0.5)
    const hz = Math.max(0.5, config.size.z * 0.5)
    const dx = Math.max(Math.abs(x - config.position.x) - hx, 0)
    const dy = Math.max(Math.abs(y - config.position.y) - hy, 0)
    const dz = Math.max(Math.abs(z - config.position.z) - hz, 0)
    const dist = Math.hypot(dx, dy, dz)
    if (dist <= 0) return 1
    const fadeDistance = zoneAudioFadeDistance(config)
    return clamp(1 - dist / fadeDistance, 0, 1)
}

function zoneAudioFadeDistance(config: WeatherZoneRuntimeConfig): number {
    return Math.max(4, Math.hypot(config.size.x, config.size.y, config.size.z) * 0.75)
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}

// Re-exports so existing callers don't have to know about the split.
export {
    defaultSoundForPreset,
    type AmbientWeatherRuntimeConfig,
    type WeatherZoneRuntimeConfig,
} from './weather-config'
export { WEATHER_PRESETS } from '../engine/fx'
export type { EffectType }

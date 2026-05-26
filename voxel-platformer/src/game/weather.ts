import { Vector3, type Camera, type Scene } from 'three'
import { query } from 'bitecs'
import {
    WeatherSystem,
    WEATHER_PRESETS,
    applyZonePreset,
    type EffectType,
    type WeatherZone,
    type WeatherZoneParams,
} from '../engine/fx'
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
}

interface ZoneEntry {
    config: WeatherZoneRuntimeConfig
    fxZone: WeatherZone
    soundHandle: SoundHandle | null
    soundGain: number
}

interface PendingThunder {
    playAt: number
    position: { x: number; y: number; z: number }
    volume: number
}

/** Level-wide visual environment: sky dome, fog, sun/ambient light,
 *  camera-following rain/snow/clouds, and lightning flashes. */
export function createEnvironmentFxSystem(
    scene: Scene,
    ambient: AmbientWeatherRuntimeConfig | undefined,
    cameraProvider: () => Camera,
): System {
    if (!ambient) return { name: 'environmentFx', update: () => {} }

    const fx = new WeatherSystem(scene, { maxLights: 8, cullDistance: 120 })
    if (ambient) {
        const applied = ambient.presetId && WEATHER_PRESETS[ambient.presetId]
            ? { ...WEATHER_PRESETS[ambient.presetId]!.apply, ...ambient.state }
            : ambient.state
        fx.setAmbient(applied)
    }

    return {
        name: 'environmentFx',
        order: RenderOrder.cameraFollow + 2,
        update(_world, dt) {
            fx.update(dt, cameraProvider())
        },
        dispose() {
            fx.dispose()
        },
    }
}

/**
 * Build a system that owns local Visual FX zones + paired spatial audio.
 * This deliberately disables `WeatherSystem`'s ambient pass so placing a
 * fire/rain/lava volume does not overwrite the level-wide sky/fog/lights.
 */
export function createVisualFxZoneSystem(
    scene: Scene,
    audio: AudioEngine,
    zones: readonly WeatherZoneRuntimeConfig[],
    cameraProvider: () => Camera,
    opts: WeatherZoneSystemOptions = {},
): System {
    if (zones.length === 0) return { name: 'visualFxZones', update: () => {} }

    const fx = new WeatherSystem(scene, { ambient: false, maxLights: 8, cullDistance: 120 })
    const entries: ZoneEntry[] = []
    const pendingThunder: PendingThunder[] = []
    const tmpThunderPos = new Vector3()
    let disposed = false
    let elapsed = 0

    function spawn(): void {
        for (const config of zones) {
            const params = paramsForConfig(config)
            const fxZone = fx.addZone(params)
            const handle = config.addSound ? armPairedSound(audio, config) : null
            entries.push({ config, fxZone, soundHandle: handle, soundGain: 0 })
        }
    }

    return {
        name: 'visualFxZones',
        order: RenderOrder.cameraFollow + 3,
        init() {
            if (opts.audioReady) {
                void opts.audioReady.then(spawn).catch((err) => {
                    console.warn('Visual FX zones starting without paired audio:', err)
                    // Build FX anyway — particles don't need the audio
                    // engine; only the paired sounds will be missing.
                    for (const config of zones) {
                        const fxZone = fx.addZone(paramsForConfig(config))
                        entries.push({ config, fxZone, soundHandle: null, soundGain: 0 })
                    }
                })
            } else {
                spawn()
            }
        },
        update(world, dt) {
            if (disposed) return
            elapsed += dt
            fx.update(dt, cameraProvider())
            queueThunderEvents(world, entries, pendingThunder, elapsed, tmpThunderPos)
            playDueThunder(audio, pendingThunder, elapsed)
            updatePairedSoundGains(world, entries, dt)
        },
        dispose() {
            if (disposed) return
            disposed = true
            const fade = Math.max(0, opts.fadeOut ?? 0.2)
            for (const entry of entries) entry.soundHandle?.stop(fade)
            entries.length = 0
            pendingThunder.length = 0
            fx.dispose()
        },
    }
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

function paramsForConfig(config: WeatherZoneRuntimeConfig): WeatherZoneParams {
    return applyZonePreset(config.presetId, {
        id: config.id,
        name: config.label ?? config.presetId,
        position: { ...config.position },
        size: { ...config.size },
    })
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
    entries: ZoneEntry[],
    dt: number,
): void {
    if (entries.length === 0) return

    const players = query(world, [Position, PlayerControlled])
    const pid = players[0]
    const hasPlayer = pid !== undefined
    const px = hasPlayer ? Position.x[pid]! : 0
    const py = hasPlayer ? Position.y[pid]! : 0
    const pz = hasPlayer ? Position.z[pid]! : 0
    const alpha = 1 - Math.exp(-Math.max(0, dt) * 8)

    for (const entry of entries) {
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
    entries: ZoneEntry[],
    pending: PendingThunder[],
    now: number,
    tmp: Vector3,
): void {
    const player = playerPosition(world)
    for (const entry of entries) {
        const events = entry.fxZone.runtime.events
        if (events.length === 0) continue
        const drained = events.splice(0)
        if (!entry.config.addSound) continue

        for (const event of drained) {
            if (event.type !== 'lightning-strike') continue
            tmp.set(event.localPosition.x, event.localPosition.y, event.localPosition.z)
            entry.fxZone.group.localToWorld(tmp)
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

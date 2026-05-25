import type { Camera, Scene } from 'three'
import {
    WeatherSystem,
    WEATHER_PRESETS,
    applyZonePreset,
    type EffectType,
    type WeatherZone,
    type WeatherZoneParams,
} from '../engine/fx'
import type { AudioEngine, SoundHandle } from '../engine/audio'
import type { System } from '../engine/ecs/systems/system'
import { RenderOrder } from '../engine/ecs/systems/orders'
import {
    defaultSoundForPreset,
    type AmbientWeatherRuntimeConfig,
    type WeatherZoneRuntimeConfig,
} from './weather-config'

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
}

/**
 * Build a system that owns a `WeatherSystem` + paired ambient audio
 * for every editor-authored weather zone. `cameraProvider` is a thunk
 * so the caller can swap cameras without rebuilding.
 *
 * Order: `RenderOrder.cameraFollow + 3` — same idiom as
 * `audio-listener-system`, so the camera transform is settled before
 * the FX system reads it for culling + matrix writes.
 */
export function createWeatherZoneSystem(
    scene: Scene,
    audio: AudioEngine,
    zones: readonly WeatherZoneRuntimeConfig[],
    ambient: AmbientWeatherRuntimeConfig | undefined,
    cameraProvider: () => Camera,
    opts: WeatherZoneSystemOptions = {},
): System {
    // Skip the entire FX stack when the level has nothing to play.
    // Instantiating `WeatherSystem` adds a sky dome + fog + ambient
    // light + sun + hemi light to the scene as part of its
    // `AmbientWeather` constructor — that would visually clobber any
    // level (demo + editor-authored) that doesn't opt into weather.
    if (zones.length === 0 && !ambient) {
        return { name: 'weatherZones', update: () => {} }
    }

    const fx = new WeatherSystem(scene)
    if (ambient) {
        const applied = ambient.presetId && WEATHER_PRESETS[ambient.presetId]
            ? { ...WEATHER_PRESETS[ambient.presetId]!.apply, ...ambient.state }
            : ambient.state
        fx.setAmbient(applied)
    }
    const entries: ZoneEntry[] = []
    let disposed = false

    function spawn(): void {
        for (const config of zones) {
            const params = paramsForConfig(config)
            const fxZone = fx.addZone(params)
            const handle = config.addSound ? armPairedSound(audio, config) : null
            entries.push({ config, fxZone, soundHandle: handle })
        }
    }

    return {
        name: 'weatherZones',
        order: RenderOrder.cameraFollow + 3,
        init() {
            if (opts.audioReady) {
                void opts.audioReady.then(spawn).catch((err) => {
                    console.warn('Weather zones starting without paired audio:', err)
                    // Build FX anyway — particles don't need the audio
                    // engine; only the paired sounds will be missing.
                    for (const config of zones) {
                        const fxZone = fx.addZone(paramsForConfig(config))
                        entries.push({ config, fxZone, soundHandle: null })
                    }
                })
            } else {
                spawn()
            }
        },
        update(_world, dt) {
            if (disposed) return
            fx.update(dt, cameraProvider())
        },
        dispose() {
            if (disposed) return
            disposed = true
            const fade = Math.max(0, opts.fadeOut ?? 0.2)
            for (const entry of entries) entry.soundHandle?.stop(fade)
            entries.length = 0
            fx.dispose()
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
    const diag = Math.hypot(config.size.x, config.size.y, config.size.z)
    const maxDistance = Math.max(4, diag * 1.6)
    const refDistance = Math.max(1, diag * 0.5)
    try {
        return audio.playSpatial(id, config.position, {
            deferUntilUnlocked: true,
            loop: true,
            volume: clamp(config.soundVolume, 0, 1),
            // Same hardening as sound zones — many weather zones in a
            // level may share one looped asset and the manifest's
            // `maxInstances` cap would otherwise steal voices silently.
            maxInstances: Number.POSITIVE_INFINITY,
            priority: 5,
            maxDistance,
            refDistance,
            rolloffModel: 'linear',
        })
    } catch (err) {
        console.warn(`Weather zone "${config.label ?? config.id}" paired sound "${id}" failed:`, err)
        return null
    }
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

import type { AmbientWeatherState } from '../engine/fx/core/types'
import { GameAudio } from './audio'

export const DEFAULT_OUTDOOR_FOG_DENSITY_MUL = 0.45

/**
 * Plain-data side of the visual FX/environment integration. Splitting it out from
 * `weather.ts` (which owns the `WeatherSystem` runtime) keeps the
 * editor + level-translation paths free of three/webgpu deps so the
 * test runner can build them under plain `node`.
 */

/**
 * Editor-authored local Visual FX zone, translated from `EditorWeatherZone`
 * by `level-from-meta`. Pairs the FX preset id with optional looped
 * sound. `position` is the AABB **centre** (matches the FX system).
 */
export interface WeatherZoneRuntimeConfig {
    id: string
    label?: string
    /** Preset id from `ZONE_PRESETS` (rain/storm/fire/magic/...). */
    presetId: string
    position: { x: number; y: number; z: number }
    size: { x: number; y: number; z: number }
    /** Starts live by default. Scripts can toggle authored zones through
     *  `weather.setZoneEnabled`; set false for effects that a quest opens. */
    enabled?: boolean
    /** Whether the runtime should play a paired ambient bed at the
     *  zone's position. The editor's "Add sound" checkbox controls this. */
    addSound: boolean
    /** Optional override for the paired sound id. When falsy the
     *  runtime picks a default via `defaultSoundForPreset`. */
    soundId?: string
    soundVolume: number
}

/** Snapshot of `AmbientWeatherState` — single level-wide weather bed. */
export interface AmbientWeatherRuntimeConfig {
    /** Preset id the level was authored from (`WEATHER_PRESETS` key).
     *  The state field is the *resolved* snapshot so a level can be
     *  authored by tweaking a preset and play back identically. */
    presetId?: string
    state: Partial<AmbientWeatherState>
}

/**
 * Map a zone preset id to the looped ambient sound that fits it.
 * Returns `null` for presets that are inherently one-shot
 * (explosion) or where no matching ambient bed exists.
 */
export function defaultSoundForPreset(presetId: string): string | null {
    switch (presetId) {
        case 'rain':         return GameAudio.AmbRain
        case 'storm':        return GameAudio.AmbStorm
        case 'snow':         return GameAudio.AmbWind
        case 'fog':          return GameAudio.AmbWind
        case 'sandstorm':    return GameAudio.AmbWind
        case 'embers':       return GameAudio.AmbFire
        case 'magic':        return GameAudio.AmbMagic
        case 'fire':         return GameAudio.AmbFire
        case 'fireTornado':  return GameAudio.AmbFire
        case 'leaves':       return GameAudio.AmbWind
        case 'lightning':    return GameAudio.AmbStorm
        case 'boiling':      return GameAudio.AmbWater
        case 'firefly':      return GameAudio.AmbMagic
        case 'water':        return GameAudio.AmbWater
        case 'lava':         return GameAudio.AmbLava
        case 'explosion':    return null
        default:             return null
    }
}

export function thunderDelayForDistance(distance: number): number {
    if (!Number.isFinite(distance)) return 0.35
    // Game units are compact, so use an intentionally faster-than-real
    // delay: close strikes feel immediate; distant strikes still lag enough
    // to read as thunder following the flash.
    return clamp(distance / 80, 0.12, 1.6)
}

export function thunderVolumeForZone(zoneVolume: number, distance: number): number {
    const authored = clamp(zoneVolume, 0, 1)
    const distanceDamping = 1 - clamp((distance - 18) / 90, 0, 0.45)
    return clamp(Math.max(0.42, authored * 1.35) * distanceDamping, 0, 1)
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.max(min, Math.min(max, value))
}

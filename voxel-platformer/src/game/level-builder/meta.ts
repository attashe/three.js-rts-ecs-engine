/**
 * LevelMeta authoring helpers - defaults, ambient presets, zone math.
 *
 * `LevelMeta` is an 18-field record; most procedural levels leave 7+ of
 * those fields empty and repeat a near-identical ambient-weather block.
 * `defineLevel` supplies the empty defaults so a level literal carries
 * only what's meaningful, `outdoorDay` collapses the ambient block to one
 * call with overrides, and `zoneBox` / `interactZone` derive AABB min/max
 * (and an interaction anchor) from a center so authors stop hand-writing
 * `+/-0.25` insets.
 */

import type { AmbientWeatherState } from '../../engine/fx/core/types'
import type { Zone } from '../../engine/ecs/zones'
import type { RailCartConfig } from '../../engine/ecs/world'
import type { AmbientWeatherRuntimeConfig } from '../weather-config'
import { DEFAULT_OUTDOOR_FOG_DENSITY_MUL } from '../weather-config'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '../player-settings'
import type { CoinPileSpawn, LevelMeta } from '../level'
import type { PistonMechanismConfig } from '../mechanisms'
import type { StoneFallSpawnerConfig, StonePlacementConfig } from '../moving-objects'
import type { EnvironmentConfig, SoundSourceConfig, SoundZoneConfig } from '../sound-sources'
import type { WeatherZoneRuntimeConfig } from '../weather-config'
import type { EditorProp } from '../props/prop-types'
import type { NpcConfig } from '../npcs/npc-types'
import type { ScriptEntry } from '../../engine/script/types'

interface XZ {
    x: number
    z: number
}

/** Everything `defineLevel` accepts. `name`, `size`, and `spawn` are
 *  required; every list field defaults to empty, `player` to
 *  `DEFAULT_PLAYER_SETTINGS`, and `environment` / `ambientWeather` stay
 *  absent unless given. `ambient` is a short alias for `ambientWeather`. */
export interface LevelSpec {
    name: string
    size: number
    spawn: { x: number; y: number; z: number }
    player?: PlayerSettings
    stoneSpawners?: StoneFallSpawnerConfig[]
    stones?: StonePlacementConfig[]
    coinPiles?: CoinPileSpawn[]
    pistons?: PistonMechanismConfig[]
    zones?: Zone[]
    soundSources?: SoundSourceConfig[]
    railCarts?: RailCartConfig[]
    soundZones?: SoundZoneConfig[]
    environment?: EnvironmentConfig
    weatherZones?: WeatherZoneRuntimeConfig[]
    props?: EditorProp[]
    npcs?: NpcConfig[]
    scripts?: ScriptEntry[]
    /** Alias for {@link ambientWeather}. When both are given,
     *  `ambientWeather` wins. */
    ambient?: AmbientWeatherRuntimeConfig
    ambientWeather?: AmbientWeatherRuntimeConfig
}

/** Build a complete `LevelMeta`, filling the empty/optional defaults so a
 *  level literal only states what's non-empty. */
export function defineLevel(spec: LevelSpec): LevelMeta {
    return {
        name: spec.name,
        spawn: spec.spawn,
        player: spec.player ?? DEFAULT_PLAYER_SETTINGS,
        stoneSpawners: spec.stoneSpawners ?? [],
        stones: spec.stones ?? [],
        coinPiles: spec.coinPiles ?? [],
        pistons: spec.pistons ?? [],
        zones: spec.zones ?? [],
        soundSources: spec.soundSources ?? [],
        railCarts: spec.railCarts ?? [],
        soundZones: spec.soundZones ?? [],
        environment: spec.environment,
        weatherZones: spec.weatherZones ?? [],
        props: spec.props ?? [],
        npcs: spec.npcs ?? [],
        scripts: spec.scripts ?? [],
        ambientWeather: spec.ambientWeather ?? spec.ambient,
        size: spec.size,
    }
}

/** Resolved clear-sky outdoor day with an animated cycle. Pass overrides
 *  for the few fields that vary per level (`timeOfDay`, `skyTint`,
 *  `sunIntensityMul`, `cloudCoverage`, etc.). */
export function outdoorDay(overrides: Partial<AmbientWeatherState> = {}): AmbientWeatherRuntimeConfig {
    return {
        presetId: 'clear',
        state: {
            mode: 'outdoor',
            timeOfDay: 8.0,
            cycleEnabled: true,
            cycleSeconds: 420,
            skyTint: [1, 1, 1],
            sunIntensityMul: 1,
            fogDensityMul: DEFAULT_OUTDOOR_FOG_DENSITY_MUL,
            cloudCoverage: 0.12,
            rainOn: false,
            snowOn: false,
            lightningOn: false,
            ...overrides,
        },
    }
}

/** AABB min/max for a zone centered at `center` with the given XZ
 *  half-extents and explicit Y bounds. Replaces hand-written `+/-half`
 *  insets. */
export function zoneBox(
    center: XZ,
    half: XZ,
    yLo: number,
    yHi: number,
): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
    return {
        min: { x: center.x - half.x, y: yLo, z: center.z - half.z },
        max: { x: center.x + half.x, y: yHi, z: center.z + half.z },
    }
}

export interface InteractZoneSpec {
    id: string
    label?: string
    /** XZ center of the volume (usually the matching prop's position). */
    center: XZ
    /** XZ half-extents of the volume. */
    half: XZ
    /** Y bounds of the volume. */
    yLo: number
    yHi: number
    /** Interaction prompt text. */
    prompt?: string
    /** Interaction radius from the anchor. */
    radius?: number
    /** Anchor height above `yLo` (anchor sits at `center.x/z`). Default
     *  centers the anchor between `yLo` and `yHi`. */
    anchorDy?: number
}

/** A `kind: 'interact'` zone whose AABB and interaction anchor are both
 *  derived from one center - the keeper / sundial / shrine pattern that
 *  otherwise repeats the same coordinate three times. */
export function interactZone(spec: InteractZoneSpec): Zone {
    const anchorDy = spec.anchorDy ?? (spec.yHi - spec.yLo) / 2
    return {
        id: spec.id,
        kind: 'interact',
        label: spec.label,
        ...zoneBox(spec.center, spec.half, spec.yLo, spec.yHi),
        interaction: {
            prompt: spec.prompt,
            anchor: { x: spec.center.x, y: spec.yLo + anchorDy, z: spec.center.z },
            radius: spec.radius,
        },
    }
}

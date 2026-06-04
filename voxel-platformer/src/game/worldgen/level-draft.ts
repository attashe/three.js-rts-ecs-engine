import type { Zone } from '../../engine/ecs/zones'
import type { RailCartConfig } from '../../engine/ecs/world'
import type { ScriptEntry } from '../../engine/script/types'
import type { Cinematic } from '../cinematics/cinematic-types'
import type { LevelMeta, CoinPileSpawn } from '../level'
import { defineLevel } from '../level-builder'
import type { PistonMechanismConfig } from '../mechanisms'
import type { StoneFallSpawnerConfig, StonePlacementConfig } from '../moving-objects'
import type { NpcConfig } from '../npcs/npc-types'
import type { PlayerSettings } from '../player-settings'
import type { EditorProp } from '../props/prop-types'
import type { EnvironmentConfig, SoundSourceConfig, SoundZoneConfig } from '../sound-sources'
import type { AmbientWeatherRuntimeConfig, WeatherZoneRuntimeConfig } from '../weather-config'
import type { VoxelCoord } from './spec-types'

export interface WorldgenLevelDraftInit {
    name: string
    size: number
    spawn: VoxelCoord
    player?: PlayerSettings
    environment?: EnvironmentConfig
    ambientWeather?: AmbientWeatherRuntimeConfig
}

export class WorldgenLevelDraft {
    name: string
    size: number
    spawn: VoxelCoord
    player?: PlayerSettings
    stoneSpawners: StoneFallSpawnerConfig[] = []
    stones: StonePlacementConfig[] = []
    coinPiles: CoinPileSpawn[] = []
    pistons: PistonMechanismConfig[] = []
    zones: Zone[] = []
    soundSources: SoundSourceConfig[] = []
    railCarts: RailCartConfig[] = []
    soundZones: SoundZoneConfig[] = []
    environment?: EnvironmentConfig
    weatherZones: WeatherZoneRuntimeConfig[] = []
    props: EditorProp[] = []
    npcs: NpcConfig[] = []
    scripts: ScriptEntry[] = []
    cinematics?: Cinematic[]
    ambientWeather?: AmbientWeatherRuntimeConfig

    constructor(init: WorldgenLevelDraftInit) {
        this.name = init.name
        this.size = init.size
        this.spawn = init.spawn
        this.player = init.player
        this.environment = init.environment
        this.ambientWeather = init.ambientWeather
    }

    toMeta(): LevelMeta {
        return defineLevel({
            name: this.name,
            size: this.size,
            spawn: this.spawn,
            player: this.player,
            stoneSpawners: this.stoneSpawners,
            stones: this.stones,
            coinPiles: this.coinPiles,
            pistons: this.pistons,
            zones: this.zones,
            soundSources: this.soundSources,
            railCarts: this.railCarts,
            soundZones: this.soundZones,
            environment: this.environment,
            weatherZones: this.weatherZones,
            props: this.props,
            npcs: this.npcs,
            scripts: this.scripts,
            cinematics: this.cinematics,
            ambientWeather: this.ambientWeather,
        })
    }
}

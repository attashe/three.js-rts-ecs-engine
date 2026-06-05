import type { Zone } from '../../engine/ecs/zones'
import type { RailCartConfig } from '../../engine/ecs/world'
import type { ScriptEntry } from '../../engine/script/types'
import type { Cinematic } from '../cinematics/cinematic-types'
import type { LevelMeta, CoinPileSpawn } from '../level'
import { defineLevel } from '../level-builder'
import type { LevelSpec } from '../level-builder/meta'
import type { PistonMechanismConfig } from '../mechanisms'
import type { StoneFallSpawnerConfig, StonePlacementConfig } from '../moving-objects'
import type { NpcConfig } from '../npcs/npc-types'
import type { PlayerSettings } from '../player-settings'
import type { EditorProp } from '../props/prop-types'
import type { EnvironmentConfig, SoundSourceConfig, SoundZoneConfig } from '../sound-sources'
import type { AmbientWeatherRuntimeConfig, WeatherZoneRuntimeConfig } from '../weather-config'
import type { VoxelCoord } from './spec-types'
import type { LootChestConfig } from '../chests'

export interface WorldgenLevelDraftInit {
    name: string
    size: number
    sizeX?: number
    sizeZ?: number
    spawn: VoxelCoord
    player?: PlayerSettings
    environment?: EnvironmentConfig
    ambientWeather?: AmbientWeatherRuntimeConfig
}

export class WorldgenLevelDraft {
    name: string
    size: number
    sizeX?: number
    sizeZ?: number
    spawn: VoxelCoord
    player?: PlayerSettings
    stoneSpawners: StoneFallSpawnerConfig[] = []
    stones: StonePlacementConfig[] = []
    coinPiles: CoinPileSpawn[] = []
    pistons: PistonMechanismConfig[] = []
    zones: Zone[] = []
    soundSources: SoundSourceConfig[] = []
    railCarts: RailCartConfig[] = []
    chests: LootChestConfig[] = []
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
        this.sizeX = init.sizeX
        this.sizeZ = init.sizeZ
        this.spawn = init.spawn
        this.player = init.player
        this.environment = init.environment
        this.ambientWeather = init.ambientWeather
    }

    toMeta(): LevelMeta {
        return defineLevel({
            name: this.name,
            size: this.size,
            sizeX: this.sizeX,
            sizeZ: this.sizeZ,
            spawn: this.spawn,
            player: this.player,
            stoneSpawners: this.stoneSpawners,
            stones: this.stones,
            coinPiles: this.coinPiles,
            pistons: this.pistons,
            zones: this.zones,
            soundSources: this.soundSources,
            railCarts: this.railCarts,
            chests: this.chests,
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

// Compile-time drift guard. Every field `defineLevel` accepts (i.e. every
// `LevelSpec` field) must have a matching property on `WorldgenLevelDraft`,
// except `ambient` — the alias of `ambientWeather`, which the draft always
// emits directly. If a future `LevelMeta`/`LevelSpec` field is added without
// mirroring it on the draft (and forwarding it in `toMeta`), this resolves to
// the missing field name and the `= true` assignment fails to compile — so
// generated levels can never silently drop a new level field.
type DraftMissingLevelSpecFields = Exclude<keyof Omit<LevelSpec, 'ambient'>, keyof WorldgenLevelDraft>
const _draftCoversLevelSpec: [DraftMissingLevelSpecFields] extends [never] ? true : DraftMissingLevelSpecFields = true
void _draftCoversLevelSpec

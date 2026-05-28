import { hasComponent, query } from 'bitecs'
import type { AudioEngine, AudioManifest, SoundHandle } from '../engine/audio'
import { PlayerControlled, Position, Velocity } from '../engine/ecs/components'
import { pushLog, pushPopupMessage, type GameWorld, type VoxelCoord } from '../engine/ecs/world'
import { isPointInZone, isZoneActive, setZoneActive } from '../engine/ecs/zones'
import { WEATHER_PRESETS, type WeatherSystem } from '../engine/fx'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { createScriptEngineSystem } from '../engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    DayCycleFacade,
    LogFacade,
    PickupsFacade,
    PlayerFacade,
    ScriptEntry,
    TravelFacade,
    FlagValue,
    UiFacade,
    WeatherFacade,
    ZoneFacade,
} from '../engine/script/types'
import { buildLevelFacade, type LevelInfo } from './script-level-facade'
import type { CheckpointStore } from './checkpoint-store'
import type { VisualFxZoneController } from './visual-fx-zone-controller'
import { despawnScriptPickup, scriptPickupExists, spawnScriptPickup } from './pickups'
import {
    applyPlayerSettingsPatch,
    clampBoolean,
    copyPlayerSettings,
    PLAYER_ABILITY_KEYS,
    PLAYER_INVENTORY_LIMITS,
    type PlayerAbilityKey,
    type PlayerSettingsPatch,
} from './player-settings'
import { syncPlayerVisuals } from './player'

export interface GameScriptSystemOptions {
    world: GameWorld
    chunks: ChunkManager
    audio: AudioEngine
    audioManifest: AudioManifest
    /** The WeatherSystem from `createEnvironmentFxSystem`. Required for
     *  the `weather.*` and `dayCycle.*` bindings; pass `null` if the
     *  level has no ambient weather and scripts shouldn't touch it. */
    weatherSystem?: WeatherSystem | null
    /** Controller for level-authored FX zones — backs `weather.setZoneEnabled`
     *  / `setZonePreset` / `isZoneEnabled`. Pass `null` (the default) on
     *  levels with no FX zones; scripts then see the no-op fallback that
     *  returns false. */
    visualFxZones?: VisualFxZoneController | null
    dialogue?: Pick<UiFacade, 'dialogue'>
    travel?: TravelFacade
    /** Source for the `level.spawn / size / name` getters. Narrowed to
     *  the three fields the script API exposes so widening the script
     *  surface requires an explicit type change here, not just a new
     *  field read inside the facade. */
    level: LevelInfo
    /** Persistence layer for `player.setCheckpoint`. Survives the
     *  death-triggered `location.reload()` so the player respawns at
     *  the checkpoint instead of `level.spawn`. */
    checkpointStore: CheckpointStore
    initialFlags?: ReadonlyMap<string, FlagValue>
    getScripts: () => readonly ScriptEntry[]
}

export function createGameScriptSystem(opts: GameScriptSystemOptions) {
    const musicIds = new Set((opts.audioManifest.music ?? []).map((asset) => asset.id))

    const audio: AudioFacade = {
        play(soundId, playOpts) {
            const fade = playOpts?.fade ?? 0
            if (musicIds.has(soundId)) {
                void opts.audio.playMusic(soundId, {
                    volume: playOpts?.volume,
                    loop: playOpts?.loop,
                    crossfade: fade,
                    fadeIn: fade,
                    fadeOut: fade,
                }).catch((err) => {
                    const msg = err instanceof Error ? err.message : String(err)
                    pushLog(opts.world, `[script audio] ${msg}`)
                })
                return { id: soundId, music: true }
            }
            return opts.audio.play(soundId, {
                volume: playOpts?.volume,
                loop: playOpts?.loop,
                fadeIn: fade,
                fadeOut: fade,
                deferUntilUnlocked: true,
            })
        },
        stop(handleOrSoundId, stopOpts) {
            const fade = stopOpts?.fade ?? 0
            if (typeof handleOrSoundId === 'string') {
                if (musicIds.has(handleOrSoundId)) opts.audio.stopMusic(fade)
                return
            }
            if (isSoundHandle(handleOrSoundId)) handleOrSoundId.stop(fade)
        },
    }

    const chunks: ChunksFacade = {
        getBlock: (x, y, z) => opts.chunks.getVoxel(Math.floor(x), Math.floor(y), Math.floor(z)),
        setBlock: (x, y, z, block) => {
            opts.chunks.setVoxel(Math.floor(x), Math.floor(y), Math.floor(z), Math.max(0, Math.floor(block)))
        },
        fillBlocks(min, max, block) {
            const safeBlock = Math.max(0, Math.floor(block))
            const x0 = Math.min(Math.floor(min.x), Math.floor(max.x))
            const x1 = Math.max(Math.floor(min.x), Math.floor(max.x))
            const y0 = Math.min(Math.floor(min.y), Math.floor(max.y))
            const y1 = Math.max(Math.floor(min.y), Math.floor(max.y))
            const z0 = Math.min(Math.floor(min.z), Math.floor(max.z))
            const z1 = Math.max(Math.floor(min.z), Math.floor(max.z))
            opts.chunks.withBulkEdit(() => {
                for (let z = z0; z < z1; z++) {
                    for (let y = y0; y < y1; y++) {
                        for (let x = x0; x < x1; x++) opts.chunks.setVoxel(x, y, z, safeBlock)
                    }
                }
            })
        },
    }

    const player: PlayerFacade = {
        getPosition: () => playerPosition(opts.world),
        getGold: () => opts.world.inventory.gold,
        getArrows: () => opts.world.inventory.arrows,
        getSettings: () => copyPlayerSettings(opts.world.playerSettings),
        setSettings(patch) {
            opts.world.playerSettings = applyPlayerPatch(opts.world, patch)
            syncPlayerVisuals(opts.world)
            return copyPlayerSettings(opts.world.playerSettings)
        },
        setAbility(ability, enabled) {
            if (!isPlayerAbilityKey(ability)) return
            opts.world.playerSettings.abilities[ability] = clampBoolean(enabled, opts.world.playerSettings.abilities[ability])
        },
        setGold(amount) {
            const gold = safeInventoryAmount(amount, opts.world.inventory.gold, PLAYER_INVENTORY_LIMITS.gold)
            opts.world.inventory.gold = gold
            opts.world.playerSettings.inventory.gold = gold
        },
        setArrows(amount) {
            const arrows = safeInventoryAmount(amount, opts.world.inventory.arrows, PLAYER_INVENTORY_LIMITS.arrows)
            opts.world.inventory.arrows = arrows
            opts.world.playerSettings.inventory.arrows = arrows
        },
        teleport(x, y, z) {
            const eid = playerEid(opts.world)
            if (eid === null) return
            Position.x[eid] = x
            Position.y[eid] = y
            Position.z[eid] = z
            if (hasComponent(opts.world, eid, Velocity)) {
                Velocity.x[eid] = 0
                Velocity.y[eid] = 0
                Velocity.z[eid] = 0
            }
        },
        kill(reason) {
            opts.world.deathSignal ??= reason === 'manual-restart'
                ? 'manual-restart'
                : 'killed-by-zone-script'
        },
        getCheckpoint() {
            const live = opts.world.lastCheckpoint
            return live ? { x: live.x, y: live.y, z: live.z } : null
        },
        setCheckpoint(pos) {
            const snapshot = { x: pos.x, y: pos.y, z: pos.z }
            opts.world.lastCheckpoint = snapshot
            opts.checkpointStore.set(snapshot)
        },
        clearCheckpoint() {
            opts.world.lastCheckpoint = null
            opts.checkpointStore.clear()
        },
    }

    const pickups: PickupsFacade = {
        spawn(kind, pos, spawnOpts) {
            return spawnScriptPickup(opts.world, {
                kind,
                position: pos,
                amount: spawnOpts?.amount,
                id: spawnOpts?.id,
                label: spawnOpts?.label,
            })
        },
        despawn(id) { return despawnScriptPickup(opts.world, id) },
        exists(id) { return scriptPickupExists(opts.world, id) },
    }

    const zone: ZoneFacade = {
        contains(zoneId, who) {
            const z = opts.world.zones.get(zoneId)
            if (!z) return false
            const point = who === 'player' || who === undefined
                ? playerPosition(opts.world)
                : who
            return point !== null && isPointInZone(z, point)
        },
        exists(zoneId) {
            return opts.world.zones.has(zoneId)
        },
        isActive(zoneId) {
            const z = opts.world.zones.get(zoneId)
            return z !== undefined && isZoneActive(z)
        },
        setActive(zoneId, active) {
            return setZoneActive(opts.world, zoneId, active)
        },
    }

    const log: LogFacade = {
        log(message) {
            const trimmed = message.trim()
            if (trimmed) pushLog(opts.world, trimmed)
        },
    }

    // Weather + day-cycle bindings are wired only when an ambient
    // weather system exists for the level. Scripts that try to call
    // `weather.setRain(...)` on a level with no ambient see the
    // no-op fallback in bindings.ts.
    const weather = opts.weatherSystem
        ? buildWeatherFacade(opts.weatherSystem, opts.visualFxZones ?? null)
        : undefined
    const dayCycle = opts.weatherSystem ? buildDayCycleFacade(opts.weatherSystem) : undefined
    const level = buildLevelFacade(opts.level)

    return createScriptEngineSystem({
        audio,
        chunks,
        player,
        pickups,
        zone,
        log,
        ui: {
            say(targetId, message, sayOpts) {
                pushPopupMessage(opts.world, {
                    targetId,
                    message,
                    seconds: sayOpts?.seconds,
                })
            },
            dialogue(request) {
                return opts.dialogue?.dialogue?.(request) ?? Promise.resolve({})
            },
        },
        dayCycle,
        weather,
        travel: opts.travel,
        level,
        getScripts: opts.getScripts,
        initialFlags: opts.initialFlags,
        onScriptError: (entry, where, err) => {
            const msg = err instanceof Error ? err.message : String(err)
            pushLog(opts.world, `[script:${entry.name}] ${msg}`)
            console.error(`[script ${entry.name} @ ${where}]`, err)
        },
    })
}

function applyPlayerPatch(world: GameWorld, patch: PlayerSettingsPatch) {
    const next = applyPlayerSettingsPatch(world.playerSettings, patch)
    world.inventory.gold = next.inventory.gold
    world.inventory.arrows = next.inventory.arrows
    return next
}

function safeInventoryAmount(value: number, fallback: number, max: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback
}

function isPlayerAbilityKey(value: string): value is PlayerAbilityKey {
    return (PLAYER_ABILITY_KEYS as readonly string[]).includes(value)
}

function buildDayCycleFacade(weather: WeatherSystem): DayCycleFacade {
    return {
        getHour() {
            return readAmbientField(weather, 'timeOfDay', 12)
        },
        setHour(hour) {
            const wrapped = wrapHour(hour)
            weather.ambient.setState({ timeOfDay: wrapped })
        },
        isEnabled() {
            return readAmbientField(weather, 'cycleEnabled', false) === true
        },
        setEnabled(on) {
            weather.ambient.setState({ cycleEnabled: on })
        },
        setSpeed(sec) {
            const safe = Number.isFinite(sec) ? Math.max(1, sec) : 120
            weather.ambient.setState({ cycleSeconds: safe })
        },
    }
}

function buildWeatherFacade(weather: WeatherSystem, zones: VisualFxZoneController | null): WeatherFacade {
    return {
        setRain(on) { weather.ambient.setState({ rainOn: on }) },
        setSnow(on) { weather.ambient.setState({ snowOn: on }) },
        setLightning(on) { weather.ambient.setState({ lightningOn: on }) },
        applyPreset(presetId) {
            const preset = WEATHER_PRESETS[presetId]
            if (!preset) return false
            weather.ambient.setState(preset.apply)
            return true
        },
        setZoneEnabled(zoneId, on) { return zones?.setZoneEnabled(zoneId, on) ?? false },
        isZoneEnabled(zoneId) { return zones?.isZoneEnabled(zoneId) ?? false },
        setZonePreset(zoneId, presetId) { return zones?.setZonePreset(zoneId, presetId) ?? false },
    }
}

function wrapHour(hour: number): number {
    if (!Number.isFinite(hour)) return 12
    const m = hour % 24
    return m < 0 ? m + 24 : m
}

function readAmbientField<K extends 'timeOfDay' | 'cycleEnabled'>(
    weather: WeatherSystem,
    field: K,
    fallback: K extends 'timeOfDay' ? number : boolean,
): K extends 'timeOfDay' ? number : boolean {
    // The DisabledAmbientWeather branch has no `state`; widen via
    // unknown before narrowing so we don't lie about the type when
    // ambient was turned off.
    const ambient = weather.ambient as unknown as { state?: Record<string, unknown> }
    const value = ambient.state?.[field]
    if (field === 'timeOfDay') {
        return (typeof value === 'number' && Number.isFinite(value) ? value : fallback) as K extends 'timeOfDay' ? number : boolean
    }
    return (typeof value === 'boolean' ? value : fallback) as K extends 'timeOfDay' ? number : boolean
}

function playerEid(world: GameWorld): number | null {
    const players = query(world, [PlayerControlled, Position])
    return players.length > 0 ? players[0]! : null
}

function playerPosition(world: GameWorld): VoxelCoord | null {
    const eid = playerEid(world)
    if (eid === null) return null
    return { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] }
}

function isSoundHandle(value: unknown): value is SoundHandle {
    return typeof value === 'object' && value !== null && typeof (value as { stop?: unknown }).stop === 'function'
}

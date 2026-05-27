import { hasComponent, query } from 'bitecs'
import type { AudioEngine, AudioManifest, SoundHandle } from '../engine/audio'
import { PlayerControlled, Position, Velocity } from '../engine/ecs/components'
import { pushLog, pushPopupMessage, type GameWorld, type VoxelCoord } from '../engine/ecs/world'
import { isPointInZone } from '../engine/ecs/zones'
import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { createScriptEngineSystem } from '../engine/script/script-engine-system'
import type {
    AudioFacade,
    ChunksFacade,
    LogFacade,
    PickupsFacade,
    PlayerFacade,
    ScriptEntry,
    ZoneFacade,
} from '../engine/script/types'
import { spawnScriptPickup } from './pickups'

export interface GameScriptSystemOptions {
    world: GameWorld
    chunks: ChunkManager
    audio: AudioEngine
    audioManifest: AudioManifest
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
    }

    const log: LogFacade = {
        log(message) {
            const trimmed = message.trim()
            if (trimmed) pushLog(opts.world, trimmed)
        },
    }

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
        },
        getScripts: opts.getScripts,
        onScriptError: (entry, where, err) => {
            const msg = err instanceof Error ? err.message : String(err)
            pushLog(opts.world, `[script:${entry.name}] ${msg}`)
            console.error(`[script ${entry.name} @ ${where}]`, err)
        },
    })
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

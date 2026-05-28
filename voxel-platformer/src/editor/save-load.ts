import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK, DEFAULT_PALETTE } from '../engine/voxel/palette'
import { deserializeLevel, serializeLevel } from '../engine/voxel/level-serializer'
import { copyScriptEntry, copyStoneSpawner, copyZoneScriptAction, DEFAULT_AMBIENT_WEATHER, type EditorState, type EditorLevelMeta } from './editor-state'
import { normalizeNpcConfig } from '../game/npcs/npc-types'
import { copyPlayerSettings, DEFAULT_PLAYER_SETTINGS, normalizePlayerSettings } from '../game/player-settings'
import { spawnPickupPreview } from './systems/pickup-spawn-system'
import { toLevelMeta } from './editor-state'
import { despawnEntity } from '../engine/ecs/entity'
import type { GameWorld } from '../engine/ecs/world'
import { registerPistonMechanism } from '../game/mechanisms'

/** Default ground height for a fresh pad. Dirt foundation up to `PAD_Y - 1`,
 *  grass at `PAD_Y`, spawn one cell above. */
export const NEW_LEVEL_DEFAULT_PAD_Y = 4
export const NEW_LEVEL_DEFAULT_WIDTH = 12
export const NEW_LEVEL_DEFAULT_DEPTH = 12
export const NEW_LEVEL_MAX_DIMENSION = 64

/**
 * Wipe the current world + editor state and seed a fresh dirt + grass pad
 * of the given XZ dimensions. Same shape the editor uses on first launch,
 * just with caller-chosen `width` × `depth`. Spawn is recentered, all
 * placed pickups / pistons / zones / sound sources / sound zones are torn
 * down, and the working plane snaps to the new ground row.
 */
export function newLevel(
    world: GameWorld,
    chunks: ChunkManager,
    editorState: EditorState,
    width: number = NEW_LEVEL_DEFAULT_WIDTH,
    depth: number = NEW_LEVEL_DEFAULT_DEPTH,
): void {
    const w = Math.max(1, Math.min(NEW_LEVEL_MAX_DIMENSION, Math.floor(width)))
    const d = Math.max(1, Math.min(NEW_LEVEL_MAX_DIMENSION, Math.floor(depth)))
    const padY = NEW_LEVEL_DEFAULT_PAD_Y

    clearWorldAndEditorState(world, chunks, editorState)
    clearAllChunks(chunks)
    chunks.replacePalette(DEFAULT_PALETTE)

    for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
            chunks.setVoxel(x, padY, z, BLOCK.grass)
            for (let y = 0; y < padY; y++) chunks.setVoxel(x, y, z, BLOCK.dirt)
        }
    }

    editorState.spawn = { x: w / 2, y: padY + 1, z: d / 2 }
    editorState.player = copyPlayerSettings(DEFAULT_PLAYER_SETTINGS)
    editorState.workingPlaneY = padY
    editorState.activeBlock = BLOCK.grass
}

function clearWorldAndEditorState(
    world: GameWorld,
    chunks: ChunkManager,
    editorState: EditorState,
): void {
    for (const p of editorState.pickups) {
        if (p.eid >= 0) despawnEntity(world, p.eid)
    }
    editorState.pickups = []
    world.pickupMetaByEid.clear()
    world.pickupEntityByScriptId.clear()

    for (const p of world.pistons) {
        if (p.eid >= 0) {
            world.obstacles.remove(p.eid)
            despawnEntity(world, p.eid)
        }
    }
    world.pistons.length = 0
    editorState.pistons = []

    world.zones.clear()
    world.zoneEvents.length = 0
    world.popupMessages.length = 0
    world.nextPopupMessageId = 1
    editorState.zones = []

    editorState.soundSources = []
    editorState.selectedSoundSourceId = null
    editorState.soundZones = []
    editorState.selectedSoundZoneId = null
    editorState.weatherZones = []
    editorState.selectedWeatherZoneId = null
    editorState.props = []
    editorState.selectedPropId = null
    editorState.npcs = []
    editorState.selectedNpcId = null
    editorState.scripts = []
    editorState.stoneSpawners = []
    // Leave ambientWeather alone — it's level-wide state the user
    // explicitly authored. A fresh "new level" call will overwrite it
    // via createEditorState anyway.
}

function clearAllChunks(chunks: ChunkManager): void {
    for (const chunk of [...chunks.allChunks()]) {
        for (let z = 0; z < 32; z++) {
            for (let y = 0; y < 32; y++) {
                for (let x = 0; x < 32; x++) {
                    if (chunk.getLocal(x, y, z) !== 0) {
                        chunks.setVoxel(
                            chunk.cx * 32 + x,
                            chunk.cy * 32 + y,
                            chunk.cz * 32 + z,
                            0,
                        )
                    }
                }
            }
        }
    }
}

/**
 * Save the current editor state to a binary level file the user downloads.
 * Voxel data is the existing binary format from `level-serializer`; pickup
 * metadata + spawn ride alongside as JSON in the level's metadata slot.
 */
export function saveLevelDownload(chunks: ChunkManager, editorState: EditorState, name = 'untitled-level'): void {
    const metadata = toLevelMeta(editorState, name)
    const buffer = serializeLevel(chunks, metadata)
    const blob = new Blob([buffer], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}.vplevel`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
}

/**
 * Replace the current chunks + editor state with a loaded level. Disposes
 * existing pickup preview entities and reinstantiates them at the loaded
 * positions. Mutates `chunks` and `editorState` in place.
 */
export async function loadLevelFromFile(
    file: File,
    world: GameWorld,
    chunks: ChunkManager,
    editorState: EditorState,
): Promise<EditorLevelMeta> {
    return loadLevelFromBuffer(await file.arrayBuffer(), world, chunks, editorState)
}

/**
 * Apply a level binary already in memory. Used by the editor's session
 * restore path (reading back a playtest snapshot from sessionStorage) where
 * we don't have a `File` handle — just bytes. Same semantics as
 * `loadLevelFromFile`: clears existing chunks + pickups + pistons, then
 * replays the serialised level on top.
 */
export function loadLevelFromBuffer(
    buffer: ArrayBuffer,
    world: GameWorld,
    chunks: ChunkManager,
    editorState: EditorState,
): EditorLevelMeta {
    const loaded = deserializeLevel<EditorLevelMeta>(buffer)

    clearWorldAndEditorState(world, chunks, editorState)
    clearAllChunks(chunks)
    chunks.replacePalette(loaded.chunks.palette)

    // Copy chunk data from the loaded snapshot. The chunk renderer's
    // drainDirty loop catches up on the next render frame.
    for (const newChunk of [...loaded.chunks.allChunks()]) {
        for (let z = 0; z < 32; z++) {
            for (let y = 0; y < 32; y++) {
                for (let x = 0; x < 32; x++) {
                    const v = newChunk.getLocal(x, y, z)
                    if (v !== 0) {
                        chunks.setVoxel(
                            newChunk.cx * 32 + x,
                            newChunk.cy * 32 + y,
                            newChunk.cz * 32 + z,
                            v,
                        )
                    }
                }
            }
        }
    }

    if (loaded.metadata) {
        editorState.spawn = { ...loaded.metadata.spawn }
        editorState.player = normalizePlayerSettings(loaded.metadata.player)
        editorState.stoneSpawners = (loaded.metadata.stoneSpawners ?? []).map(copyStoneSpawner)
        for (const p of loaded.metadata.pickups ?? []) {
            const eid = spawnPickupPreview(world, p.kind, p.position)
            editorState.pickups.push({ ...p, position: { ...p.position }, eid })
        }
        for (const p of loaded.metadata.pistons ?? []) {
            registerPistonMechanism(world, chunks, {
                from: { ...p.from },
                to: { ...p.to },
                block: p.block,
                delay: p.delay ?? p.interval ?? 2,
                motion: p.motion ?? 'teleport',
                travelTime: p.travelTime ?? 1,
                characterPolicy: p.characterPolicy,
            })
            editorState.pistons.push({
                from: { ...p.from },
                to: { ...p.to },
                block: p.block,
                delay: p.delay ?? p.interval ?? 2,
                motion: p.motion ?? 'teleport',
                travelTime: p.travelTime ?? 1,
                characterPolicy: p.characterPolicy,
            })
        }
        for (const z of loaded.metadata.zones ?? []) {
            editorState.zones.push({
                id: z.id,
                kind: z.kind ?? 'generic',
                label: z.label,
                min: { ...z.min },
                max: { ...z.max },
                triggerSources: z.triggerSources ? [...z.triggerSources] : undefined,
                script: z.script ? {
                    actions: z.script.actions.map(copyZoneScriptAction),
                } : undefined,
                portal: z.portal ? {
                    targetLevelId: z.portal.targetLevelId,
                    targetArrivalId: z.portal.targetArrivalId,
                } : undefined,
                interaction: z.interaction ? {
                    prompt: z.interaction.prompt,
                    anchor: z.interaction.anchor ? { ...z.interaction.anchor } : undefined,
                    radius: z.interaction.radius,
                } : undefined,
                active: z.active,
            })
        }
        for (const s of loaded.metadata.soundSources ?? []) {
            editorState.soundSources.push({
                id: s.id,
                soundId: s.soundId,
                label: s.label,
                position: { ...s.position },
                radius: Number.isFinite(s.radius) ? s.radius : 12,
                volume: Number.isFinite(s.volume) ? s.volume : 1,
                loop: s.loop ?? true,
                autoplay: s.autoplay ?? true,
            })
        }
        for (const z of loaded.metadata.soundZones ?? []) {
            editorState.soundZones.push({
                id: z.id,
                label: z.label,
                min: { ...z.min },
                max: { ...z.max },
                soundId: z.soundId,
                volume: Number.isFinite(z.volume) ? z.volume : 0.5,
                fadeTime: Number.isFinite(z.fadeTime) ? z.fadeTime : 1.2,
            })
        }
        for (const p of loaded.metadata.props ?? []) {
            editorState.props.push({
                id: p.id,
                kind: p.kind,
                position: { ...p.position },
                yaw: Number.isFinite(p.yaw) ? p.yaw : 0,
                scale: Number.isFinite(p.scale) && p.scale > 0 ? p.scale : 1,
                gridAligned: p.gridAligned ?? true,
            })
        }
        for (const npc of loaded.metadata.npcs ?? []) {
            editorState.npcs.push(normalizeNpcConfig({
                ...npc,
                position: { ...npc.position },
            }))
        }
        editorState.scripts = (loaded.metadata.scripts ?? []).map(copyScriptEntry)
        // Restore the level-wide music selection. Without this branch
        // the Level-tab track dropdown silently resets to "(none)"
        // every time the editor reopens — e.g. after a playtest
        // round-trip via `restoreSessionLevel`, which constructs a
        // fresh editorState and then expects this loader to repopulate
        // it from the saved metadata.
        if (loaded.metadata.environment) {
            editorState.environment = {
                soundId: loaded.metadata.environment.soundId,
                volume: Number.isFinite(loaded.metadata.environment.volume)
                    ? loaded.metadata.environment.volume
                    : 0.4,
            }
        }
        for (const z of loaded.metadata.weatherZones ?? []) {
            editorState.weatherZones.push({
                id: z.id,
                label: z.label,
                presetId: z.presetId,
                position: { ...z.position },
                size: { ...z.size },
                addSound: z.addSound ?? true,
                soundId: z.soundId,
                soundVolume: Number.isFinite(z.soundVolume) ? z.soundVolume : 0.5,
            })
        }
        if (loaded.metadata.ambientWeather) {
            // Merge against DEFAULT_AMBIENT_WEATHER so older save files
            // pick up new fields (mode, cycleEnabled, cycleSeconds,
            // skyTint, sunIntensityMul, fogDensityMul) without crashing
            // the editor UI that assumes every field is populated.
            editorState.ambientWeather = {
                enabled: loaded.metadata.ambientWeather.enabled,
                presetId: loaded.metadata.ambientWeather.presetId,
                state: {
                    ...DEFAULT_AMBIENT_WEATHER,
                    ...loaded.metadata.ambientWeather.state,
                    skyTint: cloneTriplet(loaded.metadata.ambientWeather.state.skyTint),
                },
            }
        }
    }

    return loaded.metadata
}

/** Defensive clone of a [r,g,b] triplet, with fallback to identity tint
 *  when the stored value is missing or shape-broken (old saves pre-cycle). */
function cloneTriplet(value: unknown): [number, number, number] {
    if (!Array.isArray(value) || value.length < 3) return [1, 1, 1]
    const r = Number(value[0])
    const g = Number(value[1])
    const b = Number(value[2])
    return [
        Number.isFinite(r) ? r : 1,
        Number.isFinite(g) ? g : 1,
        Number.isFinite(b) ? b : 1,
    ]
}

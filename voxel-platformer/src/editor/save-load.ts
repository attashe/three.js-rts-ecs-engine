import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { BLOCK } from '../engine/voxel/palette'
import { deserializeLevel, serializeLevel } from '../engine/voxel/level-serializer'
import { copyZoneScriptAction, type EditorState, type EditorLevelMeta } from './editor-state'
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
 * placed pickups / pistons / zones are torn down, and the working plane
 * snaps to the new ground row.
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

    for (let x = 0; x < w; x++) {
        for (let z = 0; z < d; z++) {
            chunks.setVoxel(x, padY, z, BLOCK.grass)
            for (let y = 0; y < padY; y++) chunks.setVoxel(x, y, z, BLOCK.dirt)
        }
    }

    editorState.spawn = { x: w / 2, y: padY + 1, z: d / 2 }
    editorState.workingPlaneY = padY
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
    editorState.zones = []
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
            })
        }
    }

    return loaded.metadata
}

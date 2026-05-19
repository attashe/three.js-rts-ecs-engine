import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { deserializeLevel, serializeLevel } from '../engine/voxel/level-serializer'
import type { EditorState, EditorLevelMeta } from './editor-state'
import { spawnPickupPreview } from './systems/pickup-spawn-system'
import { toLevelMeta } from './editor-state'
import { despawnEntity } from '../engine/ecs/entity'
import type { GameWorld } from '../engine/ecs/world'
import { registerPistonMechanism } from '../game/mechanisms'

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

    // Wipe the live editor pickups (entities + metadata) before applying.
    for (const p of editorState.pickups) {
        if (p.eid >= 0) despawnEntity(world, p.eid)
    }
    editorState.pickups = []

    // Replace voxels: clear everything currently in the manager, then copy
    // from the loaded chunks. The chunk renderer's drainDirty loop will
    // catch up on the next render frame.
    for (const oldChunk of [...chunks.allChunks()]) {
        for (let z = 0; z < 32; z++) {
            for (let y = 0; y < 32; y++) {
                for (let x = 0; x < 32; x++) {
                    if (oldChunk.getLocal(x, y, z) !== 0) {
                        chunks.setVoxel(
                            oldChunk.cx * 32 + x,
                            oldChunk.cy * 32 + y,
                            oldChunk.cz * 32 + z,
                            0,
                        )
                    }
                }
            }
        }
    }
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

    // Pistons need their live world.pistons entries rebuilt too. Physical
    // pistons own live entities/obstacles, so tear those down before
    // replacing the registry.
    for (const p of world.pistons) {
        if (p.eid >= 0) {
            world.obstacles.remove(p.eid)
            despawnEntity(world, p.eid)
        }
    }
    world.pistons.length = 0
    editorState.pistons = []

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
    }

    return loaded.metadata
}

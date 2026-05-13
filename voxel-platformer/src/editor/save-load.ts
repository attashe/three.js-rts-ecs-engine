import type { ChunkManager } from '../engine/voxel/chunk-manager'
import { deserializeLevel, serializeLevel } from '../engine/voxel/level-serializer'
import type { EditorState, EditorLevelMeta } from './editor-state'
import { spawnPickupPreview } from './systems/pickup-spawn-system'
import { toLevelMeta } from './editor-state'
import { despawnEntity } from '../engine/ecs/entity'
import type { GameWorld } from '../engine/ecs/world'

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
    const buffer = new Uint8Array(await file.arrayBuffer())
    const loaded = deserializeLevel<EditorLevelMeta>(buffer.buffer)

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

    if (loaded.metadata) {
        editorState.spawn = { ...loaded.metadata.spawn }
        for (const p of loaded.metadata.pickups ?? []) {
            const eid = spawnPickupPreview(world, p.kind, p.position)
            editorState.pickups.push({ ...p, position: { ...p.position }, eid })
        }
    }

    return loaded.metadata
}

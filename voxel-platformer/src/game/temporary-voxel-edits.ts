import type { GameWorld } from '../engine/ecs/world'
import type { ChunkManager } from '../engine/voxel/chunk-manager'

export function temporaryVoxelKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

export function setTemporaryVoxel(
    world: GameWorld,
    chunks: ChunkManager,
    x: number,
    y: number,
    z: number,
    value: number,
): boolean {
    const original = chunks.getVoxel(x, y, z)
    if (original === value) return false
    const key = temporaryVoxelKey(x, y, z)
    if (!world.temporaryVoxelEdits.has(key)) world.temporaryVoxelEdits.set(key, { x, y, z, original })
    return chunks.setVoxel(x, y, z, value)
}

export function restoreTemporaryVoxelEdits(world: GameWorld, chunks: ChunkManager): void {
    if (world.temporaryVoxelEdits.size === 0) return
    chunks.withBulkEdit(() => {
        for (const edit of world.temporaryVoxelEdits.values()) chunks.setVoxel(edit.x, edit.y, edit.z, edit.original)
    })
    world.temporaryVoxelEdits.clear()
}

export function clearTemporaryVoxelEdits(world: GameWorld): void {
    world.temporaryVoxelEdits.clear()
}

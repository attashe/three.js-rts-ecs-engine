import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isCollidable, isLadderBlock } from '../../engine/voxel/palette'

export interface LadderAttachment {
    x: number
    y: number
    z: number
    supportDx: number
    supportDz: number
    normalX: number
    normalZ: number
    surfaceX: number
    surfaceZ: number
    yaw: number
}

const LADDER_SURFACE_OFFSET = 0.035
const SUPPORT_DIRECTIONS = [
    { supportDx: -1, supportDz: 0 },
    { supportDx: 1, supportDz: 0 },
    { supportDx: 0, supportDz: -1 },
    { supportDx: 0, supportDz: 1 },
] as const

export function ladderCellAttachmentAt(chunks: ChunkManager, x: number, y: number, z: number): LadderAttachment | null {
    if (!isLadderBlock(chunks.palette, chunks.getVoxel(x, y, z))) return null
    for (const dir of SUPPORT_DIRECTIONS) {
        if (!isLadderSupportBlock(chunks, x + dir.supportDx, y, z + dir.supportDz)) continue
        const normalX = dir.supportDx === 0 ? 0 : -dir.supportDx
        const normalZ = dir.supportDz === 0 ? 0 : -dir.supportDz
        return {
            x,
            y,
            z,
            supportDx: dir.supportDx,
            supportDz: dir.supportDz,
            normalX,
            normalZ,
            surfaceX: x + 0.5 - normalX * 0.5 + normalX * LADDER_SURFACE_OFFSET,
            surfaceZ: z + 0.5 - normalZ * 0.5 + normalZ * LADDER_SURFACE_OFFSET,
            yaw: Math.atan2(normalX, normalZ),
        }
    }
    return null
}

export function sameLadderAttachment(a: Pick<LadderAttachment, 'normalX' | 'normalZ'>, b: Pick<LadderAttachment, 'normalX' | 'normalZ'>): boolean {
    return a.normalX === b.normalX && a.normalZ === b.normalZ
}

function isLadderSupportBlock(chunks: ChunkManager, x: number, y: number, z: number): boolean {
    const block = chunks.getVoxel(x, y, z)
    return !isLadderBlock(chunks.palette, block) && isCollidable(chunks.palette, block)
}

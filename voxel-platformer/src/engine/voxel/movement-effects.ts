import type { ChunkManager } from './chunk-manager'
import { blockMovementTraits } from './palette'
import type { AABB } from './voxel-collide'

export interface MovementEnvironment {
    speedMultiplier: number
    jumpDisabled: boolean
}

export const DEFAULT_MOVEMENT_ENVIRONMENT: MovementEnvironment = {
    speedMultiplier: 1,
    jumpDisabled: false,
}

export function movementEnvironmentForAABB(chunks: ChunkManager, aabb: AABB): MovementEnvironment {
    const eps = 1e-6
    const x0 = Math.floor(aabb.minX)
    const y0 = Math.floor(aabb.minY)
    const z0 = Math.floor(aabb.minZ)
    const x1 = Math.floor(aabb.maxX - eps)
    const y1 = Math.floor(aabb.maxY - eps)
    const z1 = Math.floor(aabb.maxZ - eps)

    let speedMultiplier = 1
    let jumpDisabled = false
    for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                const traits = blockMovementTraits(chunks.palette, chunks.getVoxel(x, y, z))
                speedMultiplier = Math.min(speedMultiplier, traits.speedMultiplier)
                jumpDisabled ||= traits.disableJump
            }
        }
    }
    return { speedMultiplier, jumpDisabled }
}
